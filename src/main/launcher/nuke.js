// Reset total: borra TODOS los datos del launcher (juego, config, cache, logs)
// y, opcionalmente, se auto-desinstala (Windows/NSIS instalado).
// El renderer confirma esto con un "BORRAR" escrito a mano antes de llamar.
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

let electronSession = null;
try { ({ session: electronSession } = require('electron')); } catch (e) { /* tests fuera de electron */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// En Windows instalado, el desinstalador vive junto al ejecutable ("Uninstall Invalimon.exe")
function findUninstaller() {
  try {
    const dir = path.dirname(process.execPath);
    const hit = fs.readdirSync(dir).find((f) => /^uninstall.*\.exe$/i.test(f));
    if (hit) return path.join(dir, hit);
  } catch (e) {}
  return null;
}

async function nukeAll({ paths, engine, app, log, uninstall }) {
  const report = { deleted: [], failed: [], uninstalling: false };

  // 1) Si el juego esta abierto, cerrarlo (Windows no deja borrar jars en uso)
  if (engine && engine.isRunning) {
    if (log) log.warn('Reset total: cerrando Minecraft primero');
    engine.kill();
    await sleep(2000);
  }

  // 2) Caches/storage del propio Electron (para no dejar restos a medias)
  try {
    if (electronSession && electronSession.defaultSession) {
      await electronSession.defaultSession.clearStorageData();
      await electronSession.defaultSession.clearCache();
    }
  } catch (e) {}

  // 3) Lo del launcher
  for (const target of [paths.gameDir, paths.cacheDir, paths.logsDir, paths.configFile]) {
    try { await fs.remove(target); report.deleted.push(target); }
    catch (e) { report.failed.push(`${target}: ${e.message}`); }
  }

  // 4) Best-effort: lo que quede en dataDir (restos de Electron que siga en uso)
  try {
    for (const entry of fs.readdirSync(paths.dataDir)) {
      const p = path.join(paths.dataDir, entry);
      try { await fs.remove(p); report.deleted.push(p); }
      catch (e) { report.failed.push(`${path.basename(p)} (en uso)`); }
    }
  } catch (e) {}

  // 5) Desinstalarse (solo launcher instalado de Windows)
  if (uninstall) {
    if (process.platform === 'win32' && app && app.isPackaged) {
      const un = findUninstaller();
      if (un) {
        if (log) log.info(`Auto-desinstalacion: ${un}`);
        try {
          // /S = silencioso; NSIS se auto-copia a %TEMP% y termina de borrar solo
          spawn(un, ['/S'], { detached: true, stdio: 'ignore' }).unref();
          report.uninstalling = true;
        } catch (e) { report.failed.push(`desinstalador: ${e.message}`); }
      } else {
        report.failed.push('No encontre el desinstalador junto al launcher');
      }
    } else {
      report.failed.push('Desinstalar solo aplica al launcher instalado en Windows');
    }
  }

  if (log) log.info(`Reset total: ${report.deleted.length} borrados, ${report.failed.length} no se pudieron`);
  return report;
}

module.exports = { nukeAll, findUninstaller };
