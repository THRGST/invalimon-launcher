// Test de los modos de rendimiento (sin UI, sin juego): union-apply de mods,
// merges de options/iris/DH, respeto del shaderpack elegido y caso "adopt" del
// upgrade. Corre contra un gameDir temporal con jars falsos.
// Uso: node tools/test-modes.js
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { applyPerfMode, mergeKeyValueText, mergeTomlKeys } = require('../src/main/launcher/perfModes');

const manifest = require('../manifest.json');
const perfModes = manifest.perfModes;
const modDisable = ['effective-2.4.8-1.21.1.jar'];

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${name}: ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(want)})`}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-modes-'));
const gameDir = path.join(tmp, 'game');
const modsDir = path.join(gameDir, 'mods');
const isOff = (f) => fs.existsSync(path.join(modsDir, `${f}.disabled`));
const isOn = (f) => fs.existsSync(path.join(modsDir, f));

const JARS = [
  'DistantHorizons-3.3.2-1.21.1-fabric-neoforge.jar',
  'visuality-0.7.7+1.21.jar',
  'punchy-2.8b-fabric-1.21.1.jar',
  'sodium-fabric-0.6.0.jar',
  'effective-2.4.8-1.21.1.jar', // modDisable: apagado SIEMPRE
];
fs.ensureDirSync(modsDir);
fs.ensureDirSync(path.join(gameDir, 'config'));
fs.ensureDirSync(path.join(gameDir, 'shaderpacks', 'COBBLEVERSE - Shaders'));
for (const f of JARS) fs.writeFileSync(path.join(modsDir, f), 'x');
fs.writeFileSync(path.join(gameDir, 'options.txt'), 'version:3955\nrenderDistance:32\nfoo:bar\n');
fs.writeFileSync(path.join(gameDir, 'config', 'iris.properties'),
  'enableShaders=true\nshaderPack=COBBLEVERSE - Shaders\nmaxShadowRenderDistance=20\n');
fs.writeFileSync(path.join(gameDir, 'config', 'DistantHorizons.toml'),
  '[client]\n\tlodChunkRenderDistanceRadius = 512\n');

console.log('--- merge puro ---');
check('merge options sin duplicar', mergeKeyValueText('version:3955\nrenderDistance:32\n', { renderDistance: 6, particles: 2 }),
  'version:3955\nrenderDistance:6\nparticles:2\n');
check('merge con CRLF (archivos del pack)', mergeKeyValueText('enableShaders=false\r\nfoo=1\r\n', { enableShaders: true }, '='),
  'enableShaders=true\nfoo=1\n');
check('merge sanea duplicados viejos', mergeKeyValueText('a=1\na=2\n', { a: 3 }, '='), 'a=3\n');
check('merge toml respeta indentacion y reporta faltantes', mergeTomlKeys('\tfoo = 1\nbar = "A"\n', { foo: 7, nope: 3 }),
  { text: '\tfoo = 7\nbar = "A"\n', missing: ['nope'] });

console.log('\n--- instalacion nueva en modo minimo ---');
let state = { }; // sin perf y sin clientDefaultsApplied => first install
let res = applyPerfMode({
  gameDir, perfModes, perfMode: 'minimo', modDisable, state,
  versionId: '1.7.42', wasFirstInstall: true, allowApply: true,
  log: { info: (t) => console.log(`   [info] ${t}`), warn: (t) => console.log(`   [warn] ${t}`) },
});
state = res.state;
check('DH apagado', isOff('DistantHorizons-3.3.2-1.21.1-fabric-neoforge.jar'), true);
check('visuality apagado', isOff('visuality-0.7.7+1.21.jar'), true);
check('punchy apagado', isOff('punchy-2.8b-fabric-1.21.1.jar'), true);
check('sodium sigue prendido', isOn('sodium-fabric-0.6.0.jar'), true);
check('effective apagado por modDisable', isOff('effective-2.4.8-1.21.1.jar'), true);
check('options renderDistance=6', /^renderDistance:6$/m.test(fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8')), true);
check('options conserva foo:bar', /^foo:bar$/m.test(fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8')), true);
check('options conserva version:3955', /^version:3955$/m.test(fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8')), true);
check('sin claves duplicadas', (fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8').match(/^renderDistance:/gm) || []).length, 1);
check('iris shaders OFF', /^enableShaders=false$/m.test(fs.readFileSync(path.join(gameDir, 'config', 'iris.properties'), 'utf8')), true);
check('state perf.mode', state.perf.mode, 'minimo');
check('flags todos', state.perf.files, { mods: true, options: true, iris: true, dh: true });

console.log('\n--- cambio a alto: se prende lo del minimo, effective sigue apagado ---');
res = applyPerfMode({
  gameDir, perfModes, perfMode: 'alto', modDisable, state,
  versionId: '1.7.42', wasFirstInstall: false, allowApply: true,
  log: { info: (t) => console.log(`   [info] ${t}`), warn: (t) => console.log(`   [warn] ${t}`) },
});
state = res.state;
check('DH prendido', isOn('DistantHorizons-3.3.2-1.21.1-fabric-neoforge.jar'), true);
check('visuality prendido', isOn('visuality-0.7.7+1.21.jar'), true);
check('effective SIGUE apagado', isOff('effective-2.4.8-1.21.1.jar'), true);
check('options renderDistance=16', /^renderDistance:16$/m.test(fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8')), true);
check('iris shaders ON', /^enableShaders=true$/m.test(fs.readFileSync(path.join(gameDir, 'config', 'iris.properties'), 'utf8')), true);
check('shaderpack existente respetado', /^shaderPack=COBBLEVERSE - Shaders$/m.test(fs.readFileSync(path.join(gameDir, 'config', 'iris.properties'), 'utf8')), true);
check('DH radius=256', /lodChunkRenderDistanceRadius = 256/.test(fs.readFileSync(path.join(gameDir, 'config', 'DistantHorizons.toml'), 'utf8')), true);

console.log('\n--- shaderpack elegido a mano + apunta a algo que no existe ---');
fs.writeFileSync(path.join(gameDir, 'shaderpacks', 'BSL_v10.1.8.zip'), 'x');
fs.writeFileSync(path.join(gameDir, 'config', 'iris.properties'),
  'enableShaders=false\nshaderPack=BSL_v10.1.8.zip\n');
state = { perf: { ...state.perf, mode: 'medio' } };
res = applyPerfMode({ gameDir, perfModes, perfMode: 'alto', modDisable, state, versionId: '1.7.42', wasFirstInstall: false, allowApply: true, log: {} });
check('BSL (existe) NO se pisa', /^shaderPack=BSL_v10.1.8.zip$/m.test(fs.readFileSync(path.join(gameDir, 'config', 'iris.properties'), 'utf8')), true);
fs.writeFileSync(path.join(gameDir, 'config', 'iris.properties'),
  'enableShaders=false\nshaderPack=PackBorrado.zip\n');
state = { perf: { ...res.state.perf, mode: 'medio' } };
res = applyPerfMode({ gameDir, perfModes, perfMode: 'alto', modDisable, state, versionId: '1.7.42', wasFirstInstall: false, allowApply: true, log: {} });
check('shaderpack inexistente -> default del modo', /^shaderPack=COBBLEVERSE - Shaders$/m.test(fs.readFileSync(path.join(gameDir, 'config', 'iris.properties'), 'utf8')), true);

console.log('\n--- adopt (upgrade <=1.0.6 -> >=1.0.7): no toca archivos ---');
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-adopt-'));
const gd2 = path.join(tmp2, 'game');
fs.ensureDirSync(path.join(gd2, 'mods'));
fs.writeFileSync(path.join(gd2, 'mods', 'DistantHorizons-3.3.2-1.21.1-fabric-neoforge.jar'), 'x');
fs.writeFileSync(path.join(gd2, 'mods', 'visuality-0.7.7+1.21.jar'), 'x');
const resAdopt = applyPerfMode({
  gameDir: gd2, perfModes, perfMode: 'medio', modDisable,
  state: { clientDefaultsApplied: true }, versionId: '1.7.42', wasFirstInstall: false, allowApply: true,
  log: { info: (t) => console.log(`   [info] ${t}`), warn: () => {} },
});
check('adopt no renombra nada', fs.readdirSync(path.join(gd2, 'mods')).filter((f) => f.endsWith('.disabled')).length, 0);
check('adopt marca flags', resAdopt.state.perf.files, { mods: true, iris: true, options: true, dh: true });
check('adopt applied', resAdopt.applied, ['adopt']);

console.log('\n--- juego abierto: no se toca nada ---');
fs.writeFileSync(path.join(gd2, 'mods', 'DistantHorizons-3.3.2-1.21.1-fabric-neoforge.jar.disabled'), 'x');
fs.removeSync(path.join(gd2, 'mods', 'DistantHorizons-3.3.2-1.21.1-fabric-neoforge.jar'));
const resRun = applyPerfMode({
  gameDir: gd2, perfModes, perfMode: 'alto', modDisable,
  state: { clientDefaultsApplied: true, perf: { mode: 'minimo', packVersionId: '1.7.42', files: { mods: true, iris: true, options: true, dh: true } } },
  versionId: '1.7.42', wasFirstInstall: false, allowApply: false, log: {},
});
check('skipped= juego_abierto', resRun.skipped, 'juego_abierto');
check('DH sigue apagado (gd2)', fs.existsSync(path.join(gd2, 'mods', 'DistantHorizons-3.3.2-1.21.1-fabric-neoforge.jar.disabled')), true);
check('estado sin tocar', resRun.state.perf.mode, 'minimo');

fs.removeSync(tmp);
fs.removeSync(tmp2);
console.log(fails ? `\n${fails} FALLA(S)` : '\nTodo OK ✔');
process.exit(fails ? 1 : 0);
