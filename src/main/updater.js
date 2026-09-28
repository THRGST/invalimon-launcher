// Auto-actualizacion del launcher (electron-updater + releases de GitHub).
//
// Regla de oro: NUNCA molestar. Si el chequeo falla (sin internet, sin releases
// todavia, repo mal configurado) se anota en el log y la app sigue igual.
// Flujo: busca al arrancar -> baja solo en segundo plano -> avisa en la UI con
// boton "Reiniciar e instalar". Si el jugador no lo toca, se aplica al cerrar.
const { app } = require('electron');

const FIRST_CHECK_DELAY_MS = 12 * 1000;      // deja asentar la UI primero
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // y despues cada 4 h (sesiones largas)

class Updater {
  constructor({ log, onEvent }) {
    this.log = log;
    this.onEvent = onEvent;
    this.autoUpdater = null;
    this.timer = null;
    this.state = { state: 'idle', version: null, percent: 0, error: null };
  }

  emit(patch) {
    this.state = { ...this.state, ...patch };
    if (this.onEvent) this.onEvent(this.state);
  }

  getState() { return this.state; }

  init() {
    // En desarrollo electron-updater no tiene app-update.yml: se saltea.
    // INVALIMON_FORCE_UPDATE_CHECK=1 lo fuerza (con dev-app-update.yml) para probar.
    if (!app.isPackaged && !process.env.INVALIMON_FORCE_UPDATE_CHECK) {
      this.log.info('Auto-update: desactivado en desarrollo');
      return;
    }

    let autoUpdater;
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (e) {
      this.log.warn(`Auto-update: electron-updater no esta disponible (${e.message})`);
      return;
    }
    this.autoUpdater = autoUpdater;

    autoUpdater.logger = this.log;
    autoUpdater.autoDownload = true;         // baja en segundo plano mientras juegan
    autoUpdater.autoInstallOnAppQuit = true; // si no aceptan, se aplica al cerrar

    autoUpdater.on('checking-for-update', () => this.emit({ state: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => {
      this.log.info(`Auto-update: hay version nueva ${info && info.version}, bajando...`);
      this.emit({ state: 'available', version: (info && info.version) || null, error: null });
    });
    autoUpdater.on('update-not-available', () => this.emit({ state: 'none', percent: 0, error: null }));
    autoUpdater.on('download-progress', (p) => this.emit({ state: 'downloading', percent: Math.round((p && p.percent) || 0) }));
    autoUpdater.on('update-downloaded', (info) => {
      this.log.info(`Auto-update: ${info && info.version} lista para instalar`);
      this.emit({ state: 'ready', version: (info && info.version) || null, percent: 100, error: null });
    });
    autoUpdater.on('error', (err) => {
      const msg = (err && err.message) || String(err);
      this.log.warn(`Auto-update: ${msg}`);
      this.emit({ state: 'error', error: msg });
    });

    this.firstCheck = setTimeout(() => this.check(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  async check() {
    if (!this.autoUpdater) return { ok: false, error: 'Auto-update desactivado' };
    // Si ya hay una descarga en curso o una lista para instalar, no molestar
    if (this.state.state === 'downloading' || this.state.state === 'ready') return { ok: true, ...this.state };
    try {
      this.emit({ state: 'checking', error: null });
      await this.autoUpdater.checkForUpdates();
      return { ok: true, ...this.state };
    } catch (e) {
      this.emit({ state: 'error', error: e.message });
      this.log.warn(`Auto-update: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  install() {
    if (!this.autoUpdater || this.state.state !== 'ready') {
      return { ok: false, error: 'No hay actualizacion lista' };
    }
    // El juego puede seguir abierto: cerrar el launcher no lo mata.
    this.log.info('Auto-update: instalando y reiniciando...');
    setTimeout(() => {
      try { this.autoUpdater.quitAndInstall(); }
      catch (e) { this.log.error(`Auto-update: no pude instalar (${e.message})`); }
    }, 150);
    return { ok: true };
  }
}

module.exports = { Updater };
