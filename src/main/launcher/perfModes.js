// Modos de rendimiento: aplica al gameDir lo que define manifest.perfModes.
// Todo es idempotente y "solo renombra / solo mergea": no borra ni re-descarga nada.
//
// Semantica de aplicacion (pensada para no pisar al jugador):
// - Mods: union de los modsDisable de TODOS los modos (+ modDisable de clientDefaults,
//   que queda siempre apagado). Se corre en cada arranque: es barato y auto-reparable.
// - options.txt / iris / DH: se aplican cuando cambia el modo; iris tambien cuando el
//   pack se actualiza (los overrides re-extraidos pisan config/iris.properties).
// - Upgrade desde <=1.0.6: ADOPTAR el modo sin tocar archivos (se aplica recien
//   cuando el jugador lo cambia), para no reescribirle los ajustes de golpe.
const fs = require('fs-extra');
const path = require('path');
const { setDisabled } = require('./modsFs');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 'DistantHorizons-*' -> nombres reales presentes en mods/ (soporta .jar y .jar.disabled).
// Los comodines existen para que un update del pack (DistantHorizons-3.3.2 -> 3.3.4)
// no rompa las listas del manifest.
function expandModList(modsDir, entries) {
  const out = new Set();
  let files = [];
  try { files = fs.readdirSync(modsDir); } catch (e) { return out; }
  for (const e of (entries || [])) {
    if (typeof e !== 'string' || !e) continue;
    if (!e.includes('*')) { out.add(e); continue; }
    const rx = new RegExp(`^${e.split('*').map(escapeRegex).join('.*')}$`, 'i');
    for (const f of files) {
      const base = f.endsWith('.disabled') ? f.slice(0, -'.disabled'.length) : f;
      if (rx.test(base)) out.add(base);
    }
  }
  return out;
}

// Estado deseado por archivo: 'on' | 'off'. Los de modDisable (incompatibilidad)
// nunca se prenden, ni aunque un modo no los liste.
function computeDesiredState({ perfModes, mode, modDisable, modsDir }) {
  const modes = (perfModes && perfModes.modes) || {};
  const union = new Set();
  for (const key of Object.keys(modes)) {
    for (const f of expandModList(modsDir, modes[key].modsDisable)) union.add(f);
  }
  const forced = new Set(expandModList(modsDir, modDisable || []));
  for (const f of forced) union.add(f);
  const offInMode = expandModList(modsDir, (modes[mode] || {}).modsDisable);
  const desired = new Map();
  for (const f of union) desired.set(f, (forced.has(f) || offInMode.has(f)) ? 'off' : 'on');
  return desired;
}

// ---- merges de texto (preservan todo lo demas del archivo) ------------------

function formatRaw(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v); // options.txt: strings van sin comillas (renderClouds:false)
}

