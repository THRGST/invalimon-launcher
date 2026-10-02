// Lanza el juego AUTO-CONECTADO al server (quickPlay), para verificar cosas
// visualmente (HUD, mensajes) sin tocar el flujo real del launcher.
// Uso: node tools/test-join.js
const path = require('path');
const fs = require('fs-extra');
const { Client } = require('minecraft-launcher-core');
const { makePaths } = require('../src/main/paths');
const { ensureVersionJson } = require('../src/main/launcher/versionResolver');
const { preloadAssets } = require('../src/main/launcher/assetsPreloader');
const { ensureJava21 } = require('../src/main/launcher/javaFinder');
const { offlineAuth } = require('../src/main/launcher/auth');

process.env.INVALIMON_DATA_DIR = process.env.INVALIMON_DATA_DIR || '/home/thrg/.config/Invalimon';
const ADDRESS = process.env.INVALIMON_TEST_ADDR || 'carolyn-archery.tun.ply.gg';
const fakeApp = { getPath: () => '/tmp', isPackaged: false };

(async () => {
  const paths = makePaths(fakeApp);
  const state = fs.readJsonSync(path.join(paths.gameDir, '.invalimon', 'state.json'));
  const mc = state.pack.mc;
  const loader = state.pack.loader;
  const username = 'DevThiago';
  console.log(`join test: ${username} -> ${ADDRESS} (mc ${mc})`);

  const { profileId, versionJson } = await ensureVersionJson({ gameDir: paths.gameDir, mc, loader, log: { info: () => {}, warn: console.warn } });
  const vanilla = fs.readJsonSync(versionJson);
  await preloadAssets({ gameDir: paths.gameDir, vanilla, profileId, log: { info: () => {}, warn: console.warn } });
  const javaPath = await ensureJava21({ gameDir: paths.gameDir, log: { info: console.log, warn: console.warn } });

  const launcher = new Client();
  launcher.on('debug', (e) => { const s = String(e); if (/error/i.test(s)) console.log('[debug]', s.slice(0, 160)); });
  launcher.on('data', (e) => {
    const line = e.toString();
    if (/Setting user|Connecting|Loaded \d+ mods|joined the game/i.test(line)) console.log('|', line.trim().slice(0, 160));
  });
  launcher.on('close', (code) => { console.log('juego cerrado', code); process.exit(0); });

  await launcher.launch({
    clientPackage: null,
    authorization: offlineAuth(username),
    root: paths.gameDir,
    version: { number: mc, type: 'release', custom: profileId },
    overrides: { versionJson },
    memory: { max: '4096M', min: '2048M' },
    javaPath,
    customArgs: ['-DFabricMcEmu=net.minecraft.client.main.Main'],
    window: { width: 1280, height: 720, fullscreen: false },
    quickPlay: { type: 'multiplayer', identifier: ADDRESS },
  });
  console.log('lanzado, esperando join...');
  setInterval(() => {}, 60000);
})();
