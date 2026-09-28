// Resuelve las rutas de datos del launcher.
// Regla de oro: NUNCA guardar datos dentro del install dir (el updater lo reemplaza).
// En Windows: %APPDATA%\Invalimon\{game,cache,logs}
const path = require('path');

function dataDir(app) {
  // Override por env para dev/tests (Linux) o para mover la carpeta en Windows
  if (process.env.INVALIMON_DATA_DIR) return path.resolve(process.env.INVALIMON_DATA_DIR);
  // Determinista: %APPDATA%\Invalimon en Windows, ~/.config/Invalimon en Linux
  return path.join(app.getPath('appData'), 'Invalimon');
}

function makePaths(app) {
  const base = dataDir(app);
  const gameDir = path.join(base, 'game');
  const cacheDir = path.join(base, 'cache');
  return {
    dataDir: base,
    gameDir,
    cacheDir,
    mrpackCacheDir: path.join(cacheDir, 'mrpack'),
    logsDir: path.join(base, 'logs'),
    configFile: path.join(base, 'launcher-config.json'),
    cacheManifest: path.join(cacheDir, 'manifest.json'),
  };
}

module.exports = { makePaths };
