// Estado del server en vivo: hace el "Server List Ping" (el mismo protocolo que
// usa la lista de Multijugador) y devuelve online/jugadores/MOTD/latencia.
const net = require('net');

const PROTOCOL = 767; // 1.21.1
const DEFAULT_PORT = 25565;

function encodeVarInt(n) {
  const out = [];
  let v = n >>> 0;
  for (;;) {
    if ((v & ~0x7f) === 0) { out.push(v); break; }
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(out);
}

function readVarInt(buf, off) {
  let v = 0, size = 0;
  for (;;) {
    if (off + size >= buf.length) return null;
    const b = buf[off + size];
    v |= (b & 0x7f) << (7 * size);
    size++;
    if (size > 5) return null;
    if ((b & 0x80) === 0) break;
  }
  return { value: v >>> 0, size };
}

function descToText(desc) {
  if (!desc) return '';
  let out;
  if (typeof desc === 'string') out = desc;
  else {
    out = desc.text || '';
    for (const e of Array.isArray(desc.extra) ? desc.extra : []) {
      out += typeof e === 'string' ? e : (e.text || '');
    }
  }
  return String(out).replace(/§./g, '').trim();
}

// host puede ser "ejemplo.com" o "ejemplo.com:1234"
function splitAddress(address) {
  const s = String(address || '').trim();
  const i = s.lastIndexOf(':');
  if (i > 0 && /^\d+$/.test(s.slice(i + 1))) {
    return { host: s.slice(0, i), port: parseInt(s.slice(i + 1), 10) };
  }
  return { host: s, port: DEFAULT_PORT };
}

function ping(address, timeout = 6000) {
  const { host, port } = splitAddress(address);
  if (!host) return Promise.resolve({ online: false, error: 'Sin dirección de server' });

  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false;
    const sock = net.connect({ host, port });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ online: false, error: 'Sin respuesta (timeout)' }), timeout);

    sock.on('error', (e) => finish({
      online: false,
      error: e.code === 'ENOTFOUND' ? 'No encuentro esa dirección' : (e.code || e.message),
    }));

    sock.on('connect', () => {
      const h = Buffer.from(host, 'utf8');
      const p = Buffer.alloc(2); p.writeUInt16BE(port);
      // handshake (nextState=1: status) + status request
      const hs = Buffer.concat([
        Buffer.from([0x00]), encodeVarInt(PROTOCOL), encodeVarInt(h.length), h, p, Buffer.from([0x01]),
      ]);
      sock.write(Buffer.concat([encodeVarInt(hs.length), hs]));
      sock.write(Buffer.concat([encodeVarInt(1), Buffer.from([0x00])]));
    });

    let acc = Buffer.alloc(0);
    sock.on('data', (d) => {
      acc = Buffer.concat([acc, d]);
      const len = readVarInt(acc, 0);
      if (!len || acc.length < len.size + len.value) return; // falta data
      const body = acc.subarray(len.size, len.size + len.value);
      const pid = readVarInt(body, 0);
      if (!pid || pid.value !== 0) return finish({ online: false, error: 'Respuesta inesperada' });
      const sl = readVarInt(body, pid.size);
      if (!sl) return finish({ online: false, error: 'Respuesta incompleta' });
      const json = body.subarray(pid.size + sl.size, pid.size + sl.size + sl.value).toString('utf8');
      try {
        const s = JSON.parse(json);
        finish({
          online: true,
          latencyMs: Date.now() - t0,
          motd: descToText(s.description),
          onlineCount: (s.players && s.players.online) || 0,
          maxCount: (s.players && s.players.max) || 0,
          version: (s.version && s.version.name) || '',
        });
      } catch (e) {
        finish({ online: false, error: 'No pude leer la respuesta' });
      }
    });
  });
}

module.exports = { ping, splitAddress };
