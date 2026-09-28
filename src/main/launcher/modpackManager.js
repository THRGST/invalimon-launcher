// Modpack manager: .mrpack de Modrinth -> gameDir, con verificacion de integridad,
// descarga resumible y limpieza que solo borra lo que nosotros instalamos.
//
// Estado en <gameDir>/.invalimon/state.json (fuente de verdad local).
// Pipeline: mrpack -> indice -> plan -> descarga -> overrides -> servers.dat -> state
const fs = require('fs-extra');
const path = require('path');
const yauzl = require('yauzl');
const { download, hashFile } = require('./httpClient');
const { extractOverrides } = require('./overridesExtractor');
const { patchServersDat } = require('./serversDat');

const STATE_DIR = '.invalimon';
const STATE_FILE = 'state.json';
const CONCURRENCY = 6;

const mb = (n) => (n / 1048576).toFixed(0);

// Lee SOLO modrinth.index.json del zip (sin extraer los 253 MB de overrides)
function readIndexFromZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let found = false;
      zip.on('entry', (entry) => {
        if (found || entry.fileName !== 'modrinth.index.json') return zip.readEntry();
        found = true;
        zip.openReadStream(entry, (e2, rs) => {
          if (e2) return reject(e2);
          const chunks = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (e) { reject(e); }
            zip.close();
          });
          rs.on('error', reject);
        });
      });
      zip.on('end', () => { if (!found) reject(new Error('El pack no tiene modrinth.index.json')); });
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

