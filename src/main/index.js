// Proceso principal: ventana frameless + IPC + orquestacion.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');

const { makePaths } = require('./paths');
const { Logger } = require('./logger');
const { ConfigManager } = require('./launcher/configManager');
const { RemoteManifest } = require('./launcher/remoteManifest');
const { LaunchEngine } = require('./launcher/engine');
const { offlineAuth } = require('./launcher/auth');
const { listMods } = require('./launcher/modsList');
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
  ipcMain.handle('launcher:save-config', (_e, partial) => configManager.save(partial || {}));

  ipcMain.handle('launcher:get-state', async () => {
    const pack = await engine.manager.currentPackInfo();
    return { running: engine.isRunning, pack, dataDir: paths.dataDir, gameDir: paths.gameDir };
  });

  ipcMain.handle('launcher:get-mods', async () => {
    try {
      return await listMods({ gameDir: paths.gameDir, cacheDir: paths.cacheDir, log: logger });
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
