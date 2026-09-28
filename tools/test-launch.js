// Test de lanzamiento: usa el engine REAL (con app fake, sin electron).
// Prepara (version JSON, assets, Java) y lanza Minecraft con la cuenta offline.
process.env.INVALIMON_DATA_DIR = process.env.INVALIMON_DATA_DIR || '/tmp/inv-dev';
const { makePaths } = require('../src/main/paths');
const { Logger } = require('../src/main/logger');
const { ConfigManager } = require('../src/main/launcher/configManager');
const { RemoteManifest } = require('../src/main/launcher/remoteManifest');
const { LaunchEngine } = require('../src/main/launcher/engine');

const fakeApp = { getPath: () => process.env.INVALIMON_DATA_DIR, isPackaged: false };

(async () => {
  const paths = makePaths(fakeApp);
  const log = new Logger(paths.logsDir, (ev) => console.log(`[${ev.type}] ${ev.text}`));
  const configManager = new ConfigManager(paths.configFile);
  configManager.save({ user: { type: 'offline', username: 'DevThiago' } });
  const remoteManifest = new RemoteManifest({ paths, app: fakeApp, log });
  const engine = new LaunchEngine({ paths, log, app: fakeApp, remoteManifest });

  const config = configManager.get();
  const res = await engine.launch({
    config,
    onEvent: (name, data) => {
      if (name === 'log') {
        const t = data.text || '';
        if (/ERROR|Exception|Setting user|quick play|Connecting|Loaded \d+ mods/i.test(t)) console.log(`  | ${t.slice(0, 200)}`);
      } else if (name === 'status') {
        console.log(`[${data.percent}%] ${data.message}`);
      } else {
        console.log(`[EVENTO ${name}] ${JSON.stringify(data).slice(0, 200)}`);
      }
    },
  });
  console.log('launch =>', JSON.stringify(res));
  console.log('(esperando que el juego arranque; Ctrl-C para cortar)');
  setInterval(() => {}, 60000);
})();
