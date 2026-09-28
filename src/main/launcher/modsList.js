// Lista los mods instalados leyendo el nombre real de cada jar (fabric.mod.json),
// con cache en disco para no releer 137 zips en cada arranque.
const fs = require('fs-extra');
const path = require('path');
const yauzl = require('yauzl');

// Algunos fabric.mod.json traen saltos de linea literales dentro de strings
// (JSON no estricto: Gson lo tolera, JSON.parse no). Sanear los control chars
// antes de rendirse, asi no perdemos nombre/id de esos mods.
function parseFabricJson(text) {
  try { return JSON.parse(text); } catch (e) {
    try { return JSON.parse(text.replace(/[\u0000-\u001f]/g, ' ')); } catch (e2) { return null; }
  }
}

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
            resolve(parseFabricJson(Buffer.concat(chunks).toString('utf8')));
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

// Asigna a cada mod la seccion que define el manifest y marca los extras de
// Invalimon. Se aplica DESPUES del cache: cambiar las secciones es solo editar
// el manifest, sin obligar a releer los 153 jars.
function applyModSections(mods, sections, extraFiles) {
  const byId = new Map();
  (sections || []).forEach((s, i) => {
    for (const id of (s.mods || [])) byId.set(String(id).toLowerCase(), { title: s.title, idx: i });
  });
  const extras = new Set((extraFiles || []).map((f) => String(f).toLowerCase()));
  const sectionIdx = (m) => {
    const hit = byId.get(String(m.id).toLowerCase());
    return hit ? hit.idx : 9999; // los no listados van al final, en "Otros"
  };
  const out = mods.map((m) => {
    const hit = byId.get(String(m.id).toLowerCase());
    return { ...m, section: hit ? hit.title : 'Otros', extra: extras.has(m.file.toLowerCase()) };
  });
  out.sort((a, b) => (sectionIdx(a) - sectionIdx(b)) || a.name.localeCompare(b.name, 'es'));
  return out;
}

async function listMods({ gameDir, cacheDir, log, sections, extraFiles }) {
  const modsDir = path.join(gameDir, 'mods');
  let files = [];
  try {
    files = fs.readdirSync(modsDir).filter((f) => f.toLowerCase().endsWith('.jar')).sort();
  } catch (e) {
    return [];
  }

  // v2: parseo tolerante (ver parseFabricJson) - invalida caches viejos con ids fallidos
  const fingerprint = `v2|${files.join('|')}`;
  const cacheFile = cacheDir ? path.join(cacheDir, 'mods-list.json') : null;
  if (cacheFile) {
    try {
      const cached = fs.readJsonSync(cacheFile);
      if (cached && cached.fingerprint === fingerprint) {
        return applyModSections(cached.mods, sections, extraFiles);
      }
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
  return applyModSections(mods, sections, extraFiles);
}

module.exports = { listMods };
