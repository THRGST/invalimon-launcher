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

// ---------- modos de rendimiento ----------
let perfModes = null;
let selectedPerfMode = 'medio';
let lastScan = null;

const TIER_LABEL = {
  alta: 'potente',
  media: 'normal',
  baja: 'floja',
  software: 'sin GPU real (render por software)',
  desconocida: 'no reconocida',
};

function modeTitle(key) {
  const m = perfModes && perfModes.modes && perfModes.modes[key];
  if (!m) return key;
  return `${m.emoji ? m.emoji + ' ' : ''}${m.title || key}`;
}

function updateModeLabel() {
  const el = $('#info-mode');
  if (el) el.textContent = modeTitle(selectedPerfMode);
}

function renderPerfCards() {
  const grid = $('#perf-grid');
  if (!perfModes || !perfModes.modes) {
    grid.innerHTML = '<p class="hint">No pude leer los modos (¿sin conexión?). Se reintenta solo al reabrir el launcher.</p>';
    return;
  }
  grid.innerHTML = Object.entries(perfModes.modes).map(([key, m]) => {
    const badges = [];
    badges.push(m.shaders
      ? '<span class="perf-badge on">Shaders ON</span>'
      : '<span class="perf-badge off">Shaders OFF</span>');
    // El modo que apaga DH muestra "Sin Distant Horizons" aunque defina dhKeys
    // (dhKeys se aplica por si despues cambian a un modo que lo usa).
    const dhApagado = (m.modsDisable || []).some((p) => /distant.?horizons/i.test(p));
    const dh = !dhApagado && m.dhKeys && m.dhKeys.lodChunkRenderDistanceRadius;
    badges.push(dh
      ? `<span class="perf-badge on">Distant Horizons ${escapeHtml(String(dh))}</span>`
      : '<span class="perf-badge off">Sin Distant Horizons</span>');
    const off = (m.modsDisable || []).length;
    badges.push(off
      ? `<span class="perf-badge off">${off} mods apagados</span>`
      : '<span class="perf-badge on">Todos los mods</span>');
    return `
      <button class="perf-card" data-mode="${escapeHtml(key)}">
        <span class="perf-title">${escapeHtml(`${m.emoji ? m.emoji + ' ' : ''}${m.title || key}`)}</span>
        <span class="perf-desc">${escapeHtml(m.desc || '')}</span>
        <span class="perf-badges">${badges.join('')}</span>
      </button>`;
  }).join('');
  grid.querySelectorAll('.perf-card').forEach((card) => {
    card.addEventListener('click', () => selectPerfMode(card.dataset.mode, { save: true }));
  });
  selectPerfMode(selectedPerfMode);
}

async function selectPerfMode(key, opts = {}) {
  if (!perfModes || !perfModes.modes || !perfModes.modes[key]) return;
  selectedPerfMode = key;
  document.querySelectorAll('.perf-card').forEach((c) => {
    c.classList.toggle('active', c.dataset.mode === key);
  });
  updateModeLabel();
  if (opts.save) {
    config = await api.saveConfig({ settings: { perfMode: key } });
    logLine('SYSTEM', `Modo de rendimiento: ${modeTitle(key)} — se aplica en el próximo JUGAR`);
  }
}

// ---------- escaner de hardware ----------
function detectGpu() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return String(gl.getParameter(gl.RENDERER) || '');
  } catch (e) {
    return '';
  }
}

