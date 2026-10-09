// Persistencia de launcher-config.json (settings + user).
// Merge POR SECCIONES: guardar {settings} no debe pisar {user}.
const fs = require('fs-extra');
const os = require('os');

// RAM por defecto segun la maquina: deja aire para el sistema (en una PC de
// 8 GB, pedir 6 GB de heap termina en swap y el juego va a tirones).
// Solo aplica a instalaciones nuevas: si ya hay config guardada, manda la del user.
// totalBytes opcional para que el escaner pueda calcular con datos ya medidos.
function autoRamMax(totalBytes) {
  const gb = (typeof totalBytes === 'number' && totalBytes > 0 ? totalBytes : os.totalmem()) / 1073741824;
  if (gb >= 20) return 8192;
  if (gb >= 12) return 6144;
  if (gb >= 8) return 4096;
  return 3072;
}

const DEFAULTS = {
  user: { type: 'offline', username: '', uuid: '' },
  settings: {
    ramMin: 2048,
    ramMax: autoRamMax(),
    javaPath: 'auto',
    customJvmArgs: '',
    fullscreen: false,
    resolutionWidth: 1280,
    resolutionHeight: 720,
    serverAddress: '', // vacio = usar la del manifest remoto
    gc: 'auto', // 'auto' = ZGC (lo recomienda Distant Horizons); 'g1' para volver atras
    perfMode: 'medio', // 'alto' | 'medio' | 'minimo' (ver perfModes del manifest)
    // LEGACY: lo lee el launcher <=1.0.6. En >=1.0.7 se deriva de perfMode.
    lightMode: false,
  },
};

class ConfigManager {
  constructor(configFile) {
    this.configFile = configFile;
    this.isFirstRun = !fs.existsSync(configFile);
    this.config = this.load();
  }

  load() {
    let data = {};
    try {
      if (fs.existsSync(this.configFile)) data = fs.readJsonSync(this.configFile);
    } catch (e) { data = {}; }
    const settings = { ...DEFAULTS.settings, ...(data.settings || {}) };
    // Migracion <=1.0.6 -> >=1.0.7: el checkbox "Modo ligero" pasa a ser el modo minimo.
    if (settings.lightMode === true && !(data.settings || {}).perfMode) settings.perfMode = 'minimo';
    return {
      ...DEFAULTS,
      ...data,
      user: { ...DEFAULTS.user, ...(data.user || {}) },
      settings,
    };
  }

  get() { return { ...this.config, isFirstRun: this.isFirstRun }; }

  save(partial) {
    const next = { ...this.config, ...partial };
    if (partial.user) next.user = { ...this.config.user, ...partial.user };
    if (partial.settings) next.settings = { ...this.config.settings, ...partial.settings };
    // Derivado para que un rollback a un launcher viejo siga coherente.
    next.settings.lightMode = next.settings.perfMode === 'minimo';
    this.config = next;
    fs.ensureDirSync(require('path').dirname(this.configFile));
    fs.writeJsonSync(this.configFile, this.config, { spaces: 2 });
    this.isFirstRun = false;
    return this.get();
  }
}

module.exports = { ConfigManager, DEFAULTS, autoRamMax };
