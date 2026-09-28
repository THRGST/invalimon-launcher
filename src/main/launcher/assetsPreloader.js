// Precarga de assets del CDN de Mojang (concurrencia), y escribe el ALIAS del
// indice con el nombre del perfil Fabric: assets/indexes/<profileId>.json.
// (El juego busca --assetIndex <profileId>; AiroMC escribe el id vanilla y por
// eso re-descarga el indice cada vez.)
const fs = require('fs-extra');
const path = require('path');
const { download, getJson } = require('./httpClient');

const CDN = 'https://resources.download.minecraft.net';
const CONCURRENCY = 24;

async function preloadAssets({ gameDir, vanilla, profileId, onProgress, signal, log }) {
  const idxInfo = vanilla.assetIndex;
  if (!idxInfo || !idxInfo.url) return { downloaded: 0, total: 0 };

  const indexesDir = path.join(gameDir, 'assets', 'indexes');
  const objectsDir = path.join(gameDir, 'assets', 'objects');
  fs.ensureDirSync(indexesDir);

  const idxFile = path.join(indexesDir, `${idxInfo.id}.json`);
  if (!fs.existsSync(idxFile)) {
    const data = await getJson(idxInfo.url, { signal });
    fs.writeJsonSync(idxFile, data, { spaces: 2 });
  }
  // Alias con el nombre del perfil (lo que buscará el juego)
  const alias = path.join(indexesDir, `${profileId}.json`);
  if (!fs.existsSync(alias)) fs.copySync(idxFile, alias);

  const index = fs.readJsonSync(idxFile);
  const objects = Object.entries(index.objects || {});

  // Faltantes (o de tamano 0)
  const missing = [];
  for (const [name, obj] of objects) {
    const sub = obj.hash.slice(0, 2);
    const dest = path.join(objectsDir, sub, obj.hash);
    try {
      const st = fs.statSync(dest);
      if (st.size === obj.size) continue;
    } catch (e) {}
    missing.push({ hash: obj.hash, sub });
  }
  if (!missing.length) return { downloaded: 0, total: objects.length };

  if (log) log.info(`Assets: ${missing.length} de ${objects.length} para bajar`);

  let done = 0;
  let idx = 0;
  const worker = async () => {
    while (idx < missing.length) {
      if (signal && signal.aborted) return;
      const m = missing[idx++];
      const dest = path.join(objectsDir, m.sub, m.hash);
      try {
        await download(`${CDN}/${m.sub}/${m.hash}`, dest, { signal, log });
      } catch (e) { /* se completa en la proxima corrida o los baja mclc */ }
      done++;
      if (onProgress && (done % 40 === 0 || done === missing.length)) onProgress(done, missing.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));

  return { downloaded: missing.length, total: objects.length };
}

module.exports = { preloadAssets };
