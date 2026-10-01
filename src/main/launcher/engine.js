// Motor de lanzamiento: manifest -> modpack -> version JSON -> assets -> Java -> mclc.
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Client } = require('minecraft-launcher-core');
// Monkey-patch: mclc valida sha1 de TODOS los assets/librerias en cada arranque
// (minutos). Con size>0 alcanza y es lo que hacen los launchers grandes.
const Handler = require('minecraft-launcher-core/components/handler');
Handler.prototype.checkSum = function (hash, file) {
  return new Promise((resolve) => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return resolve(true);
    } catch (e) {}
    resolve(false);
  });
};

const { ModpackManager } = require('./modpackManager');
const { ensureVersionJson } = require('./versionResolver');
const { preloadAssets } = require('./assetsPreloader');
const { ensureJava21 } = require('./javaFinder');
const { offlineAuth } = require('./auth');

class LaunchEngine {
  constructor({ paths, log, app, remoteManifest }) {
    this.paths = paths;
    this.log = log;
    this.app = app;
    this.remoteManifest = remoteManifest;
    this.manager = new ModpackManager({ paths, log, app });
    this.launcher = null;
    this.activeProcess = null;
    this.isRunning = false;
  }

  kill() {
    if (!this.activeProcess) return false;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(this.activeProcess.pid), '/T', '/F'], { windowsHide: true });
      } else {
        this.activeProcess.kill('SIGTERM');
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async verifyIntegrity({ onEvent, signal }) {
    const manifest = await this.remoteManifest.get();
    return this.manager.ensurePack({
      pack: manifest.pack,
      serverEntry: null,
      onEvent: (ev) => onEvent && onEvent(ev),
      signal,
      mode: 'full',
      // Con el juego abierto no se tocan mods/options (Windows bloquea los .jar
      // cargados y el juego pisa options.txt al salir).
      allowApply: !this.isRunning,
    });
  }

  async launch({ config, onEvent, signal }) {
    const emit = (event, data) => onEvent && onEvent(event, data);
    const status = (phase, message, percent) => emit('status', { phase, message, percent });
    const log = (type, text) => emit('log', { type, text });

    this.isRunning = true;
    try {
      // ---- 1. manifest + pack (10-85%) -------------------------------------
      status('init', 'Buscando actualizaciones...', 5);
      const manifest = await this.remoteManifest.get();
      const serverAddress = this.remoteManifest.serverAddress(manifest, config.settings.serverAddress);
      const serverName = manifest.server.name || 'Invalimon';

      // Modo de rendimiento (alto/medio/minimo). Si el manifest todavia no trae
      // perfModes (cache viejo), queda null y modpackManager usa el modo ligero legacy.
      const perfModes = manifest.perfModes && manifest.perfModes.modes ? manifest.perfModes : null;
      const perfMode = perfModes && perfModes.modes[config.settings.perfMode]
        ? config.settings.perfMode
        : ((perfModes && perfModes.default) || 'medio');
      const pack = {
        ...manifest.pack,
        extraMods: manifest.extraMods || [],
        clientDefaults: manifest.clientDefaults || null,
        perfModes,
        perfMode,
        lightMode: manifest.lightMode || null,
        lightModeEnabled: Boolean(config.settings.lightMode),
      };
      const remap = (pct) => 10 + Math.round((pct / 100) * 75);
      const packInfo = await this.manager.ensurePack({
        pack,
        serverEntry: { name: serverName, address: serverAddress, icon: (manifest.server && manifest.server.icon) || null },
        onEvent: (ev) => {
          if (ev.phase === 'done') return;
          status(ev.phase, ev.message, remap(ev.percent || 0));
        },
        signal,
        mode: 'fast',
      });

      // ---- 2. version JSON (85-88%) ----------------------------------------
      status('fabric_profile', 'Preparando Fabric...', 86);
      const { profileId, versionJson } = await ensureVersionJson({
        gameDir: this.paths.gameDir,
        mc: packInfo.mc,
        loader: packInfo.loader,
        log: this.log,
      });

      // ---- 3. assets (88-94%) ----------------------------------------------
      status('assets', 'Verificando recursos...', 88);
      const vanilla = fs.readJsonSync(versionJson).assetIndex
        ? fs.readJsonSync(versionJson)
        : null;
      await preloadAssets({
        gameDir: this.paths.gameDir,
        vanilla,
        profileId,
        signal,
        log: this.log,
        onProgress: (done, total) =>
          status('assets', `Recursos: ${done}/${total}`, 88 + Math.round((done / total) * 6)),
      });

      // ---- 4. Java (94-97%) -------------------------------------------------
      status('java', 'Verificando Java 21...', 94);
      const javaPath = (config.settings.javaPath && config.settings.javaPath !== 'auto')
        ? config.settings.javaPath
        : await ensureJava21({
            gameDir: this.paths.gameDir,
            log: this.log,
            onEvent: (ev) => status(ev.phase, ev.message, 94 + Math.round((ev.percent || 0) / 15)),
          });

      // ---- 5. Launch mclc (97-100%) ------------------------------------------
      status('launching', 'Iniciando Minecraft...', 97);
      const auth = offlineAuth(config.user.username);
      // GC: Distant Horizons avisa en el log que G1 le mete stuttering a un
      // cliente tan cargado y recomienda un colector concurrente (ZGC en Java
      // 21+). Se puede volver a G1 desde Ajustes. Los flags de GC escritos a
      // mano se descartan: dos "-XX:+Use*GC" juntos y el juego no arranca.
      // 'auto' = ZGC solo donde sobra CPU: sus hilos concurrentes le compiten al
      // juego en un 4 nucleos (y ademas alarga un poco el arranque), asi que en
      // maquinas justas conviene el G1 de siempre.
      const gcMode = config.settings.gc || 'auto';
      // En modo minimo va G1 aunque sobre CPU: ZGC suma hilos concurrentes que en
      // una PC floja le compiten al juego (y alarga el arranque).
      const sobraCpu = os.cpus().length >= 6 && os.totalmem() >= 12 * 1073741824
        && perfMode !== 'minimo';
      const useZgc = gcMode === 'zgc' || (gcMode !== 'g1' && sobraCpu);
      const gcArgs = useZgc ? ['-XX:+UseZGC'] : [];
      const userArgs = (config.settings.customJvmArgs || '')
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((a) => !/^-XX:[+-](Use\w*GC|ZGenerational)$/i.test(a));
      log('INFO', `Basura (GC): ${useZgc ? 'ZGC' : 'G1'} (${gcMode})`);
      if (perfModes) {
        log('INFO', `Modo de rendimiento: ${perfModes.modes[perfMode].title || perfMode}`);
      }
      const mclcOptions = {
        clientPackage: null,
        authorization: auth,
        root: this.paths.gameDir,
        version: { number: packInfo.mc, type: 'release', custom: profileId },
        overrides: { versionJson },
        memory: {
          max: `${config.settings.ramMax || 6144}M`,
          min: `${config.settings.ramMin || 2048}M`,
        },
        javaPath,
        customArgs: ['-DFabricMcEmu=net.minecraft.client.main.Main', ...gcArgs, ...userArgs],
        window: {
          width: config.settings.resolutionWidth || 1280,
          height: config.settings.resolutionHeight || 720,
          fullscreen: Boolean(config.settings.fullscreen),
        },
      };
      // Sin quickPlay a proposito: el juego abre en el menu y el server ya esta
      // en la lista de Multijugador (servers.dat). Auto-conectar dejaba al
      // jugador colgado en "Connecting to..." cada vez que el server estaba apagado.
      this.launcher = new Client();
      this.launcher.on('debug', (e) => { if (String(e).startsWith('Error')) log('ERROR', String(e)); });
      this.launcher.on('data', (e) => {
        const line = e.toString();
        let type = 'INFO';
        if (line.includes('WARN')) type = 'WARN';
        if (line.includes('ERROR') || line.includes('Exception') || line.includes('FATAL')) type = 'ERROR';
        log(type, line.trim());
        if (/quick play|Connecting to/i.test(line)) emit('autoconnect', { text: line.trim() });
      });
      this.launcher.on('progress', (e) => {
        if (e && e.task && e.total) {
          const pct = Math.round((e.task / e.total) * 100);
          status('libraries', `Verificando librerias (${e.type}): ${e.task}/${e.total}`, 97 + Math.round((pct / 100) * 2));
        }
      });
      this.launcher.on('close', (code) => {
        this.isRunning = false;
        this.activeProcess = null;
        emit('game_closed', { code });
        status('idle', 'Listo', 0);
      });

      this.activeProcess = await this.launcher.launch(mclcOptions);
      const pid = this.activeProcess ? this.activeProcess.pid : null;
      log('SYSTEM', `Minecraft iniciado (PID: ${pid})`);
      emit('game_started', { pid });
      status('running', 'Jugando', 100);
      return { ok: true };
    } catch (err) {
      this.isRunning = false;
      log('ERROR', err.message || String(err));
      status('error', `Error: ${err.message}`, 0);
      return { ok: false, error: err.message };
    }
  }
}

module.exports = { LaunchEngine };
