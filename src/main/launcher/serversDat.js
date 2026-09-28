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
  if (iconB64) entry.icon = { type: 'string', value: iconB64 };
  const root = {
    type: 'compound',
    name: '',
    value: { servers: { type: 'list', value: { type: 'compound', value: [entry] } } },
  };
  return nbt.writeUncompressed(root, 'big');
}

async function patchServersDat({ gameDir, name, address, log }) {
  const patched = [];
  for (const parts of TARGETS) {
    const file = path.join(gameDir, ...parts);
    if (!fs.existsSync(file)) continue;
    try {
      const buf = fs.readFileSync(file);
      const { parsed } = await nbt.parse(buf);
      const simple = nbt.simplify(parsed);
      const first = simple && simple.servers && simple.servers[0];
      const icon = first && typeof first.icon === 'string' ? first.icon : undefined;
      fs.writeFileSync(file, buildServersDat(name, address, icon));
      patched.push(parts.join('/'));
    } catch (e) {
      if (log) log.warn(`No pude parchear ${parts.join('/')}: ${e.message}`);
    }
  }
  return patched;
}

module.exports = { patchServersDat, buildServersDat };
