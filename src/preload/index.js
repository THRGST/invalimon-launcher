// Puente seguro renderer <-> main (contextIsolation activado).
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('invalimon', {
  getConfig: () => ipcRenderer.invoke('launcher:get-config'),
  saveConfig: (partial) => ipcRenderer.invoke('launcher:save-config', partial),
  getAppVersion: () => ipcRenderer.invoke('launcher:get-app-version'),
  getSystemInfo: () => ipcRenderer.invoke('launcher:get-system-info'),
  getState: () => ipcRenderer.invoke('launcher:get-state'),
  getMods: () => ipcRenderer.invoke('launcher:get-mods'),
  getServerStatus: () => ipcRenderer.invoke('launcher:get-server-status'),
  loginOffline: (username) => ipcRenderer.invoke('launcher:login-offline', username),
  launchGame: () => ipcRenderer.invoke('launcher:launch-game'),
  killGame: () => ipcRenderer.invoke('launcher:kill-game'),
  verifyIntegrity: () => ipcRenderer.invoke('launcher:verify-integrity'),
  openGameDir: () => ipcRenderer.invoke('launcher:open-game-dir'),
  wipeGameDir: () => ipcRenderer.invoke('launcher:wipe-game-dir'),

  getUpdateState: () => ipcRenderer.invoke('launcher:get-update-state'),
  checkUpdates: () => ipcRenderer.invoke('launcher:check-updates'),
  installUpdate: () => ipcRenderer.invoke('launcher:install-update'),

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  onEvent: (cb) => subscribe('launcher:event', cb),
  onLog: (cb) => subscribe('launcher:log', cb),
});
