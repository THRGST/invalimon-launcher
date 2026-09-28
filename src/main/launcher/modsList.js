// Lista los mods instalados leyendo el nombre real de cada jar (fabric.mod.json),
// con cache en disco para no releer 137 zips en cada arranque.
const fs = require('fs-extra');
const path = require('path');
const yauzl = require('yauzl');

function readFabricMeta(jarPath) {
  return new Promise((resolve) => {
    yauzl.open(jarPath, { lazyEntries: true }, (err, zip) => {
      if (err) return resolve(null);
      let done = false;
      zip.on('entry', (entry) => {
        if (done) return zip.readEntry();
        if (entry.fileName !== 'fabric.mod.json') return zip.readEntry();
        done = true;
        zip.openReadStream(entry, (e2, rs) => {
          if (e2) { zip.close(); return resolve(null); }
          const chunks = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (e) { resolve(null); }
            zip.close();
          });
          rs.on('error', () => { zip.close(); resolve(null); });
        });
      });
      zip.on('end', () => { if (!done) resolve(null); });
      zip.on('error', () => resolve(null));
      zip.readEntry();
    });
  });
}

// Fallback: limpiar el nombre del archivo (sacar versiones y sufijos tecnicos)
function cleanFileName(file) {
  return file
    .replace(/\.jar$/i, '')
    .replace(/[-_](fabric|forge|neoforge|quilt)/gi, '')
    .replace(/[-_]mc?1\.\d+(\.\d+)?/gi, '')
    .replace(/[-_]v?\d+[\d.+_-]*$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || file;
}

async function listMods({ gameDir, cacheDir, log }) {
  const modsDir = path.join(gameDir, 'mods');
  let files = [];
  try {
    files = fs.readdirSync(modsDir).filter((f) => f.toLowerCase().endsWith('.jar')).sort();
  } catch (e) {
    return [];
  }

  const fingerprint = files.join('|');
  const cacheFile = cacheDir ? path.join(cacheDir, 'mods-list.json') : null;
  if (cacheFile) {
    try {
      const cached = fs.readJsonSync(cacheFile);
      if (cached && cached.fingerprint === fingerprint) return cached.mods;
    } catch (e) {}
  }

  const mods = [];
  for (const f of files) {
    const meta = await readFabricMeta(path.join(modsDir, f));
    mods.push({
      file: f,
      id: meta && meta.id ? String(meta.id) : f.replace(/\.jar$/i, ''),
      name: meta && meta.name ? String(meta.name) : cleanFileName(f),
      version: meta && meta.version ? String(meta.version) : '',
    });
  }
  mods.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  if (cacheFile) {
    try {
      fs.ensureDirSync(path.dirname(cacheFile));
      fs.writeJsonSync(cacheFile, { fingerprint, mods });
    } catch (e) {}
  }
  if (log) log.info(`Lista de mods: ${mods.length} (leidos de los jars)`);
  return mods;
}

module.exports = { listMods };
