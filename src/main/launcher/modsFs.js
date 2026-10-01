// Utilidades de archivos de mods: apagar/prender renombrando .jar <-> .jar.disabled.
// Fabric ignora todo lo que no termine en .jar, asi que "apagar" es solo renombrar:
// nunca se borra ni se re-descarga nada.
const fs = require('fs-extra');
const path = require('path');

// Un archivo puede estar "instalado pero apagado" (X.jar.disabled). Cuenta como
// presente para no volver a bajarlo en cada arranque.
function actualPath(dest) {
  for (const p of [dest, `${dest}.disabled`]) {
    try { if (fs.statSync(p).size > 0) return p; } catch (e) {}
  }
  return null;
}

// Devuelve cuantos archivos cambio (0 o 1).
function setDisabled(dir, base, off) {
  const active = path.join(dir, base);
  const disabled = `${active}.disabled`;
  const has = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
  if (off && has(active)) { fs.moveSync(active, disabled, { overwrite: true }); return true; }
  if (!off && has(disabled) && !has(active)) { fs.moveSync(disabled, active, { overwrite: true }); return true; }
  return false;
}

module.exports = { actualPath, setDisabled };
