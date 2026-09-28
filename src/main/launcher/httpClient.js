// Cliente HTTP con descarga resumible (.part + Range), verificacion de hash
// por streaming, reintentos con backoff y soporte file:// para desarrollo.
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

const RETRY_DELAYS = [1000, 4000, 12000];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function getJson(url, { timeout = 8000, signal } = {}) {
  const res = await axios.get(url, { timeout, signal, headers: { 'User-Agent': 'Invalimon-Launcher' } });
  return res.data;
}

// Descarga un archivo. Soporta reanudacion: si queda un <dest>.part lo continua
// con Range. Verifica sha1/sha512 si se pasan. Renombra solo al final (nunca
// deja un archivo invalido con el nombre definitivo).
async function download(url, dest, opts = {}) {
  const { sha1, sha512, size, onProgress, signal, log } = opts;
  fs.ensureDirSync(path.dirname(dest));

  // Dev/local: copiar desde disco sin red
  if (url.startsWith('file://')) {
    const src = fileURLToPath(url);
    fs.copySync(src, dest);
    await verify(dest, { sha1, sha512 });
    if (onProgress && size) onProgress(size, size);
    return;
  }

  const part = dest + '.part';
  let attempt = 0;
  while (true) {
    try {
      return await downloadOnce(url, dest, part, opts);
    } catch (err) {
      if (signal && signal.aborted) throw new Error('cancelado');
      attempt++;
      if (attempt > RETRY_DELAYS.length) throw err;
      const delay = RETRY_DELAYS[attempt - 1];
      if (log) log.warn(`Fallo descarga (${err.message}), reintento ${attempt} en ${delay / 1000}s: ${path.basename(dest)}`);
      await sleep(delay);
    }
  }
}

async function downloadOnce(url, dest, part, { sha1, sha512, size, onProgress, signal }) {
  let offset = 0;
  try { offset = fs.existsSync(part) ? fs.statSync(part).size : 0; } catch (e) { offset = 0; }

  // El .part ya esta completo (una corrida anterior murio justo al final):
  // pedir "Range: bytes=<tamaño>-" solo devuelve 416, asi que se verifica y se
  // usa tal cual. Si lo que hay no pasa el hash, se tira y se baja de nuevo.
  if (size && offset >= size) {
    try {
      await verify(part, { sha1, sha512 });
      fs.moveSync(part, dest, { overwrite: true });
      if (onProgress) onProgress(size, size);
      return;
    } catch (e) {
      try { fs.removeSync(part); } catch (e2) {}
      offset = 0;
    }
  }

  const headers = { 'User-Agent': 'Invalimon-Launcher' };
  if (offset > 0) headers.Range = `bytes=${offset}-`;

  const res = await axios.get(url, {
    responseType: 'stream', timeout: 30000, signal, headers, maxRedirects: 5,
    validateStatus: (s) => s === 200 || s === 206,
  });

  // Si pedimos Range y respondio 200, ignoro el partial viejo y empiezo de cero
  if (offset > 0 && res.status === 200) {
    offset = 0;
    fs.removeSync(part);
  }

  const total = size || (offset + (parseInt(res.headers['content-length'] || '0', 10) || 0));
  let done = offset;
  // Hash incremental SOLO si la descarga arranca de cero. Al reanudar, el hash
  // cubriria nada mas el tramo nuevo y jamas coincidiria con el del archivo
  // entero: en ese caso verifica verify() al final, sobre todo el archivo.
  const h = offset === 0 ? (sha1 ? crypto.createHash('sha1') : sha512 ? crypto.createHash('sha512') : null) : null;
  const out = fs.createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' });

  await new Promise((resolve, reject) => {
    res.data.on('data', (chunk) => {
      done += chunk.length;
      if (h) h.update(chunk);
      out.write(chunk);
      if (onProgress) onProgress(done, total);
    });
    res.data.on('error', reject);
    out.on('error', reject);
    res.data.on('end', () => out.end(resolve));
  });

  // Verificacion de integridad antes de dar el archivo por bueno
  if (h) {
    const got = h.digest('hex');
    const want = sha1 || sha512;
    if (got !== want) throw new Error(`hash no coincide con ${path.basename(dest)}`);
  } else {
    await verify(part, { sha1, sha512 });
  }

  fs.moveSync(part, dest, { overwrite: true });
}

async function verify(file, { sha1, sha512 }) {
  if (sha1) {
    const got = await hashFile(file, 'sha1');
    if (got !== sha1) throw new Error(`sha1 no coincide con ${path.basename(file)}`);
  }
  if (sha512) {
    const got = await hashFile(file, 'sha512');
    if (got !== sha512) throw new Error(`sha512 no coincide con ${path.basename(file)}`);
  }
}

module.exports = { download, getJson, hashFile, verify };
