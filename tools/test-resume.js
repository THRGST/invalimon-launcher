// Prueba los 3 casos de descarga reanudable contra un server local con Range.
const http = require('http');
const fs = require('fs-extra');
const crypto = require('crypto');
const { download } = require('../src/main/launcher/httpClient');

const PAYLOAD = Buffer.alloc(300000);
for (let i = 0; i < PAYLOAD.length; i++) PAYLOAD[i] = (i * 7 + (i >> 3)) & 0xff;
const sha1 = crypto.createHash('sha1').update(PAYLOAD).digest('hex');

let pedidos = 0;
const server = http.createServer((req, res) => {
  pedidos++;
  const range = req.headers.range;
  if (range) {
    const start = parseInt(range.replace('bytes=', ''), 10);
    if (start >= PAYLOAD.length) { res.writeHead(416, { 'Content-Range': `bytes */${PAYLOAD.length}` }); return res.end(); }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`,
      'Content-Length': PAYLOAD.length - start, 'Accept-Ranges': 'bytes',
    });
    return res.end(PAYLOAD.subarray(start));
  }
  res.writeHead(200, { 'Content-Length': PAYLOAD.length, 'Accept-Ranges': 'bytes' });
  res.end(PAYLOAD);
});

const caso = async (nombre, preparar) => {
  const dest = '/tmp/resume-' + nombre.replace(/\W+/g, '_') + '.bin';
  fs.removeSync(dest); fs.removeSync(dest + '.part');
  preparar(dest);
  const antes = pedidos;
  try {
    await download(`http://127.0.0.1:${server.address().port}/f.bin`, dest, { sha1, size: PAYLOAD.length });
    const ok = crypto.createHash('sha1').update(fs.readFileSync(dest)).digest('hex') === sha1;
    console.log(`${ok ? 'OK   ' : 'MAL  '} ${nombre}  (pedidos HTTP: ${pedidos - antes}, archivo: ${ok ? 'correcto' : 'CORRUPTO'})`);
  } catch (e) {
    console.log(`FALLO ${nombre}: ${e.message}`);
  }
  fs.removeSync(dest); fs.removeSync(dest + '.part');
};

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await caso('de cero', () => {});
  await caso('resume a medias', (d) => fs.writeFileSync(d + '.part', PAYLOAD.subarray(0, 120000)));
  await caso('.part completo', (d) => fs.writeFileSync(d + '.part', PAYLOAD));
  await caso('.part completo corrupto', (d) => { const b = Buffer.from(PAYLOAD); b[10] = 0xff; fs.writeFileSync(d + '.part', b); });
  await caso('.part de mas (mas grande que el archivo)', (d) => fs.writeFileSync(d + '.part', Buffer.concat([PAYLOAD, Buffer.alloc(500)])));
  server.close();
})();
