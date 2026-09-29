// Logica del renderer (vanilla JS, sin bundler).
const $ = (sel) => document.querySelector(sel);
const api = window.invalimon;

let config = null;
let isRunning = false;
let allMods = [];
let modsLoaded = false;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- utilidades ----------
function logLine(type, text) {
  const box = $('#console');
  const div = document.createElement('div');
  div.className = `log-${type || 'INFO'}`;
  div.textContent = text;
  box.appendChild(div);
  while (box.childElementCount > 800) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function setStatus(text, percent) {
  $('#status-text').textContent = text;
  $('#progress-bar').style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
}

function setPlayState(running) {
  isRunning = running;
  const btn = $('#btn-play');
  btn.textContent = running ? 'DETENER' : 'JUGAR';
  btn.classList.toggle('running', running);
}

// ---------- tabs ----------
function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      $(`#view-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'mods' && !modsLoaded) loadMods();
    });
  });
}

// ---------- mods ----------
async function loadMods() {
  const list = $('#mods-list');
  list.innerHTML = '<div class="mods-empty">Leyendo los mods instalados...</div>';
  allMods = await api.getMods();
  modsLoaded = true;
  $('#mods-count').textContent = allMods.length
    ? `${allMods.length} mods instalados`
    : 'Todavía no hay mods instalados (dale a JUGAR una vez)';
  renderMods($('#mods-search').value);
}

// Color de acento por seccion de mods (le da vida a la lista)
const SEC_COLORS = {
  'Cobblemon · Pokémon': '#ff6b81',
  'Optimización': '#34d399',
  'Visuales': '#a78bfa',
  'Interfaz y comodidad': '#4fc3f7',
  'Mundo y exploración': '#fbbf24',
  'Construcción y decoración': '#fb923c',
  'Almacenamiento': '#2dd4bf',
  'Librerías': '#94a3b8',
  'Otros': '#8b93ab',
};

function renderMods(filter) {
  const f = (filter || '').trim().toLowerCase();
  const items = allMods.filter((m) =>
    !f || m.name.toLowerCase().includes(f) || (m.id || '').toLowerCase().includes(f));
  const list = $('#mods-list');
  if (!items.length) {
    list.innerHTML = '<div class="mods-empty">Sin resultados</div>';
    return;
  }
  // Agrupados por seccion: el main ya los devuelve en el orden del manifest
  const groups = new Map();
  for (const m of items) {
    const s = m.section || 'Otros';
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(m);
  }
  list.innerHTML = [...groups.entries()].map(([title, mods]) => {
    // sin manifest con secciones caen todos en "Otros": lista plana, sin titulo
    const head = (title === 'Otros' && groups.size === 1) ? '' :
      `<div class="mods-section-title" style="--sec:${SEC_COLORS[title] || '#4fc3f7'}"><span class="sec-dot"></span>${escapeHtml(title)}<span class="mods-section-count">${mods.length}</span></div>`;
    return head + mods.map((m) => `
      <div class="mod-item">
        <span class="mod-name">${escapeHtml(m.name)}${m.extra ? '<span class="mod-tag">extra</span>' : ''}</span>
        <span class="mod-version">${escapeHtml(m.version || '')}</span>
      </div>`).join('');
  }).join('');
}

function setupWindowControls() {
  $('#win-min').addEventListener('click', () => api.minimizeWindow());
  $('#win-max').addEventListener('click', () => api.maximizeWindow());
  $('#win-close').addEventListener('click', () => api.closeWindow());
}

// ---------- eventos del motor ----------
function onEngineEvent(data) {
  if (data.event === 'status') {
    if (data.phase === 'running' || data.percent === 100) {
      setPlayState(true);
      setStatus('Jugando ✔', 100);
    } else if (data.phase === 'idle' || data.percent === 0) {
      setPlayState(false);
      setStatus(data.message || 'Listo', 0);
    } else {
      setStatus(data.message || '', data.percent || 0);
    }
  } else if (data.event === 'game_started') {
    setPlayState(true);
    logLine('SYSTEM', `Minecraft iniciado (PID: ${data.pid})`);
  } else if (data.event === 'game_closed') {
    setPlayState(false);
    setStatus('Listo', 0);
    logLine('SYSTEM', `Minecraft cerrado (código ${data.code})`);
  } else if (data.event === 'autoconnect') {
    $('#autoconnect-card').style.display = 'block';
    $('#autoconnect-text').textContent = data.text;
  } else if (data.event === 'update_state') {
    renderUpdate(data);
  }
}

// ---------- actualizaciones del launcher ----------
let lastUpdateState = null;

function renderUpdate(st) {
  const s = (st && st.state) || 'idle';
  const card = $('#update-card');
  const barWrap = $('#update-progress-wrap');
  const btnInstall = $('#btn-install-update');
  const hint = $('#update-hint');
  const prev = lastUpdateState;
  lastUpdateState = s;

  if (s === 'available' || s === 'downloading') {
    card.style.display = 'block';
    barWrap.style.display = 'block';
    btnInstall.style.display = 'none';
    const ver = st.version ? ` ${st.version}` : '';
    $('#update-text').textContent = s === 'downloading'
      ? `Bajando la versión${ver}… ${st.percent || 0}%`
      : `Hay una versión nueva${ver}, bajando…`;
    $('#update-progress').style.width = `${st.percent || 0}%`;
    if (prev !== s && s === 'available') logLine('SYSTEM', `Actualización del launcher disponible${ver}`);
  } else if (s === 'ready') {
    card.style.display = 'block';
    barWrap.style.display = 'none';
    btnInstall.style.display = 'block';
    $('#update-text').textContent = `Versión${st.version ? ` ${st.version}` : ''} lista para instalar`;
    if (prev !== 'ready') logLine('SYSTEM', 'Actualización descargada: reiniciá el launcher para aplicarla.');
  } else {
    card.style.display = 'none';
  }

  if (s === 'none') hint.textContent = 'Estás al día ✔';
  else if (s === 'checking') hint.textContent = 'Buscando actualizaciones…';
  else if (s === 'error') {
    hint.textContent = 'No pude buscar actualizaciones (¿sin internet?).';
    if (prev !== 'error') logLine('WARN', `Auto-update: ${st.error || 'error'}`);
  } else if (s === 'idle') hint.textContent = 'Se actualiza solo: si hay una versión nueva la baja y te avisa acá.';
}

// ---------- acciones ----------
async function refreshState() {
  const state = await api.getState();
  $('#info-pack').textContent = state.pack && state.pack.versionId
    ? `Cobbleverse ${state.pack.versionId}` : 'No instalado';
  $('#info-mods').textContent = state.pack && state.pack.modCount
    ? `${state.pack.modCount} mods` : '—';
  $('#about-dir').textContent = `Datos: ${state.dataDir}`;
  setPlayState(Boolean(state.running));
  renderNotice(state.notice);
  refreshServerStatus();
}

// ---------- estado del server en vivo ----------
let lastServerOnline = null;
async function refreshServerStatus() {
  const el = $('#info-server');
  const st = await api.getServerStatus();
  if (st && st.online) {
    el.innerHTML = `<span class="dot online"></span>Online · ${st.onlineCount}/${st.maxCount}`;
    el.title = `${st.motd || ''}\n${st.latencyMs} ms`;
    if (lastServerOnline === false) logLine('SYSTEM', `Server online: ${st.onlineCount}/${st.maxCount} jugando`);
    lastServerOnline = true;
  } else {
    el.innerHTML = '<span class="dot offline"></span>Offline';
    el.title = (st && st.error) || '';
    if (lastServerOnline === true) logLine('WARN', 'El server dejó de responder');
    if (lastServerOnline === null) console.log('server offline:', st && st.error);
    lastServerOnline = false;
  }
}

// ---------- avisos del manifest ----------
function renderNotice(text) {
  const el = $('#notice-banner');
  if (!el) return;
  if (text) {
    $('#notice-text').textContent = text;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// ---------- reset total (autodestruccion) ----------
function setupNuke() {
  const modal = $('#nuke-modal');
  const input = $('#nuke-confirm-input');
  const go = $('#nuke-go');
  const result = $('#nuke-result');
  const uninstallCb = $('#nuke-uninstall');
  const uninstallLabel = $('#nuke-uninstall-label');

  // El checkbox de desinstalar solo aplica al launcher instalado de Windows
  api.getSystemInfo().then((info) => {
    if (info && info.platform === 'win32' && info.packaged) {
      uninstallLabel.style.display = 'flex';
    }
  }).catch(() => {});

  $('#btn-nuke').addEventListener('click', () => {
    input.value = '';
    go.disabled = true;
    go.textContent = 'Eliminar todo';
    result.textContent = '';
    if (uninstallCb) uninstallCb.checked = false;
    modal.style.display = 'flex';
    input.focus();
  });
  $('#nuke-cancel').addEventListener('click', () => { modal.style.display = 'none'; });
  input.addEventListener('input', () => {
    go.disabled = input.value.trim().toUpperCase() !== 'BORRAR';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !go.disabled) go.click();
  });

  go.addEventListener('click', async () => {
    if (input.value.trim().toUpperCase() !== 'BORRAR') return;
    go.disabled = true;
    go.textContent = 'Borrando…';
    result.textContent = '';
    const r = await api.nuke({ uninstall: Boolean(uninstallCb && uninstallCb.checked) });
    if (r && r.uninstalling) {
      result.textContent = 'Todo borrado. Desinstalando el launcher…';
      return; // el main cierra la app para que el desinstalador termine
    }
    if (r && r.ok) {
      result.textContent = (r.failed && r.failed.length)
        ? `Listo. Quedaron ${r.failed.length} archivos en uso (se limpian al reiniciar).`
        : 'Listo: todo borrado. Reiniciando la vista…';
      logLine('SYSTEM', 'Reset total completado');
      setTimeout(() => location.reload(), 2200);
    } else {
      result.textContent = `No pude borrar todo: ${(r && r.error) || 'error desconocido'}`;
      go.disabled = false;
      go.textContent = 'Eliminar todo';
    }
  });
}

async function saveName() {
  const name = $('#username').value.trim();
  if (!name) { $('#name-hint').textContent = 'Poné un nombre primero.'; return; }
  const auth = await api.loginOffline(name);
  config.user = { type: auth.type, username: auth.username, uuid: auth.uuid };
  $('#name-hint').textContent = `Listo: entrás como ${auth.username}.`;
  logLine('SYSTEM', `Nombre guardado: ${auth.username}`);
  updateAvatar(auth.username);
}

// Avatar con color propio de cada jugador (hash del nombre -> tono)
function updateAvatar(name) {
  const el = $('#avatar');
  if (!el) return;
  const n = String(name || '').trim();
  el.textContent = (n[0] || '?').toUpperCase();
  let h = 0;
  for (const c of n.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  el.style.background = `linear-gradient(135deg, hsl(${h} 78% 62%), hsl(${(h + 45) % 360} 78% 50%))`;
  el.style.boxShadow = `0 2px 12px hsl(${h} 80% 55% / .35)`;
}

async function saveSettings() {
  const partial = {
    settings: {
      ramMin: Number($('#ram-min').value),
      ramMax: Number($('#ram-max').value),
      javaPath: $('#java-path').value.trim() || 'auto',
      customJvmArgs: $('#jvm-args').value.trim(),
      fullscreen: $('#fullscreen').checked,
      resolutionWidth: Number($('#res-w').value) || 1280,
      resolutionHeight: Number($('#res-h').value) || 720,
      lightMode: $('#light-mode').checked,
      gc: $('#gc').value,
    },
  };
  config = await api.saveConfig(partial);
  logLine('SYSTEM', 'Ajustes guardados ✔');
  setStatus('Ajustes guardados ✔', 0);
}

async function togglePlay() {
  if (isRunning) {
    await api.killGame();
    return;
  }
  const name = $('#username').value.trim();
  if (!name) { $('#name-hint').textContent = 'Poné un nombre primero.'; return; }
  await api.loginOffline(name);
  setPlayState(false);
  $('#btn-play').disabled = true;
  setStatus('Preparando...', 1);
  const res = await api.launchGame();
  $('#btn-play').disabled = false;
  if (!res.ok) {
    setStatus(`Error: ${res.error}`, 0);
    logLine('ERROR', res.error);
  }
}

// ---------- init ----------
async function init() {
  setupTabs();
  setupWindowControls();

  config = await api.getConfig();
  const version = await api.getAppVersion();
  $('#about-version').textContent = version;

  $('#username').value = config.user.username || '';
  updateAvatar(config.user.username);
  $('#username').addEventListener('input', (e) => updateAvatar(e.target.value));
  $('#ram-min').value = config.settings.ramMin;
  $('#ram-max').value = config.settings.ramMax;
  $('#ram-min-val').textContent = config.settings.ramMin;
  $('#ram-max-val').textContent = config.settings.ramMax;
  $('#java-path').value = config.settings.javaPath === 'auto' ? '' : config.settings.javaPath;
  $('#jvm-args').value = config.settings.customJvmArgs || '';
  $('#fullscreen').checked = Boolean(config.settings.fullscreen);
  $('#res-w').value = config.settings.resolutionWidth;
  $('#res-h').value = config.settings.resolutionHeight;
  $('#light-mode').checked = Boolean(config.settings.lightMode);
  $('#gc').value = config.settings.gc || 'auto';
  try {
    const sys = await api.getSystemInfo();
    $('#ram-detectada').textContent = `Tu PC tiene ${sys.ramTotalGB} GB de RAM.`;
  } catch (e) { /* si falla, no es grave */ }

  $('#ram-min').addEventListener('input', (e) => { $('#ram-min-val').textContent = e.target.value; });
  $('#ram-max').addEventListener('input', (e) => { $('#ram-max-val').textContent = e.target.value; });
  $('#btn-save-name').addEventListener('click', saveName);
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-play').addEventListener('click', togglePlay);
  $('#btn-clear-log').addEventListener('click', () => { $('#console').innerHTML = ''; });
  $('#mods-search').addEventListener('input', (e) => renderMods(e.target.value));

  $('#btn-open-dir').addEventListener('click', () => api.openGameDir());
  $('#btn-verify').addEventListener('click', async () => {
    setStatus('Verificando integridad (puede tardar)...', 1);
    const r = await api.verifyIntegrity();
    setStatus(r.ok ? 'Integridad OK ✔' : `Error: ${r.error}`, r.ok ? 100 : 0);
  });
  $('#btn-wipe').addEventListener('click', async () => {
    const ok = confirm('¿Borrar TODOS los datos del juego (mods, configs, mundos locales)?\nEl launcher los volverá a descargar la próxima vez.');
    if (!ok) return;
    await api.wipeGameDir();
    logLine('SYSTEM', 'Datos del juego borrados');
    refreshState();
  });

  setupNuke();

  $('#btn-check-updates').addEventListener('click', async () => {
    $('#update-hint').textContent = 'Buscando actualizaciones…';
    const r = await api.checkUpdates();
    if (!r.ok && r.error) $('#update-hint').textContent = `No pude buscar: ${r.error}`;
  });
  $('#btn-install-update').addEventListener('click', async () => {
    const r = await api.installUpdate();
    if (!r.ok) {
      $('#update-hint').textContent = r.error;
      logLine('ERROR', r.error);
    } else {
      setStatus('Instalando actualización…', 100);
      logLine('SYSTEM', 'Reiniciando el launcher para instalar…');
    }
  });

  api.onLog((d) => logLine(d.type, d.text));
  api.onEvent(onEngineEvent);

  renderUpdate(await api.getUpdateState());

  await refreshState();
  setInterval(refreshServerStatus, 30000);
  logLine('SYSTEM', `Launcher listo (v${version})`);
}

document.addEventListener('DOMContentLoaded', init);