async function runScan() {
  const btn = $('#btn-scan');
  btn.disabled = true;
  $('#scan-result').style.display = 'none';
  $('#scan-hint').textContent = 'Mirando tu PC…';
  let res = null;
  try {
    res = await api.scanHardware(detectGpu());
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  btn.disabled = false;
  if (!res || !res.ok) {
    $('#scan-hint').textContent = `No pude escanear: ${(res && res.error) || 'error desconocido'}`;
    return;
  }
  lastScan = res;
  $('#scan-hint').textContent = '';
  const tier = TIER_LABEL[res.gpu.tier] || res.gpu.tier;
  $('#scan-result').style.display = 'block';
  $('#scan-specs').innerHTML = `
    <div class="scan-line"><span>CPU</span><b>${escapeHtml(res.cpu.model || 'desconocida')} · ${res.cpu.cores} núcleos</b></div>
    <div class="scan-line"><span>RAM</span><b>${res.ramGB} GB</b></div>
    <div class="scan-line"><span>GPU</span><b>${escapeHtml(res.gpu.name || 'desconocida')} — ${escapeHtml(tier)}</b></div>`;
  const razones = (res.reasons || []).map((r) => r.text).join(' · ');
  $('#scan-reco').innerHTML =
    `Te recomiendo el modo <b>${escapeHtml(modeTitle(res.recommended))}</b>` +
    `<br><span class="hint">${escapeHtml(razones)}</span>` +
    `<br><span class="hint">RAM sugerida: ${res.suggestedRamMax} MB</span>`;
  const applyBtn = $('#btn-apply-scan');
  applyBtn.dataset.mode = res.recommended;
  applyBtn.textContent = `Aplicar ${modeTitle(res.recommended)}`;
  $('#scan-apply-hint').textContent = '';
}

async function applyScan() {
  const mode = $('#btn-apply-scan').dataset.mode;
  if (!mode) return;
  const partial = { settings: { perfMode: mode } };
  if (lastScan && lastScan.suggestedRamMax) partial.settings.ramMax = lastScan.suggestedRamMax;
  config = await api.saveConfig(partial);
  $('#ram-max').value = config.settings.ramMax;
  $('#ram-max-val').textContent = config.settings.ramMax;
  await selectPerfMode(mode);
  $('#scan-apply-hint').textContent = 'Listo ✔ Se aplica en el próximo JUGAR.';
  logLine('SYSTEM', `Escáner: modo ${modeTitle(mode)} aplicado (RAM ${config.settings.ramMax} MB)`);
}

// ---------- panel de admin (solo en la PC del server) ----------
async function setupAdmin() {
  let avail = null;
  try { avail = await api.adminAvailable(); } catch (e) {}
  if (!avail || !avail.available) return; // en la PC de un amigo, ni se muestra

  $('#tab-admin').style.display = 'flex';
  const show = (msg, ok) => {
    $('#admin-result-card').style.display = 'block';
    const el = $('#admin-result');
    el.textContent = msg;
    el.style.color = ok ? 'var(--green)' : 'var(--red)';
  };

  // Colores: un click = ruleta que cae en ese color (mensaje/efecto opcionales).
  // Solo los rojos (gajos 0 y 4) disparan la visión (lo decide el datapack por gajo).
  document.querySelectorAll('.color-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const gajo = Number(btn.dataset.gajo);
      const nombre = btn.querySelector('.color-nombre').textContent;
      const mensaje = $('#admin-mensaje').value.trim();
      const efecto = $('#admin-efecto').value.trim();
      const efectoId = $('#admin-efecto-id').value;
      const efectoMin = parseInt($('#admin-efecto-min').value, 10);
      show(`🎨 ${nombre}: girando…`, true);
      const r = await api.adminRuleta({ custom: { gajo, mensaje, efecto, efectoId, efectoMin } });
      show(r.ok ? `✅ Cayó ${nombre}` : `❌ ${r.error}`, r.ok);
      if (r.ok) logLine('SYSTEM', `Admin: tirada al color ${nombre} (${mensaje ? `"${mensaje}"` : 'sin mensaje'})`);
    });
  });

  $('#btn-admin-tirar').addEventListener('click', async () => {
    show('🎲 Tirando aleatorio (eventos del sistema)…', true);
    const r = await api.adminRuleta({});
    show(r.ok ? '✅ Ruleta aleatoria tirada' : `❌ ${r.error}`, r.ok);
    if (r.ok) logLine('SYSTEM', 'Admin: ruleta aleatoria tirada');
  });

  $('#btn-admin-limpiar-efectos').addEventListener('click', async () => {
    const r = await api.adminLimpiarEfectos();
    show(r.ok ? '🧹 Efectos quitados' : `❌ ${r.error}`, r.ok);
    if (r.ok) logLine('SYSTEM', 'Admin: efectos limpiados');
  });

  $('#btn-admin-inmortal').addEventListener('click', async () => {
    const r = await api.adminInmortal({ on: true });
    show(r.ok ? '♾️ Vidas infinitas activadas para vos' : `❌ ${r.error}`, r.ok);
    if (r.ok) logLine('SYSTEM', 'Admin: vidas infinitas ON');
  });

  $('#btn-admin-mortal').addEventListener('click', async () => {
    const r = await api.adminInmortal({ on: false });
    show(r.ok ? '☠ Volviste al sistema de vidas normal' : `❌ ${r.error}`, r.ok);
    if (r.ok) logLine('SYSTEM', 'Admin: vidas infinitas OFF');
  });

  $('#btn-admin-anunciar').addEventListener('click', async () => {
    const text = $('#admin-texto').value.trim();
    const hex = $('#admin-hex').value.trim();
    const color = hex || $('#admin-color').value;
    const r = await api.adminAnuncio({ text, color });
    show(r.ok ? '✅ Anuncio enviado a todos' : `❌ ${r.error}`, r.ok);
    if (r.ok) logLine('SYSTEM', `Admin: anuncio enviado (${color})`);
  });

  $('#btn-admin-mision').addEventListener('click', async () => {
    const id = $('#admin-mision-id').value;
    const label = $('#admin-mision-id').selectedOptions[0].textContent;
    show('📜 Lanzando la misión…', true);
    const r = await api.adminMision({ id });
    show(r.ok ? `📜 Misión activada: ${label}` : `❌ ${r.error}`, r.ok);
    if (r.ok) logLine('SYSTEM', `Admin: misión activada (${id})`);
  });

  $('#btn-admin-mision-off').addEventListener('click', async () => {
    const r = await api.adminMisionOff();
    show(r.ok ? '⏹ Misión desactivada' : `❌ ${r.error}`, r.ok);
    if (r.ok) logLine('SYSTEM', 'Admin: misión desactivada');
  });

  $('#btn-admin-mision-reset').addEventListener('click', async () => {
    const r = await api.adminMisionReset();
    show(r.ok ? '🔄 Misión reiniciada (todos de cero)' : `❌ ${r.error}`, r.ok);
    if (r.ok) logLine('SYSTEM', 'Admin: misión reiniciada');
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
        <span class="mod-name">${escapeHtml(m.name)}${m.extra ? '<span class="mod-tag">extra</span>' : ''}${m.disabled ? '<span class="mod-tag off">apagado</span>' : ''}</span>
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
      perfMode: selectedPerfMode,
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
  $('#gc').value = config.settings.gc || 'auto';
  try {
    const sys = await api.getSystemInfo();
    $('#ram-detectada').textContent = `Tu PC tiene ${sys.ramTotalGB} GB de RAM.`;
  } catch (e) { /* si falla, no es grave */ }

  // Modos de rendimiento (del manifest) + escáner
  perfModes = await api.getPerfModes();
  if (perfModes && perfModes.modes) {
    if (!perfModes.modes[config.settings.perfMode]) {
      config.settings.perfMode = perfModes.default || 'medio';
    }
  }
  selectedPerfMode = config.settings.perfMode || 'medio';
  renderPerfCards();
  updateModeLabel();
  $('#btn-scan').addEventListener('click', runScan);
  $('#btn-apply-scan').addEventListener('click', applyScan);

  // Panel de admin (solo aparece en la PC del server)
  setupAdmin();

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
