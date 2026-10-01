// Test end-to-end del modpackManager contra el pack real (sin UI).
// Uso: node tools/test-pack.js [--dev] [--mode=alto|medio|minimo] [--full]
process.env.INVALIMON_DATA_DIR = process.env.INVALIMON_DATA_DIR || '/tmp/inv-dev';
const path = require('path');
const { makePaths } = require('../src/main/paths');
const { Logger } = require('../src/main/logger');
const { ModpackManager } = require('../src/main/launcher/modpackManager');

const fakeApp = { getPath: () => process.env.INVALIMON_DATA_DIR, isPackaged: false };

(async () => {
  const paths = makePaths(fakeApp);
  const log = new Logger(paths.logsDir, (ev) => console.log(`  [log ${ev.type}] ${ev.text}`));
  const mm = new ModpackManager({ paths, log, app: fakeApp });
  const manifest = require('../manifest.json');
  const useDev = process.argv.includes('--dev');
  const modeArg = process.argv.find((a) => a.startsWith('--mode='));
  const perfMode = modeArg ? modeArg.split('=')[1] : 'medio';
  const pack = {
    ...manifest.pack,
    extraMods: manifest.extraMods || [],
    clientDefaults: manifest.clientDefaults || null,
    perfModes: manifest.perfModes || null,
    perfMode,
    url: useDev ? manifest.pack.devUrl : manifest.pack.url,
  };
  console.log(`modo de rendimiento: ${perfMode}`);
  console.log(`gameDir: ${paths.gameDir}\npack url: ${pack.url.slice(0, 80)}...`);

  const t0 = Date.now();
  let last = '';
  try {
    const r = await mm.ensurePack({
      pack,
      serverEntry: manifest.server,
      onEvent: (ev) => {
        if (ev.phase !== last || ev.percent % 10 === 0 || ev.phase === 'done') {
          last = ev.phase;
          console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${ev.percent}% ${ev.message}`);
        }
      },
      mode: process.argv.includes('--full') ? 'full' : 'fast',
    });
    console.log(`\nLISTO en ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(r));
  } catch (e) {
    console.error('FALLO:', e.message);
    process.exit(1);
  }
})();
