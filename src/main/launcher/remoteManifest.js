// Manifest remoto: config del launcher (direccion del server, version del pack)
// que se puede cambiar SIN recompilar.
// Cadena: red -> cache en disco -> manifest.default.json embebido.
const fs = require('fs-extra');
const path = require('path');
const { getJson } = require('./httpClient');

// TODO(release): apuntar al repo real cuando exista
const MANIFEST_URL = process.env.INVALIMON_MANIFEST_URL
  || 'https://raw.githubusercontent.com/thiago/invalimon-launcher/main/manifest.json';

class RemoteManifest {
  constructor({ paths, app, log }) {
    this.paths = paths;
    this.app = app;
    this.log = log;
  }

  defaultManifestPath() {
    const candidates = [
      this.app && this.app.isPackaged ? path.join(process.resourcesPath, 'manifest.default.json') : null,
      path.join(__dirname, '..', '..', '..', 'manifest.json'),
    ].filter(Boolean);
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return null;
  }

  async get() {
    // Dev (sin empaquetar): mandar siempre el manifest local para poder iterar
    // sin que un cache viejo lo enmascare
    if (this.app && !this.app.isPackaged) {
      const local = this.defaultManifestPath();
      if (local) return fs.readJsonSync(local);
    }

    // 1) red
    try {
      const data = await getJson(MANIFEST_URL, { timeout: 6000 });
      if (data && data.schema === 1) {
        fs.ensureDirSync(path.dirname(this.paths.cacheManifest));
        fs.writeJsonSync(this.paths.cacheManifest, data, { spaces: 2 });
        return data;
      }
    } catch (e) { /* sin red o sin repo todavia */ }

    // 2) cache
    try {
      if (fs.existsSync(this.paths.cacheManifest)) {
        const data = fs.readJsonSync(this.paths.cacheManifest);
        if (data && data.schema === 1) return data;
      }
    } catch (e) {}

    // 3) default embebido
    const def = this.defaultManifestPath();
    if (def) return fs.readJsonSync(def);
    throw new Error('No hay manifest remoto, cache ni default');
  }

  // En dev (sin empaquetar) usar devUrl (file://) para iterar sin bajar 228 MB
  packUrl(manifest) {
    const p = manifest.pack;
    if (!this.app || !this.app.isPackaged) return p.devUrl || p.url;
    return p.url;
  }

  serverAddress(manifest, override) {
    return (override && override.trim()) || manifest.server.address;
  }
}

module.exports = { RemoteManifest };