function formatQuoted(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

// options.txt / iris.properties: lineas clave:valor o clave=valor.
// split /\r?\n/ porque los archivos del pack vienen con CRLF (con split('\n') el
// \r quedaba pegado y la linea no matcheaba: se duplicaban las claves al escribir).
function mergeKeyValueText(text, kv, sep = ':') {
  const s = escapeRegex(sep);
  const rx = new RegExp(`^([A-Za-z0-9_.\\-]+)${s}(.*)$`);
  const pending = new Map(Object.entries(kv).map(([k, v]) => [k, formatRaw(v)]));
  const lines = text ? text.split(/\r?\n/) : [];
  const out = [];
  const escritas = new Set();
  for (const line of lines) {
    const m = line.match(rx);
    if (m && pending.has(m[1])) {
      out.push(`${m[1]}${sep}${pending.get(m[1])}`);
      pending.delete(m[1]);
      escritas.add(m[1]);
    } else if (m && escritas.has(m[1])) {
      // duplicado de una clave que ya reescribimos (artefacto de versiones viejas): se descarta
    } else {
      out.push(line);
    }
  }
  // El split de un archivo terminado en \n deja un '' final: sacarlo para que las
  // claves nuevas no queden despues de una linea en blanco.
  while (out.length && out[out.length - 1] === '') out.pop();
  for (const [k, v] of pending) out.push(`${k}${sep}${v}`);
  return out.length ? `${out.join('\n')}\n` : text;
}

// TOML: reemplaza el valor de claves existentes (conserva indentacion y comentarios).
// Devuelve tambien las claves que no existian (no se agregan: el toml lo maneja el mod).
function mergeTomlKeys(text, kv) {
  let out = text;
  const missing = [];
  for (const [k, v] of Object.entries(kv)) {
    const rx = new RegExp(`^(\\s*${escapeRegex(k)}\\s*=\\s*).*$`, 'm');
    if (rx.test(out)) out = out.replace(rx, `$1${formatQuoted(v)}`);
    else missing.push(k);
  }
  return { text: out, missing };
}

// Lee una clave de un .properties/options sin parser completo.
function readKey(text, key) {
  const m = text.match(new RegExp(`^${escapeRegex(key)}\\s*[:=](.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

// iris.properties guarda el shaderpack por NOMBRE de carpeta o archivo dentro de shaderpacks/.
function shaderpackExists(gameDir, name) {
  if (!name) return false;
  const dir = path.join(gameDir, 'shaderpacks');
  try {
    return fs.existsSync(path.join(dir, name)) || fs.existsSync(path.join(dir, `${name}.zip`));
  } catch (e) {
    return false;
  }
}

// ---- aplicacion ---------------------------------------------------------------

function applyPerfMode({ gameDir, perfModes, perfMode, modDisable, state, versionId, wasFirstInstall, allowApply = true, log }) {
  const modes = (perfModes && perfModes.modes) || {};
  const modeName = modes[perfMode] ? perfMode : null;
  if (!modeName) return { state, applied: [], skipped: 'sin_modo' };
  const mode = modes[modeName];
  const info = (t) => { if (log && typeof log.info === 'function') log.info(t); };
  const warn = (t) => { if (log && typeof log.warn === 'function') log.warn(t); };

  const perf = state.perf || null;
  const files = (perf && perf.files) || {};
  const next = { mode: modeName, packVersionId: versionId, files: { ...files } };

  // Upgrade desde <=1.0.6: adoptar (marcar como aplicado sin tocar archivos).
  if (!perf && !wasFirstInstall) {
    next.files = { mods: true, iris: true, options: true, dh: true };
    info(`Modo de rendimiento ${modeName} adoptado (se aplica cuando lo cambies)`);
    return { state: { ...state, perf: next }, applied: ['adopt'], skipped: null };
  }

  if (!allowApply) {
    info('El juego esta abierto: el modo de rendimiento se aplicara en el proximo arranque');
    return { state, applied: [], skipped: 'juego_abierto' };
  }

  const modeChanged = !perf || perf.mode !== modeName;
  const packChanged = !perf || perf.packVersionId !== versionId;
  const need = {
    iris: modeChanged || packChanged || !files.iris,
    options: modeChanged || !files.options,
    dh: modeChanged || !files.dh,
  };
  const applied = [];

  // 1) Mods (siempre: barato, idempotente y repara estados raros)
  const modsDir = path.join(gameDir, 'mods');
  const desired = computeDesiredState({ perfModes, mode: modeName, modDisable, modsDir });
  let tocados = 0;
  for (const [f, want] of desired) {
    try {
      if (setDisabled(modsDir, f, want === 'off')) tocados++;
    } catch (e) {
      warn(`No pude ${want === 'off' ? 'apagar' : 'prender'} ${f}: ${e.message}`);
    }
  }
  next.files.mods = true;
  if (tocados) {
    applied.push(`mods:${tocados}`);
    info(`Modo ${modeName}: ${tocados} mod(s) ${mode.modsDisable && mode.modsDisable.length ? 'ajustados' : 'restaurados'}`);
  }

  // 2) options.txt (merge: solo pisa las claves que define el modo)
  if (need.options) {
    try {
      const optFile = path.join(gameDir, 'options.txt');
      const prev = fs.existsSync(optFile) ? fs.readFileSync(optFile, 'utf8') : '';
      fs.ensureDirSync(gameDir);
      fs.writeFileSync(optFile, mergeKeyValueText(prev, mode.options || {}));
      next.files.options = true;
      applied.push('options');
      info(`Opciones del modo ${modeName} aplicadas (${Object.keys(mode.options || {}).length} claves)`);
    } catch (e) {
      warn(`No pude escribir options.txt: ${e.message}`);
    }
  }

  // 3) iris.properties (shaders ON/OFF y ajustes). Los overrides del pack lo pisan
  //    en cada update -> por eso tambien se re-aplica cuando cambia el pack.
  if (need.iris) {
    const irisFile = path.join(gameDir, 'config', 'iris.properties');
    if (fs.existsSync(irisFile)) {
      try {
        let txt = fs.readFileSync(irisFile, 'utf8');
        const kv = { ...(mode.irisKeys || {}) };
        if (typeof mode.shaders === 'boolean') kv.enableShaders = mode.shaders;
        // El shaderpack solo se escribe si estamos ENCENDIENDO shaders y no hay uno
        // valido elegido: asi el que el jugador eligio a mano se respeta.
        if (mode.shaders === true && mode.shaderpack) {
          const actual = readKey(txt, 'shaderPack');
          const estabaOff = readKey(txt, 'enableShaders') !== 'true';
          if (estabaOff && !shaderpackExists(gameDir, actual)) kv.shaderPack = mode.shaderpack;
        }
        fs.writeFileSync(irisFile, mergeKeyValueText(txt, kv, '='));
        next.files.iris = true;
        applied.push('iris');
        info(`Shaders: ${mode.shaders ? 'activados' : 'desactivados'} (modo ${modeName})`);
      } catch (e) {
        warn(`No pude escribir iris.properties: ${e.message}`);
      }
    }
  }

  // 4) Distant Horizons. El toml lo crea DH en la primera partida: si no existe,
  //    no marcamos nada y se reintenta en el proximo arranque.
  if (need.dh) {
    if (!mode.dhKeys) {
      next.files.dh = true;
    } else {
      const dhFile = path.join(gameDir, 'config', 'DistantHorizons.toml');
      if (fs.existsSync(dhFile)) {
        try {
          const txt = fs.readFileSync(dhFile, 'utf8');
          const res = mergeTomlKeys(txt, mode.dhKeys);
          if (res.text !== txt) fs.writeFileSync(dhFile, res.text);
          next.files.dh = true;
          applied.push('dh');
          info(`Distant Horizons: ${JSON.stringify(mode.dhKeys)}`);
        } catch (e) {
          warn(`No pude ajustar Distant Horizons: ${e.message}`);
        }
      } else {
        info('Distant Horizons todavia no creo su config: se ajustara tras la primera partida');
      }
    }
  }

  return { state: { ...state, perf: next }, applied, skipped: null };
}

module.exports = {
  applyPerfMode,
  computeDesiredState,
  expandModList,
  mergeKeyValueText,
  mergeTomlKeys,
  shaderpackExists,
};
