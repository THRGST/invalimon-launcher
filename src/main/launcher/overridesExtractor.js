// Extrae overrides/ de un .mrpack con yauzl en streaming (no carga el zip en RAM).
// Guards: zip-slip, rutas absolutas y ":" (ADS de Windows). Nunca borra nada.
const yauzl = require('yauzl');
const fs = require('fs-extra');
const path = require('path');

const PREFIX = 'overrides/';

function countOverrideEntries(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let n = 0;
      zip.on('entry', (entry) => {
        if (entry.fileName.startsWith(PREFIX) && !/\/$/.test(entry.fileName)) n++;
        zip.readEntry();
      });
      zip.on('end', () => resolve(n));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// Devuelve { extracted, skipped } y va reportando progreso por archivos.
async function extractOverrides(zipPath, destDir, { onProgress, signal, log } = {}) {
  const total = await countOverrideEntries(zipPath);
  const destRoot = path.resolve(destDir);
  let extracted = 0;
  let skipped = 0;

  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);

      const next = () => zip.readEntry();

      zip.on('entry', (entry) => {
        if (signal && signal.aborted) { zip.close(); return reject(new Error('cancelado')); }
        if (!entry.fileName.startsWith(PREFIX) || /\/$/.test(entry.fileName)) return next();

        const rel = entry.fileName.slice(PREFIX.length);
        // Guards de seguridad
        if (rel.includes('\\') || rel.includes(':')) { skipped++; return next(); }
        const dest = path.resolve(destRoot, ...rel.split('/'));
        if (!(dest === destRoot || dest.startsWith(destRoot + path.sep))) {
          if (log) log.warn(`Entrada fuera del gameDir, ignorada: ${entry.fileName}`);
          skipped++;
          return next();
        }

        fs.ensureDirSync(path.dirname(dest));
        zip.openReadStream(entry, (err2, rs) => {
          if (err2) { skipped++; return next(); }
          const ws = fs.createWriteStream(dest);
          rs.pipe(ws);
          ws.on('close', () => {
            extracted++;
            if (onProgress && (extracted % 25 === 0 || extracted === total)) {
              onProgress(extracted, total);
            }
            next();
          });
          ws.on('error', (e) => { if (log) log.warn(`Error escribiendo ${dest}: ${e.message}`); skipped++; next(); });
        });
      });

      zip.on('end', resolve);
      zip.on('error', reject);
      next();
    });
  });

  return { extracted, skipped, total };
}

module.exports = { extractOverrides, countOverrideEntries };