class ModpackManager {
  constructor({ paths, log, app }) {
    this.paths = paths;
    this.log = log;
    this.app = app;
    this.stateFile = path.join(paths.gameDir, STATE_DIR, STATE_FILE);
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) return fs.readJsonSync(this.stateFile);
    } catch (e) {}
    return { schema: 1 };
  }

  saveState(state) {
    fs.ensureDirSync(path.dirname(this.stateFile));
    const tmp = this.stateFile + '.tmp';
    fs.writeJsonSync(tmp, state, { spaces: 2 });
    fs.moveSync(tmp, this.stateFile, { overwrite: true });
  }

  async currentPackInfo() {
    const state = this.loadState();
    let modCount = 0;
    try {
      modCount = fs.readdirSync(path.join(this.paths.gameDir, 'mods')).filter((f) => f.endsWith('.jar')).length;
    } catch (e) {}
    return { ...state.pack, modCount, server: state.server || null, installedAt: state.installedAt || null };
  }

  async wipeGameDir() {
    await fs.remove(this.paths.gameDir);
  }

  // Fase 6 sola (para re-parchear cuando cambia la direccion del server)
  async patchServerEntry({ name, address }) {
    const patched = await patchServersDat({ gameDir: this.paths.gameDir, name, address, log: this.log });
    if (patched.length) {
      const state = this.loadState();
      state.server = { name, address, patchedAt: Date.now() };
      this.saveState(state);
    }
    return patched;
  }

  // mode: 'fast' (size exacto) | 'full' (sha1 de todo - boton "verificar integridad")
  async ensurePack({ pack, serverEntry, onEvent, signal, mode = 'fast' }) {
    const emit = (phase, message, percent, extra = {}) =>
      onEvent && onEvent({ phase, message, percent, ...extra });
    const gameDir = this.paths.gameDir;
    fs.ensureDirSync(gameDir);
    let state = this.loadState();

    // ---- ETAPA 1: asegurar el .mrpack en cache (resumible) -------------------
    const mrpackPath = path.join(this.paths.mrpackCacheDir, `${pack.name}-${pack.versionId}.mrpack`);
    let needDownload = true;
    if (fs.existsSync(mrpackPath) && fs.statSync(mrpackPath).size === pack.size) {
      if (state.pack && state.pack.mrpackSha512 === pack.sha512) {
        needDownload = false; // ya validado en una corrida anterior
      } else {
        emit('mrpack_verify', 'Verificando el pack descargado...', 3);
        const got = await hashFile(mrpackPath, 'sha512');
        if (got === pack.sha512) needDownload = false;
      }
    }
    if (needDownload) {
      emit('mrpack_download', 'Descargando Cobbleverse (228 MB)...', 2);
      await download(pack.url, mrpackPath, {
        sha512: pack.sha512, size: pack.size, signal, log: this.log,
        onProgress: (done, total) => emit('mrpack_download',
          `Descargando pack: ${mb(done)}/${mb(total)} MB`,
          2 + Math.round((done / total) * 6), { bytes: { done, total } }),
      });
    }

    // ---- ETAPA 2: leer el indice --------------------------------------------
    emit('mrpack_verify', 'Leyendo el pack...', 9);
    const index = await readIndexFromZip(mrpackPath);
    if (!index || !index.dependencies || !index.dependencies.minecraft) {
      throw new Error('Indice del pack invalido');
    }
    const versionId = index.versionId || pack.versionId;
    // Mods desactivados a proposito: ni se descargan ni se borran
    const disabledMods = new Set(
      (((pack.clientDefaults || {}).modDisable) || []).map((f) => `mods/${f}`));
    const files = (index.files || [])
      .filter((f) => (f.env.client || 'required') !== 'unsupported')
      .filter((f) => !disabledMods.has(f.path));

    // ---- ETAPA 3: plan (que falta / que esta corrupto) ----------------------
    emit('mods_check', 'Verificando archivos instalados...', 12);
    const pending = [];
    for (const f of files) {
      if (signal && signal.aborted) throw new Error('cancelado');
      const dest = path.join(gameDir, ...f.path.split('/'));
      let ok = false;
      try {
        const st = fs.statSync(dest);
        if (st.size === f.fileSize) {
          if (mode === 'fast') ok = true;
          else ok = (await hashFile(dest, 'sha1')) === f.hashes.sha1;
        }
      } catch (e) {}
      if (!ok) pending.push(f);
    }

    // ---- ETAPA 4: descarga concurrente, progreso por bytes ------------------
    if (pending.length) {
      const totalBytes = pending.reduce((a, f) => a + f.fileSize, 0);
      const progress = new Map();
      let completed = 0;
      let lastEmit = 0;
      const emitProgress = (force) => {
        const now = Date.now();
        if (!force && now - lastEmit < 400) return;
        lastEmit = now;
        let sum = 0;
        for (const v of progress.values()) sum += v;
        emit('mods_download',
          `Mods: ${mb(sum)}/${mb(totalBytes)} MB (${completed}/${pending.length} archivos)`,
          15 + Math.round((sum / totalBytes) * 65),
          { bytes: { done: sum, total: totalBytes } });
      };
      emitProgress(true);

      const errors = [];
      const runPool = async (list) => {
        let idx = 0;
        const worker = async () => {
          while (idx < list.length) {
            if (signal && signal.aborted) return;
            const f = list[idx++];
            const dest = path.join(gameDir, ...f.path.split('/'));
            try {
              await download(f.downloads[0], dest, {
                sha1: f.hashes.sha1, size: f.fileSize, signal, log: this.log,
                onProgress: (done, total) => {
                  progress.set(f.path, Math.min(done, total || f.fileSize));
                  emitProgress(false);
                },
              });
              progress.set(f.path, f.fileSize);
              completed++;
              emitProgress(false);
            } catch (e) {
              if (signal && signal.aborted) return;
              errors.push({ path: f.path, error: e.message });
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
      };

      await runPool(pending);
      if (signal && signal.aborted) throw new Error('cancelado');
      // Segundo pase para los que fallaron
      if (errors.length) {
        const first = errors.splice(0, errors.length);
        this.log.warn(`Reintentando ${first.length} archivo(s) que fallaron`);
        const retryList = first
          .map((e) => pending.find((f) => f.path === e.path))
          .filter(Boolean);
        await runPool(retryList);
      }
      if (errors.length > 20) {
        throw new Error(`Fallaron ${errors.length} archivos (ultimo: ${errors[0].path})`);
      }
      if (errors.length) {
        emit('mods_download', `Aviso: ${errors.length} archivo(s) no se pudieron bajar`, 80);
      }
    } else {
      emit('mods_check', 'Todos los mods ya estan instalados ✔', 80);
    }

    // ---- ETAPA 5: overrides --------------------------------------------------
    const needOverrides = !state.overrides || state.overrides.versionId !== versionId;
    if (needOverrides) {
      emit('overrides_extract', 'Extrayendo configuracion y recursos...', 82);
      const res = await extractOverrides(mrpackPath, gameDir, {
        signal,
        log: this.log,
        onProgress: (done, total) => emit('overrides_extract',
          `Extrayendo configuracion: ${done}/${total}`, 82 + Math.round((done / total) * 10)),
      });
      this.log.info(`Overrides extraidos: ${res.extracted} (saltados: ${res.skipped})`);
    }

    // ---- ETAPA 5b: mods extra del launcher (client-side) ---------------------
    const extras = Array.isArray(pack.extraMods) ? pack.extraMods : [];
    if (extras.length) {
      const extraDone = [];
      for (let i = 0; i < extras.length; i++) {
        if (signal && signal.aborted) throw new Error('cancelado');
        const ex = extras[i];
        const subdir = ex.dest || 'mods';
        const dest = path.join(gameDir, subdir, ex.filename);
        let ok = false;
        try { ok = fs.statSync(dest).size === ex.size; } catch (e) {}
        if (!ok) {
          emit('extra_mods', `Extras: ${ex.name} (${i + 1}/${extras.length})`, 83 + Math.round((i / extras.length) * 8));
          try {
            await download(ex.url, dest, { sha1: ex.sha1, size: ex.size, signal, log: this.log });
            this.log.info(`Extra instalado: ${ex.name}`);
          } catch (e) {
            this.log.warn(`No pude bajar el extra ${ex.name}: ${e.message}`);
          }
        }
        extraDone.push(`${subdir}/${ex.filename}`);
      }
      // Limpiar extras que ya no esten en el manifest (solo los que instalamos nosotros)
      const extraSet = new Set(extras.map((e) => `${e.dest || 'mods'}/${e.filename}`));
      for (const f of (state.extraFiles || [])) {
        if (!extraSet.has(f)) {
          try { await fs.remove(path.join(gameDir, ...f.split('/'))); } catch (e) {}
        }
      }
      state.extraFiles = extraDone;
      emit('extra_mods', `Extras del launcher listos ✔ (${extras.length})`, 91);
    }

    // ---- ETAPA 5c: defaults de cliente (solo en la primera instalacion) ------
    // Deja el juego optimizado para rendimiento de fabrica; el jugador puede
    // cambiar lo que quiera despues desde Opciones (nunca se vuelve a pisar).
    const cd = pack.clientDefaults;
    if (cd && !state.clientDefaultsApplied) {
      const optFile = path.join(gameDir, 'options.txt');
      if (cd.options && !fs.existsSync(optFile)) {
        const lines = Object.entries(cd.options).map(([k, v]) => `${k}:${v}`);
        fs.writeFileSync(optFile, lines.join('\n') + '\n');
        this.log.info(`Opciones de rendimiento aplicadas (${lines.length})`);
      }
      if (cd.shaders === false) {
        const irisFile = path.join(gameDir, 'config', 'iris.properties');
        if (fs.existsSync(irisFile)) {
          const txt = fs.readFileSync(irisFile, 'utf8').replace(/^enableShaders=.*$/m, 'enableShaders=false');
          fs.writeFileSync(irisFile, txt);
          this.log.info('Shaders desactivados por defecto (se activan en Opciones > Video)');
        }
      }
      // Pantallas custom de FancyMenu que rompen la navegacion (se desactivan)
      if (Array.isArray(cd.fancymenuDisable)) {
        const custDir = path.join(gameDir, 'config', 'fancymenu', 'customization');
        for (const f of cd.fancymenuDisable) {
          const src = path.join(custDir, f);
          if (fs.existsSync(src)) {
            fs.moveSync(src, `${src}.disabled`, { overwrite: true });
            this.log.info(`Pantalla custom desactivada: ${f}`);
          }
        }
      }
      state.clientDefaultsApplied = true;
    }

    // Mods rotos/en conflicto que el launcher desactiva (renombrados a .disabled;
    // Fabric ignora todo lo que no sea .jar)
    const modDisable = (cd && cd.modDisable) || [];
    for (const f of modDisable) {
      const src = path.join(gameDir, 'mods', f);
      if (fs.existsSync(src)) {
        try {
          fs.moveSync(src, `${src}.disabled`, { overwrite: true });
          this.log.info(`Mod desactivado por incompatibilidad: ${f}`);
        } catch (e) {}
      }
    }

    // ---- ETAPA 6: servers.dat -------------------------------------------------
    if (serverEntry && serverEntry.address && !/PENDIENTE/i.test(serverEntry.address)) {
      emit('servers_patch', 'Configurando el server...', 93);
      await patchServersDat({
        gameDir, name: serverEntry.name || 'Invalimon',
        address: serverEntry.address, log: this.log,
      });
    }

    // ---- ETAPA 7: limpieza de version vieja + commit -------------------------
    const newPaths = files.map((f) => f.path);
    if (state.installedFiles && state.pack && state.pack.versionId !== versionId) {
      const newSet = new Set(newPaths);
      const removed = state.installedFiles.filter((p) => !newSet.has(p));
      for (const rel of removed) {
        try { await fs.remove(path.join(gameDir, ...rel.split('/'))); } catch (e) {}
      }
      if (removed.length) this.log.info(`Limpiados ${removed.length} archivos de la version anterior`);
    }

    state = {
      ...state,
      schema: 1,
      pack: {
        name: pack.name,
        versionId,
        mrpackSha512: pack.sha512,
        mc: index.dependencies.minecraft,
        loader: index.dependencies['fabric-loader'],
      },
      installedFiles: newPaths,
      overrides: { versionId, extractedAt: Date.now() },
      installedAt: state.installedAt || Date.now(),
      updatedAt: Date.now(),
    };
    if (serverEntry && serverEntry.address && !/PENDIENTE/i.test(serverEntry.address)) {
      state.server = { name: serverEntry.name || 'Invalimon', address: serverEntry.address, patchedAt: Date.now() };
    }
    this.saveState(state);

    emit('done', 'Pack listo ✔', 100);
    return { versionId, mc: index.dependencies.minecraft, loader: index.dependencies['fabric-loader'] };
  }
}

module.exports = { ModpackManager };
