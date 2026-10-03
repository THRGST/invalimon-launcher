// Proceso principal: ventana frameless + IPC + orquestacion.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');

const { makePaths } = require('./paths');
const { Logger } = require('./logger');
const { ConfigManager } = require('./launcher/configManager');
const { RemoteManifest } = require('./launcher/remoteManifest');
const { LaunchEngine } = require('./launcher/engine');
const { offlineAuth } = require('./launcher/auth');
const { listMods } = require('./launcher/modsList');
const serverStatus = require('./launcher/serverStatus');
const { scan } = require('./launcher/hardwareScan');
const { nukeAll } = require('./launcher/nuke');
const { Updater } = require('./updater');

let mainWindow = null;
let paths = null;
let logger = null;
let configManager = null;
let engine = null;
let updater = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 980,
    minHeight: 640,
    title: 'Invalimon',
    backgroundColor: '#0d0f17',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

function onEngineEvent(eventName, data) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (eventName === 'log') mainWindow.webContents.send('launcher:log', data);
  else mainWindow.webContents.send('launcher:event', { event: eventName, ...data });
}

app.whenReady().then(() => {
  app.setName('Invalimon');
  paths = makePaths(app);
  logger = new Logger(paths.logsDir, (ev) => onEngineEvent('log', ev));
  configManager = new ConfigManager(paths.configFile);
  const remoteManifest = new RemoteManifest({ paths, app, log: logger });
  engine = new LaunchEngine({ paths, log: logger, app, remoteManifest });
  updater = new Updater({ log: logger, onEvent: (st) => onEngineEvent('update_state', st) });

  // ---- IPC ----------------------------------------------------------------
  ipcMain.handle('launcher:get-config', () => configManager.get());
  ipcMain.handle('launcher:get-app-version', () => app.getVersion());
  ipcMain.handle('launcher:get-system-info', () => ({
    ramTotalGB: Math.round(os.totalmem() / 1073741824),
    cpuModel: ((os.cpus()[0] && os.cpus()[0].model) || '').replace(/\s+/g, ' ').trim(),
    cpuCores: os.cpus().length,
    platform: process.platform,
    packaged: app.isPackaged,
  }));

  // Modos de rendimiento del manifest (local/cache: sin red, no bloquea la UI)
  ipcMain.handle('launcher:get-perf-modes', () => {
    try {
      const m = remoteManifest.getLocal();
      return (m && m.perfModes) || null;
    } catch (e) {
      return null;
    }
  });

  // Escaner: recibe el string de GPU del renderer (WebGL) y recomienda modo.
  ipcMain.handle('launcher:scan-hardware', async (_e, opts) => {
    try {
      let gpu = (opts && opts.gpu) || '';
      if (!gpu) {
        // Fallback: auxAttributes de Electron (menos lindo, pero algo es algo)
        try {
          const info = await app.getGPUInfo('basic');
          gpu = (info && ((info.auxAttributes && info.auxAttributes.glRenderer)
            || (info.gpuDevice && info.gpuDevice[0] && info.gpuDevice[0].deviceString))) || '';
        } catch (e) {}
      }
      const perfModes = remoteManifest.getLocal().perfModes || null;
      const ramHints = {};
      if (perfModes && perfModes.modes) {
        for (const [k, v] of Object.entries(perfModes.modes)) ramHints[k] = v.ramHint || 0;
      }
      return { ok: true, ...scan({ gpu, ramHints }) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('launcher:save-config', (_e, partial) => configManager.save(partial || {}));

  // ---- Panel de Admin (SOLO en la PC del server: donde existe el helper RCON) ----
  // En las PCs de los amigos el helper no existe y la pestania nunca aparece.
  function adminHelperPath() {
    if (process.env.INVALIMON_ADMIN_HELPER) return process.env.INVALIMON_ADMIN_HELPER;
    if (process.platform === 'linux') return path.join(os.homedir(), '.local', 'bin', 'invalimon');
    return null;
  }
  function runHelper(args) {
    return new Promise((resolve) => {
      const helper = adminHelperPath();
      if (!helper || !fs.existsSync(helper)) {
        return resolve({ ok: false, error: 'No existe el comando del server en esta PC (el panel es solo para la PC del server).' });
      }
      execFile(helper, args, { timeout: 15000 }, (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: String(stderr || err.message).trim() });
        resolve({ ok: true, out: String(stdout).trim() });
      });
    });
  }
  const ADMIN_COLOR_RX = /^([a-z_]+|#[0-9a-fA-F]{6})$/;
  ipcMain.handle('launcher:admin-available', () => {
    const helper = adminHelperPath();
    return { available: Boolean(helper && fs.existsSync(helper)) };
  });
  // Saca todo lo que podria romper el quoting del comando (SNBT/macro/RCON)
  function adminCleanText(s, max) {
    return String(s || '')
      .replace(/["'\\`$(){}[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }
  ipcMain.handle('launcher:admin-ruleta', (_e, opts) => {
    const c = opts && opts.custom;
    if (c) {
      // mensaje y efecto son OPCIONALES (flags hay_*: el datapack omite las lineas vacias)
      const mensaje = adminCleanText(c.mensaje, 120);
      const efecto = adminCleanText(c.efecto, 120);
      // gajo 0..7 = el color en el que cae la ruleta; el datapack deriva el tono
      // (rojos 0/4 -> vision; verdes 1/5 -> verde; resto -> neutro)
      const gajo = Math.min(7, Math.max(0, parseInt(c.gajo, 10) || 0));
      // regla del evento (efecto): id [a-z_] del datapack; default ninguno
      const efectoId = /^[a-z_]{1,24}$/.test(String(c.efectoId || '')) ? String(c.efectoId) : 'ninguno';
      // Fecha de hoy dd/mm — la pone el panel, es el "título" visible del resultado
      const d = new Date();
      const fecha = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      return runHelper([`function inv:admin/tirar_custom {gajo:"${gajo}",mensaje:"${mensaje}",efecto:"${efecto}",efecto_id:"${efectoId}",fecha:"${fecha}",hay_mensaje:"${mensaje ? 1 : 0}",hay_efecto:"${efecto ? 1 : 0}"}`]);
    }
    return runHelper(['function inv:ruleta/tirar']);
  });
  // Vidas infinitas para el jugador configurado en ESTA PC (el admin)
  ipcMain.handle('launcher:admin-inmortal', (_e, opts) => {
    const user = String((configManager.get().user || {}).username || '').trim();
    if (!user) return { ok: false, error: 'Todavía no pusiste tu nombre de jugador en la app.' };
    if (!/^[A-Za-z0-9_]{1,16}$/.test(user)) return { ok: false, error: 'Tu nombre de jugador tiene caracteres raros.' };
    const fn = (opts && opts.on) ? 'inmortal' : 'mortal';
    return runHelper([`execute as ${user} run function inv:admin/${fn}`]);
  });
  ipcMain.handle('launcher:admin-limpiar-efectos', () => {
    return runHelper(['function inv:admin/limpiar_efectos']);
  });
  ipcMain.handle('launcher:admin-anuncio', (_e, opts) => {
    const text = String((opts && opts.text) || '').slice(0, 200).trim();
    if (!text) return { ok: false, error: 'Escribí un texto primero.' };
    let color = String((opts && opts.color) || 'gold');
    if (!ADMIN_COLOR_RX.test(color)) color = 'gold';
    const json = JSON.stringify([
      { text: '📢 ', color: 'gold', bold: true },
      { text, color, bold: true },
    ]);
    return runHelper([`tellraw @a ${json}`]);
  });

  ipcMain.handle('launcher:get-state', async () => {
    const pack = await engine.manager.currentPackInfo();
    let notice = null;
    try { notice = remoteManifest.getLocal().notice || null; } catch (e) {}
    return { running: engine.isRunning, pack, dataDir: paths.dataDir, gameDir: paths.gameDir, notice };
  });

  ipcMain.handle('launcher:get-server-status', async () => {
    try {
      const manifest = remoteManifest.getLocal();
      const address = remoteManifest.serverAddress(manifest, configManager.get().settings.serverAddress);
      return await serverStatus.ping(address);
    } catch (e) {
      return { online: false, error: e.message };
    }
  });

  ipcMain.handle('launcher:get-mods', async () => {
    try {
      const manifest = remoteManifest.getLocal();
      const sections = (manifest.modSections && manifest.modSections.sections) || [];
      const extraFiles = (manifest.extraMods || []).map((m) => m.filename);
      return await listMods({
        gameDir: paths.gameDir, cacheDir: paths.cacheDir, log: logger, sections, extraFiles,
      });
    } catch (e) {
      logger.warn(`No pude listar los mods: ${e.message}`);
      return [];
    }
  });

  ipcMain.handle('launcher:login-offline', (_e, username) => {
    const auth = offlineAuth(username);
    configManager.save({ user: { type: 'offline', username: auth.username, uuid: auth.uuid } });
    logger.info(`Sesion offline: ${auth.username} (${auth.uuid})`);
    return auth;
  });

  ipcMain.handle('launcher:launch-game', async () => {
    if (engine.isRunning) return { ok: false, error: 'El juego ya esta abierto' };
    const config = configManager.get();
    if (!config.user.username) return { ok: false, error: 'Falta el nombre de usuario' };
    return engine.launch({ config, onEvent: onEngineEvent });
  });

  ipcMain.handle('launcher:kill-game', () => ({ ok: engine.kill() }));

  ipcMain.handle('launcher:verify-integrity', async () => {
    try {
      const info = await engine.verifyIntegrity({ onEvent: onEngineEvent });
      return { ok: true, ...info };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('launcher:open-game-dir', async () => {
    fs.ensureDirSync(paths.gameDir);
    return shell.openPath(paths.gameDir);
  });

  ipcMain.handle('launcher:wipe-game-dir', async () => {
    await engine.manager.wipeGameDir();
    return { ok: true };
  });

  // Reset total: borra TODO (juego, config, cache, logs) y opcionalmente se desinstala.
  // El renderer ya pidio confirmacion escribiendo BORRAR.
  ipcMain.handle('launcher:nuke', async (_e, opts) => {
    try {
      const report = await nukeAll({
        paths, engine, app, log: logger,
        uninstall: Boolean(opts && opts.uninstall),
      });
      if (report.uninstalling) setTimeout(() => app.quit(), 1500);
      return { ok: true, ...report };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---- Auto-update --------------------------------------------------------
  ipcMain.handle('launcher:get-update-state', () => updater.getState());
  ipcMain.handle('launcher:check-updates', () => updater.check());
  ipcMain.handle('launcher:install-update', () => updater.install());

  ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow && mainWindow.close());

  createWindow();
  updater.init();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
