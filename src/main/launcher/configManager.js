// Persistencia de launcher-config.json (settings + user).
// Merge POR SECCIONES: guardar {settings} no debe pisar {user}.
const fs = require('fs-extra');

const DEFAULTS = {
  user: { type: 'offline', username: '', uuid: '' },
  settings: {
    ramMin: 2048,
    ramMax: 6144,
    javaPath: 'auto',
    customJvmArgs: '',
    fullscreen: false,
    resolutionWidth: 1280,
    resolutionHeight: 720,
    serverAddress: '', // vacio = usar la del manifest remoto
  },
};

class ConfigManager {
  constructor(configFile) {
    this.configFile = configFile;
    this.config = this.load();
  }

  load() {
    let data = {};
    try {
      if (fs.existsSync(this.configFile)) data = fs.readJsonSync(this.configFile);
    } catch (e) { data = {}; }
    return {
      ...DEFAULTS,
      ...data,
      user: { ...DEFAULTS.user, ...(data.user || {}) },
      settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
    };
  }

  get() { return this.config; }

  save(partial) {
    const next = { ...this.config, ...partial };
    if (partial.user) next.user = { ...this.config.user, ...partial.user };
    if (partial.settings) next.settings = { ...this.config.settings, ...partial.settings };
    this.config = next;
    fs.ensureDirSync(require('path').dirname(this.configFile));
    fs.writeJsonSync(this.configFile, this.config, { spaces: 2 });
    return this.config;
  }
}

module.exports = { ConfigManager, DEFAULTS };
