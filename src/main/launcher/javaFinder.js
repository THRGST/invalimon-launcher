// Encuentra un Java 21+ usable: runtime propio > JVM del sistema > Adoptium.
// Trampa clasica de Windows: C:\Windows\System32\java.exe es un stub de la
// Microsoft Store que "existe" pero no ejecuta nada -> hay que excluirlo.
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { spawnSync } = require('child_process');

const OS_MAP = { win32: 'windows', darwin: 'mac', linux: 'linux' };
const ARCH_MAP = { x64: 'x64', arm64: 'aarch64', ia32: 'x86' };
const MIN_MAJOR = 21;
const MAX_MAJOR = 24; // Java 25/26 rompen mixin/ASM de MC 1.21.1

function javaVersion(javaPath) {
  try {
    const r = spawnSync(javaPath, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    const txt = (r.stderr || '') + (r.stdout || '');
    const m = txt.match(/(?:openjdk|java) version "([0-9._]+)"/i);
    if (!m) return null;
    const raw = m[1];
    const major = raw.startsWith('1.') ? parseInt(raw.split('.')[1], 10) : parseInt(raw.split('.')[0], 10);
    return isNaN(major) ? null : { version: raw, major };
  } catch (e) {
    return null;
  }
}

function managedJava(gameDir) {
  const base = path.join(gameDir, 'runtime', 'java-21', 'bin');
  for (const exe of ['java.exe', 'java']) {
    const p = path.join(base, exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function systemJavaCandidates() {
  const out = [];
  if (os.platform() === 'win32') {
    const roots = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Java'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Zulu'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium'),
    ];
    for (const root of roots) {
      try {
        for (const dir of fs.readdirSync(root)) {
          out.push(path.join(root, dir, 'bin', 'java.exe'));
        }
      } catch (e) {}
    }
  } else {
    try {
      for (const dir of fs.readdirSync('/usr/lib/jvm')) out.push(path.join('/usr/lib/jvm', dir, 'bin', 'java'));
    } catch (e) {}
    // temurin portable (util para dev)
    out.push(path.join(os.homedir(), '.local', 'share', 'temurin-21', 'bin', 'java'));
    try {
      for (const dir of fs.readdirSync('/Library/Java/JavaVirtualMachines')) {
        out.push(path.join('/Library/Java/JavaVirtualMachines', dir, 'Contents', 'Home', 'bin', 'java'));
      }
    } catch (e) {}
  }
  return out;
}

// Devuelve {path, version, major} del mejor Java disponible (>=21), o el runtime propio.
function findSystemJava(gameDir) {
  const managed = managedJava(gameDir);
  if (managed) {
    const v = javaVersion(managed);
    if (v && v.major >= MIN_MAJOR && v.major <= MAX_MAJOR) return { path: managed, ...v, managed: true };
  }
  for (const c of systemJavaCandidates()) {
    if (/windows[\\/]system32[\\/]java\.exe$/i.test(c)) continue; // stub de la Store
    if (!fs.existsSync(c)) continue;
    const v = javaVersion(c);
    if (v && v.major >= MIN_MAJOR && v.major <= MAX_MAJOR) return { path: c, ...v, managed: false };
  }
  return null;
}

async function downloadFile(url, dest, onProgress) {
  const res = await axios.get(url, { responseType: 'stream', maxRedirects: 10, timeout: 60000 });
  const total = parseInt(res.headers['content-length'] || '0', 10);
  let done = 0;
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(dest);
    res.data.on('data', (c) => { done += c.length; if (onProgress && total) onProgress(done, total); });
    res.data.on('error', reject);
    ws.on('error', reject);
    ws.on('close', resolve);
    res.data.pipe(ws);
  });
}

function extractArchive(archive, dest) {
  fs.ensureDirSync(dest);
  if (os.platform() === 'win32') {
    // Windows 10 1803+ trae bsdtar; plan B: PowerShell
    let r = spawnSync('tar', ['-xf', archive, '-C', dest, '--strip-components=1'], { windowsHide: true });
    if (r.status !== 0) {
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${dest}-tmp" -Force; ` +
        `$d = Get-ChildItem "${dest}-tmp" | Select-Object -First 1; ` +
        `Move-Item "$($d.FullName)\\*" "${dest}" -Force; Remove-Item "${dest}-tmp" -Recurse -Force`],
        { windowsHide: true });
    }
  } else {
    spawnSync('tar', ['-xzf', archive, '-C', dest, '--strip-components=1']);
  }
}

// Asegura Java 21: el del sistema si sirve, si no baja el JRE de Adoptium.
async function ensureJava21({ gameDir, onEvent, log }) {
  const existing = findSystemJava(gameDir);
  if (existing) return existing.path;

  const emit = (phase, message, percent) => onEvent && onEvent({ phase, message, percent });
  const platform = OS_MAP[os.platform()];
  const arch = ARCH_MAP[os.arch()];
  if (!platform || !arch) throw new Error(`Plataforma no soportada: ${os.platform()}/${os.arch()}`);

  const url = `https://api.adoptium.net/v3/binary/latest/21/ga/${platform}/${arch}/jre/hotspot/normal/eclipse`;
  const isWin = os.platform() === 'win32';
  const archive = path.join(gameDir, 'runtime', `jre21.${isWin ? 'zip' : 'tar.gz'}`);
  const dest = path.join(gameDir, 'runtime', 'java-21');

  fs.ensureDirSync(path.dirname(archive));
  emit('java_install', 'Descargando Java 21 (49 MB)...', 10);
  await downloadFile(url, archive, (done, total) =>
    emit('java_download', `Java: ${(done / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB`, 15 + Math.round((done / total) * 35)));

  emit('java_extract', 'Extrayendo Java...', 55);
  await fs.remove(dest);
  extractArchive(archive, dest);
  try { fs.removeSync(archive); } catch (e) {}

  const javaPath = managedJava(gameDir);
  if (!javaPath) throw new Error('Java no quedo bien instalado');
  const v = javaVersion(javaPath);
  if (!v || v.major < MIN_MAJOR) throw new Error('El Java descargado no funciona');
  if (log) log.info(`Java 21 listo: ${javaPath} (${v.version})`);
  emit('java_ready', 'Java listo ✔', 60);
  return javaPath;
}

module.exports = { ensureJava21, findSystemJava, javaVersion };
