// Parchea servers.dat (NBT sin comprimir) para dejar SOLO la entrada de Invalimon.
// OJO: hay que tocar las DOS rutas (el mod DefaultOptions restaura la copia de config/).
const nbt = require('prismarine-nbt');
const fs = require('fs-extra');
const path = require('path');

const TARGETS = [
  ['servers.dat'],
  ['config', 'defaultoptions', 'servers.dat'],
];

function buildServersDat(name, address, iconB64) {
  const entry = {
    name: { type: 'string', value: name },
    ip: { type: 'string', value: address },
    acceptTextures: { type: 'byte', value: 1 },
  };
  if (iconB64) {
    // OJO 1: en servers.dat el icono es un ByteArray con el PNG CRUDO.
    // Escribirlo como string (base64) lo dejaba invisible para el juego.
    // OJO 2: prismarine-nbt escribe los bytes como i8 (signed): hay que pasar
    // los >127 como negativos o explota con "value out of range". El binario
    // resultante es identico (0x89 == -119).
    const bytes = Buffer.from(String(iconB64), 'base64');
    if (bytes.length) {
      entry.icon = {
        type: 'byteArray',
        value: Array.from(bytes, (b) => (b > 127 ? b - 256 : b)),
      };
    }
  }
  const root = {
    type: 'compound',
    name: '',
    value: { servers: { type: 'list', value: { type: 'compound', value: [entry] } } },
  };
  return nbt.writeUncompressed(root, 'big');
}

async function patchServersDat({ gameDir, name, address, iconB64, log }) {
  const patched = [];
  for (const parts of TARGETS) {
    const file = path.join(gameDir, ...parts);
    if (!fs.existsSync(file)) continue;
    try {
      const buf = fs.readFileSync(file);
      const { parsed } = await nbt.parse(buf);
      const simple = nbt.simplify(parsed);
      const first = simple && simple.servers && simple.servers[0];
      // iconB64 (manifest) manda; si no hay, se conserva el que ya tenia el archivo
      const existing = first && first.icon;
      const icon = iconB64
        || (Buffer.isBuffer(existing) ? existing.toString('base64')
          : Array.isArray(existing) ? Buffer.from(existing.map((b) => (b < 0 ? b + 256 : b))).toString('base64')
            : (typeof existing === 'string' ? existing : undefined));
      fs.writeFileSync(file, buildServersDat(name, address, icon));
      patched.push(parts.join('/'));
    } catch (e) {
      if (log) log.warn(`No pude parchear ${parts.join('/')}: ${e.message}`);
    }
  }
  return patched;
}

module.exports = { patchServersDat, buildServersDat };
