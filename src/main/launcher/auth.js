// Modo offline (sin licencia): UUID v3 estandar de la comunidad.
// UUID = nameUUIDFromBytes("OfflinePlayer:<name>") = MD5 + bit-tweaks (ver RFC 4122 v3).
// No usar uuid.v3() del paquete uuid: antepone un namespace y NO coincide.
const crypto = require('crypto');

function offlineUUID(username) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + username, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30; // version 3
  h[8] = (h[8] & 0x3f) | 0x80; // variante IETF
  return h.toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

function offlineAuth(username) {
  const name = (username || '').trim() || `Jugador${Math.floor(1000 + Math.random() * 9000)}`;
  const uuid = offlineUUID(name);
  return {
    type: 'offline',
    username: name,
    name, // mclc lee authorization.name para ${auth_player_name}
    uuid,
    // Con online-mode=false el server nunca pide cifrado: el token es irrelevante,
    // solo importa que sea string (mclc lo sustituye en los args).
    access_token: 'null',
    client_token: uuid,
    user_properties: '{}',
    // meta explicito: sin .type no habria --userType en los args
    meta: { type: 'mojang', xuid: '0', clientId: uuid },
  };
}

module.exports = { offlineAuth, offlineUUID };
