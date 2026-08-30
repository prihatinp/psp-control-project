// =====================================================================
// KONFIGURASI: ganti dengan URL Web App Apps Script Anda (.../exec)
// Dapatkan URL ini setelah men-deploy backend (folder /backend) sebagai
// Web App dari script.google.com (lihat README.md).
//
// Staging override (Phase 5.5): a browser can temporarily point this
// page at a staging Web App URL without ever committing that URL here,
// via localStorage — see backend/staging/STAGING_SETUP_CHECKLIST.md.
//   localStorage.setItem('psp_staging_api_url', 'https://.../exec')
//   localStorage.removeItem('psp_staging_api_url') // back to production
// Falls back to the committed production URL below when unset, exactly
// as before this override existed.
// =====================================================================
const PSP_API_URL = (typeof localStorage !== 'undefined' && localStorage.getItem('psp_staging_api_url'))
  || "https://script.google.com/macros/s/AKfycbwV3puwMIn-1yk13ad3V-FGzQLpkAc-k7fhjTHq1MZlD05aoGUGU7pL4e8Na9YqA9CAAQ/exec";

/* ============================================================
 *  PSP PROJECT CONTROL — CLIENT
 *  Front-end statis (GitHub Pages) yang berbicara ke backend
 *  Google Apps Script lewat REST-style JSON API (fetch).
 *
 *  Keamanan:
 *   - Login (nama + PIN) menghasilkan token bertanda-tangan (HMAC,
 *     dibuat & diverifikasi di server, kedaluwarsa otomatis).
 *   - Semua aksi yang mengubah data WAJIB menyertakan token ini;
 *     token TIDAK PERNAH mengandung/mengekspos rahasia server.
 *   - Token disimpan di localStorage browser, bukan di kode sumber,
 *     jadi tidak ikut ter-commit ke GitHub.
 * ============================================================ */

/* ============ API HELPER (pola sama seperti musa-app) ============ */
function apiGet(action, params) {
  const url = new URL(PSP_API_URL);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(k => {
    if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
  });
  return fetch(url.toString()).then(r => r.json());
}
function apiPost(action, body) {
  // Content-Type WAJIB text/plain agar browser tidak mengirim preflight
  // OPTIONS (Apps Script Web App tidak menanganinya dengan baik).
  return fetch(PSP_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: action, token: authToken }, body))
  }).then(r => r.json()).then(res => {
    if (res && res.authError) {
      forceLogout('Sesi berakhir, silakan login kembali.');
      throw new Error(res.message || 'Sesi berakhir');
    }
    return res;
  });
}

/* ============ AUTH STATE ============ */
let authToken = localStorage.getItem('psp_token') || null;
let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem('psp_user') || 'null'); } catch (e) { currentUser = null; }

/* ============ DATA MODEL (diisi dari server) ============ */
let TEAM = [];
let STAGES = [];
let PHASES = [];
let projects = [];
let supportJobs = [];
let globalSupport = [];
let dailyLogs = [];
let SUPPORT_CAPACITY_MANDAY_PER_WEEK = 60;
let currentDetailId = null;

/* ============ BOOT ============ */
boot();
function boot() {
  showStagingBannerIfActive();
  if (!PSP_API_URL || PSP_API_URL.indexOf('PASTE_URL') !== -1) {
    document.getElementById('loadingOverlay').innerHTML =
      '<div style="max-width:420px; text-align:center; padding:0 20px;">' +
      '<div style="font-size:15px; margin-bottom:8px;">PSP belum dikonfigurasi.</div>' +
      '<div style="font-size:12.5px; color:#B7C1E6;">Admin perlu mengisi PSP_API_URL di js/app.js dengan URL Web App Apps Script yang sudah di-deploy.</div>' +
      '</div>';
    return;
  }
  if (authToken && currentUser) {
    // sudah login sebelumnya -> validasi token ke server sambil ambil data
    loadBootstrap(true);
  } else {
    document.getElementById('loadingText').textContent = 'Memuat daftar pengguna...';
    apiGet('teamNames').then(list => {
      TEAM = list || [];
      document.getElementById('loadingOverlay').style.display = 'none';
      document.getElementById('loginScreen').style.display = 'flex';
      initLoginOptions();
    }).catch(err => {
      console.error('teamNames fetch failed:', err, 'PSP_API_URL =', PSP_API_URL);
      document.getElementById('loadingOverlay').innerHTML =
        '<div style="max-width:460px; text-align:center; padding:0 20px;">' +
        '<div style="font-size:15px; margin-bottom:8px;">Gagal terhubung ke server.</div>' +
        '<div style="font-size:12.5px; color:#B7C1E6; word-break:break-all;">URL: ' + escapeHTML(PSP_API_URL) + '</div>' +
        '<div style="font-size:11.5px; color:#8891B5; margin-top:8px;">Cek: (1) halaman ini dibuka lewat http/https, bukan file:// langsung; (2) tidak ada staging override aktif — lihat console; (3) koneksi internet.</div>' +
        '</div>';
    });
  }
}
/** Phase 5.5's staging override is powerful but silent by design (never
 *  commits a URL) — that silence is a real risk right before a demo: a
 *  browser left pointed at a staging URL from earlier testing would keep
 *  failing/behaving differently with zero visual clue. Surface it loudly. */
function showStagingBannerIfActive() {
  let staging = null;
  try { staging = localStorage.getItem('psp_staging_api_url'); } catch (e) { /* ignore */ }
  if (!staging) return;
  console.warn('STAGING OVERRIDE ACTIVE — PSP_API_URL is NOT the production URL:', staging);
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:99999; background:#B34700; color:#fff; text-align:center; font:600 12.5px/1 -apple-system,sans-serif; padding:8px;';
  banner.innerHTML = '⚠ STAGING MODE — pointed at a non-production URL. Run <code>localStorage.removeItem(\'psp_staging_api_url\')</code> and reload before any real/BOD use.';
  document.body.prepend(banner);
  document.body.style.paddingTop = '34px';
}

function loadBootstrap(isInitial) {
  apiPost('bootstrap', {}).then(data => {
    if (!data || data.ok === false) {
      forceLogout(data && data.message ? data.message : 'Sesi tidak valid, silakan login kembali.');
      return;
    }
    TEAM = data.team || [];
    STAGES = data.stages || [];
    PHASES = data.phases || [];
    projects = data.projects || [];
    dailyLogs = data.dailyLogs || [];
    supportJobs = data.supportJobs || [];
    globalSupport = data.globalSupport || [];
    SUPPORT_CAPACITY_MANDAY_PER_WEEK = data.supportCapacity || 60;

    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('sideAvatar').textContent = initials(currentUser.name);
    document.getElementById('sideName').textContent = currentUser.name;
    document.getElementById('sideRole').textContent = currentUser.role;
    initSelects();
    renderAll();
  }).catch(err => {
    if (isInitial) {
      forceLogout('Sesi berakhir, silakan login kembali.');
    } else {
      toast('Error: ' + (err && err.message ? err.message : String(err)), true);
    }
  });
}

function refreshFromServer() {
  toast('Memuat ulang data...');
  const page = currentActivePage();
  loadBootstrapThen(() => goPage(page));
}
function loadBootstrapThen(cb) {
  apiPost('bootstrap', {}).then(data => {
    if (!data || data.ok === false) { forceLogout(data && data.message); return; }
    TEAM = data.team || []; STAGES = data.stages || []; PHASES = data.phases || [];
    projects = data.projects || []; dailyLogs = data.dailyLogs || [];
    supportJobs = data.supportJobs || []; globalSupport = data.globalSupport || [];
    SUPPORT_CAPACITY_MANDAY_PER_WEEK = data.supportCapacity || 60;
    initSelects();
    if (cb) cb();
  }).catch(err => toast('Error: ' + (err && err.message ? err.message : String(err)), true));
}
function currentActivePage() {
  const el = document.querySelector('.page.active');
  return el ? el.id.replace('page-', '') : 'dashboard';
}
function forceLogout(msg) {
  authToken = null; currentUser = null;
  localStorage.removeItem('psp_token'); localStorage.removeItem('psp_user');
  document.getElementById('app').style.display = 'none';
  document.getElementById('loadingOverlay').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  const err = document.getElementById('loginError');
  if (msg) { err.textContent = msg; err.style.display = 'block'; }
  apiGet('teamNames').then(list => { TEAM = list || []; initLoginOptions(); });
}

/* ============ INIT ============ */
function initLoginOptions() {
  const sel = document.getElementById('loginName');
  sel.innerHTML = '<option value="">— Pilih nama —</option>';
  TEAM.forEach(t => {
    const o = document.createElement('option'); o.value = t.name; o.textContent = t.name + ' — ' + t.role;
    sel.appendChild(o);
  });
}
function initSelects() {
  ['npPic', 'npSupport', 'duEngineer', 'qEngineer', 'sjPic', 'gsPic', 'pmExtPic2', 'pmIntPic2', 'rcWbsPic', 'rcMdEngineer', 'mpOrgPerson'].forEach(id => {
    const sel = document.getElementById(id); sel.innerHTML = '';
    TEAM.forEach(t => { const o = document.createElement('option'); o.value = t.name; o.textContent = t.name; sel.appendChild(o); });
  });
  const stageSel = document.getElementById('duStage'); stageSel.innerHTML = '';
  STAGES.forEach((s, i) => { const o = document.createElement('option'); o.value = i; o.textContent = (i + 1) + '. ' + s.n; stageSel.appendChild(o); });

  const dashLine = document.getElementById('dashLine');
  dashLine.innerHTML = '<option value="">Semua Line</option>';
  [...new Set(projects.map(p => p.line))].forEach(l => { const o = document.createElement('option'); o.value = l; o.textContent = l; dashLine.appendChild(o); });
  const dashPic = document.getElementById('dashPic');
  dashPic.innerHTML = '<option value="">Semua PIC</option>';
  [...new Set(projects.map(p => p.pic))].forEach(l => { const o = document.createElement('option'); o.value = l; o.textContent = l; dashPic.appendChild(o); });

  const duProject = document.getElementById('duProject'); duProject.innerHTML = '';
  projects.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.no + ' — ' + p.name; duProject.appendChild(o); });

  document.getElementById('duDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('navProjCount').textContent = projects.length;
}
function initials(name) { if (!name) return '--'; return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }

/* ============ LOGIN / LOGOUT ============ */
function doLogin() {
  const name = document.getElementById('loginName').value;
  const pass = document.getElementById('loginPass').value;
  const errBox = document.getElementById('loginError');
  errBox.style.display = 'none';
  if (!name) { errBox.textContent = 'Silakan pilih nama terlebih dahulu.'; errBox.style.display = 'block'; return; }
  if (!pass) { errBox.textContent = 'PIN wajib diisi.'; errBox.style.display = 'block'; return; }
  const btn = document.getElementById('loginBtn'); btn.disabled = true; btn.textContent = 'Memeriksa...';
  fetch(PSP_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', name: name, pin: pass })
  }).then(r => r.json()).then(res => {
    btn.disabled = false; btn.textContent = 'Masuk ke Dashboard';
    if (!res.ok) {
      errBox.textContent = res.message || 'Login gagal.';
      errBox.style.display = 'block';
      return;
    }
    authToken = res.token; currentUser = res.user;
    localStorage.setItem('psp_token', authToken);
    localStorage.setItem('psp_user', JSON.stringify(currentUser));
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('loadingOverlay').style.display = 'flex';
    document.getElementById('loadingText').textContent = 'Memuat data...';
    loadBootstrap(false);
  }).catch(err => {
    btn.disabled = false; btn.textContent = 'Masuk ke Dashboard';
    errBox.textContent = 'Terjadi kesalahan: ' + (err && err.message ? err.message : String(err));
    errBox.style.display = 'block';
  });
}
function doLogout() {
  authToken = null; currentUser = null;
  localStorage.removeItem('psp_token'); localStorage.removeItem('psp_user');
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginPass').value = '';
  apiGet('teamNames').then(list => { TEAM = list || []; initLoginOptions(); });
}

/* ============ NAV ============ */
function goPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const btn = document.querySelector('.nav-item[data-page="' + p + '"]'); if (btn) btn.classList.add('active');
  if (p === 'dashboard') renderDashboard();
  if (p === 'projects') renderProjectsTable();
  if (p === 'daily') renderDailyPage();
  if (p === 'weekly') renderWeekly();
  if (p === 'monthly') renderMonthly();
  if (p === 'team') renderTeam();
  if (p === 'support') renderSupport();
  if (p === 'global') renderGlobal();
  if (p === 'pmExternal') renderPmExternal();
  if (p === 'pmInternal') renderPmInternal();
  if (p === 'pmAddNew') renderPmAddNew();
  if (p === 'rcWbs') renderRcWbsPage();
  if (p === 'rcWorkload') renderRcWorkload();
  if (p === 'rcManDay') renderRcManDayPage();
  if (p === 'rcCapacity') renderRcCapacity();
  if (p === 'rcManpower') renderRcManpower();
  if (p === 'mpDashboard') renderMpDashboard();
  if (p === 'mpCalendar') renderMpCalendar();
  if (p === 'mpOrg') renderMpOrg();
  if (p === 'mpVacancy') renderMpVacancy();
  if (p === 'mpScenario') renderMpScenario();
  if (p === 'exDashboard') renderExDashboard();
  if (p === 'exExternal') renderExExternal();
  if (p === 'exInternal') renderExInternal();
  if (p === 'exAttention') renderExAttention();
  if (p === 'exPreview') renderExPreview();
}

/* ============ STATUS LOGIC ============ */
function computeStatus(p) {
  if (p.progressStage >= 18) return 'done';
  const start = new Date(p.start), target = new Date(p.target), now = new Date();
  const totalDays = Math.max(1, (target - start) / 86400000);
  const elapsed = Math.min(totalDays, Math.max(0, (now - start) / 86400000));
  const expectedStage = (elapsed / totalDays) * 18;
  const diff = expectedStage - p.progressStage;
  if (now > target && p.progressStage < 18) return 'delay';
  if (diff > 5) return 'delay';
  if (diff > 2) return 'warning';
  return 'ontrack';
}
const STATUS_LABEL = { ontrack: 'On Track', warning: 'Warning', delay: 'Delay', done: 'Selesai' };
function daysLeft(target) {
  const d = Math.ceil((new Date(target) - new Date()) / 86400000);
  if (d < 0) return (Math.abs(d)) + ' hari terlambat';
  if (d === 0) return 'Deadline hari ini';
  return d + ' hari lagi';
}

/* ============ RENDER: DASHBOARD ============ */
function renderAll() { document.getElementById('navProjCount').textContent = projects.length; renderDashboard(); }
function renderDashboard() {
  const counts = { ontrack: 0, warning: 0, delay: 0, done: 0 };
  projects.forEach(p => counts[computeStatus(p)]++);
  document.getElementById('kpiRow').innerHTML = `
    <div class="kpi c-total"><div class="num">${projects.length}</div><div class="lbl">Total Project Aktif</div></div>
    <div class="kpi c-ok"><div class="num">${counts.ontrack}</div><div class="lbl">On Track</div></div>
    <div class="kpi c-warn"><div class="num">${counts.warning}</div><div class="lbl">Warning</div></div>
    <div class="kpi c-delay"><div class="num">${counts.delay}</div><div class="lbl">Delay</div></div>
    <div class="kpi c-done"><div class="num">${counts.done}</div><div class="lbl">Selesai</div></div>
  `;
  renderDashboardGrid();
  renderDashboardCharts();
}
function drawBarChart(id, data) {
  const svg = document.getElementById(id);
  const w = 500, h = 200, padL = 28, padB = 26, padT = 10, barGap = 14;
  const max = Math.max(...data.map(d => d.value), 1);
  const chartW = w - padL - 10, chartH = h - padT - padB;
  const barW = data.length ? (chartW / data.length) - barGap : chartW;
  let html = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}" stroke="#E4E8F2" stroke-width="1"/>
    <line x1="${padL}" y1="${h - padB}" x2="${w - 5}" y2="${h - padB}" stroke="#E4E8F2" stroke-width="1"/>`;
  data.forEach((d, i) => {
    const bh = (d.value / max) * chartH;
    const x = padL + 8 + i * (barW + barGap);
    const y = h - padB - bh;
    html += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="5" fill="${d.color || '#3B6FE0'}"></rect>
      <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="#16223F" font-family="Space Grotesk">${d.value}</text>
      <text x="${x + barW / 2}" y="${h - padB + 15}" text-anchor="middle" font-size="9.5" fill="#6B7490" font-family="Inter">${d.label}</text>`;
  });
  svg.innerHTML = html;
}
function renderDashboardCharts() {
  const lineCounts = {};
  projects.forEach(p => { lineCounts[p.line] = (lineCounts[p.line] || 0) + 1; });
  const palette = ['#3B6FE0', '#14B8A6', '#F2A93B', '#EF5A6F', '#22B67D', '#8C56E8', '#2E9DE0'];
  const barData = Object.keys(lineCounts).map((l, i) => ({ label: l.length > 10 ? l.slice(0, 9) + '…' : l, value: lineCounts[l], color: palette[i % palette.length] }));
  drawBarChart('lineBarChart', barData);

  const catData = [
    { v: projects.length, c: '#3B6FE0', l: 'Automation Project' },
    { v: supportJobs.length, c: '#EF5A6F', l: 'Komarigoto / PICA' },
    { v: globalSupport.length, c: '#8C56E8', l: 'Support Musashi Group' },
  ];
  drawDonut('jobTypeDonut', catData.map(d => ({ v: d.v, c: d.c })));
  document.getElementById('jobTypeLegend').innerHTML = catData.map(d =>
    `<div class="legend-row"><span class="legend-dot" style="background:${d.c};"></span>${d.l}<b>${d.v}</b></div>`
  ).join('');
}
function renderDashboardGrid() {
  const q = (document.getElementById('dashSearch').value || '').toLowerCase();
  const st = document.getElementById('dashStatus').value;
  const ln = document.getElementById('dashLine').value;
  const pc = document.getElementById('dashPic').value;
  const grid = document.getElementById('dashGrid');
  let list = projects.filter(p => {
    if (q && !(p.name.toLowerCase().includes(q) || p.no.toLowerCase().includes(q))) return false;
    if (st && computeStatus(p) !== st) return false;
    if (ln && p.line !== ln) return false;
    if (pc && p.pic !== pc) return false;
    return true;
  });
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <p>Tidak ada project yang cocok dengan filter.</p></div>`;
    return;
  }
  grid.innerHTML = list.map(p => cardHTML(p)).join('');
}
function cardHTML(p) {
  const status = computeStatus(p);
  const pct = Math.round((p.progressStage / 18) * 100);
  const stageIdx = Math.min(p.progressStage, 17);
  const segs = PHASES.map((ph, pi) => {
    const stagesInPhase = STAGES.filter(s => s.phase === pi).length;
    const doneInPhase = STAGES.filter((s, i) => s.phase === pi && i < p.progressStage).length;
    const fillPct = stagesInPhase ? Math.round((doneInPhase / stagesInPhase) * 100) : 0;
    return `<div class="track-seg" title="${ph.name}: ${doneInPhase}/${stagesInPhase}"><i style="width:${fillPct}%; background:${ph.hex};"></i></div>`;
  }).join('');
  return `<div class="proj-card" onclick="openDetail('${p.id}')">
    <div class="proj-head">
      <div><div class="proj-code mono">${p.no}</div><div class="proj-name">${escapeHTML(p.name)}</div></div>
      <span class="status-pill status-${status}">${STATUS_LABEL[status]}</span>
    </div>
    <div class="proj-meta"><span>📍 <b>${escapeHTML(p.line)}</b></span><span>🎯 ${daysLeft(p.target)}</span></div>
    <div class="track-labels"><span>Konsep</span><span>Approval</span><span>Build</span><span>Handover</span></div>
    <div class="track-mini">${segs}</div>
    <div class="proj-footer">
      <div><div class="progress-txt">${pct}% · Tahap ${p.progressStage}/18</div><div class="stage-now">${p.progressStage < 18 && STAGES[stageIdx] ? STAGES[stageIdx].n : 'Selesai — Serah Terima'}</div></div>
      <div class="avatars"><div class="mini-av" title="${p.pic}">${initials(p.pic)}</div><div class="mini-av" title="${p.support}">${initials(p.support)}</div></div>
    </div>
  </div>`;
}

/* ============ PROJECTS TABLE ============ */
function renderProjectsTable() {
  const body = document.getElementById('projTableBody');
  body.innerHTML = projects.map(p => {
    const status = computeStatus(p); const pct = Math.round((p.progressStage / 18) * 100);
    return `<tr style="cursor:pointer" onclick="openDetail('${p.id}')">
      <td class="mono">${p.no}</td><td><b>${escapeHTML(p.name)}</b></td><td>${escapeHTML(p.line)}</td><td>${escapeHTML(p.pic)}</td>
      <td class="mono">${fmtDate(p.start)}</td><td class="mono">${fmtDate(p.target)}</td>
      <td>${Math.min(p.progressStage + 1, 18)}/18</td><td>${pct}%</td>
      <td><span class="status-pill status-${status}">${STATUS_LABEL[status]}</span></td>
    </tr>`;
  }).join('');
}
function fmtDate(s) { if (!s) return '-'; const d = new Date(s); if (isNaN(d)) return s; return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }

/* ============ ADD PROJECT ============ */
function resetProjectForm() { ['npNo', 'npName', 'npLine', 'npStart', 'npTarget', 'npNote'].forEach(id => document.getElementById(id).value = ''); }
function saveNewProject() {
  const no = document.getElementById('npNo').value.trim();
  const name = document.getElementById('npName').value.trim();
  const line = document.getElementById('npLine').value.trim();
  const start = document.getElementById('npStart').value;
  const target = document.getElementById('npTarget').value;
  if (!name || !line || !start || !target) { alert('Nama project, line, tanggal start, dan target wajib diisi.'); return; }
  const payload = {
    no: no || 'NO-BUDGET', name, line,
    pic: document.getElementById('npPic').value,
    support: document.getElementById('npSupport').value,
    category: document.getElementById('npCat').value,
    start, target,
    note: document.getElementById('npNote').value
  };
  const btn = document.getElementById('npSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  apiPost('addProject', payload).then(res => {
    btn.disabled = false; btn.textContent = 'Simpan Project';
    if (!res.ok) { toast(res.message || 'Gagal menyimpan project', true); return; }
    projects.unshift(res.project);
    resetProjectForm(); initSelects();
    toast('Project "' + res.project.name + '" berhasil ditambahkan');
    goPage('dashboard');
  }).catch(err => { btn.disabled = false; btn.textContent = 'Simpan Project'; toast('Error: ' + err.message, true); });
}

/* ============ DAILY UPDATE ============ */
function renderDailyPage() { document.getElementById('duDate').value = new Date().toISOString().slice(0, 10); renderDailyLogList(); }
function resetDailyForm() { ['duPlan', 'duActual', 'duProblem', 'duNext'].forEach(id => document.getElementById(id).value = ''); }
function saveDailyUpdate() {
  const projId = document.getElementById('duProject').value;
  const p = projects.find(x => x.id === projId);
  if (!p) { alert('Pilih project terlebih dahulu.'); return; }
  const plan = document.getElementById('duPlan').value.trim();
  const actual = document.getElementById('duActual').value.trim();
  if (!plan || !actual) { alert('Plan dan Actual hari ini wajib diisi.'); return; }
  const stage = parseInt(document.getElementById('duStage').value);
  const payload = {
    projectId: projId, date: document.getElementById('duDate').value,
    engineer: document.getElementById('duEngineer').value, stage,
    plan, actual,
    problem: document.getElementById('duProblem').value || '-',
    next: document.getElementById('duNext').value || '-'
  };
  const btn = document.getElementById('duSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  apiPost('saveDailyLog', payload).then(res => {
    btn.disabled = false; btn.textContent = 'Submit Update';
    if (!res.ok) { toast(res.message || 'Gagal menyimpan update', true); return; }
    dailyLogs.unshift(res.log);
    applyProjectUpdate(res.project);
    resetDailyForm(); renderDailyLogList();
    toast('Update harian tersimpan untuk ' + p.no);
  }).catch(err => { btn.disabled = false; btn.textContent = 'Submit Update'; toast('Error: ' + err.message, true); });
}
function renderDailyLogList() {
  const list = document.getElementById('dailyLogList');
  if (dailyLogs.length === 0) { list.innerHTML = emptyHTML('Belum ada update harian.'); return; }
  list.innerHTML = dailyLogs.slice(0, 25).map(l => logItemHTML(l)).join('');
}
function logItemHTML(l) {
  return `<div class="log-item">
    <div class="lh"><b>${l.projectNo}</b><span>${fmtDate(l.date)} · ${l.engineer}</span></div>
    <div class="lp"><span>Plan:</span> ${escapeHTML(l.plan)}</div>
    <div class="lp"><span>Actual:</span> ${escapeHTML(l.actual)}</div>
    ${l.problem && l.problem !== '-' ? `<div class="lp"><span>Problem:</span> ${escapeHTML(l.problem)}</div>` : ''}
    <div class="lp"><span>Next:</span> ${escapeHTML(l.next)}</div>
  </div>`;
}
function emptyHTML(msg) {
  return `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><p>${msg}</p></div>`;
}
function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
function applyProjectUpdate(updated) {
  const i = projects.findIndex(x => x.id === updated.id);
  if (i >= 0) projects[i] = updated; else projects.unshift(updated);
}

/* ============ WEEKLY ============ */
function renderWeekly() {
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekLogs = dailyLogs.filter(l => new Date(l.date) >= weekAgo);
  const counts = { ontrack: 0, warning: 0, delay: 0, done: 0 };
  projects.forEach(p => counts[computeStatus(p)]++);

  document.getElementById('weeklySummary').innerHTML = `
    <div class="kpi c-total"><div class="num">${weekLogs.length}</div><div class="lbl">Update Masuk (7 Hari)</div></div>
    <div class="kpi c-ok"><div class="num">${counts.ontrack + counts.done}</div><div class="lbl">Project Hijau</div></div>
    <div class="kpi c-warn"><div class="num">${counts.warning}</div><div class="lbl">Project Kuning</div></div>
    <div class="kpi c-delay"><div class="num">${counts.delay}</div><div class="lbl">Project Merah</div></div>
  `;
  drawDonut('weeklyDonut', [
    { v: counts.ontrack, c: '#22B67D' }, { v: counts.warning, c: '#F2A93B' }, { v: counts.delay, c: '#EF5A6F' }, { v: counts.done, c: '#14B8A6' }
  ]);
  document.getElementById('weeklyLegend').innerHTML = `
    <div class="legend-row"><span class="legend-dot" style="background:#22B67D;"></span> On Track <b>${counts.ontrack}</b></div>
    <div class="legend-row"><span class="legend-dot" style="background:#F2A93B;"></span> Warning <b>${counts.warning}</b></div>
    <div class="legend-row"><span class="legend-dot" style="background:#EF5A6F;"></span> Delay <b>${counts.delay}</b></div>
    <div class="legend-row"><span class="legend-dot" style="background:#14B8A6;"></span> Selesai <b>${counts.done}</b></div>
  `;
  const byProj = {};
  weekLogs.forEach(l => { (byProj[l.projectNo] = byProj[l.projectNo] || []).push(l); });
  const wrap = document.getElementById('weeklyByProject');
  const keys = Object.keys(byProj);
  if (keys.length === 0) { wrap.innerHTML = emptyHTML('Belum ada update dalam 7 hari terakhir.'); return; }
  wrap.innerHTML = keys.map(no => {
    const p = projects.find(x => x.no === no);
    return `<div style="margin-bottom:18px;">
      <div style="font-weight:700; font-size:13px; margin-bottom:8px; color:var(--ink);">${no} ${p ? '— ' + escapeHTML(p.name) : ''} <span style="color:var(--mute); font-weight:500;">(${byProj[no].length} update)</span></div>
      <div class="log-list">${byProj[no].map(l => logItemHTML(l)).join('')}</div>
    </div>`;
  }).join('');
}
function drawDonut(id, data) {
  const total = data.reduce((a, b) => a + b.v, 0) || 1;
  let acc = 0;
  const svg = document.getElementById(id);
  let circles = `<circle cx="21" cy="21" r="15.9" fill="none" stroke="#E4E8F2" stroke-width="6"></circle>`;
  data.forEach(d => {
    const pct = (d.v / total) * 100;
    circles += `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${d.c}" stroke-width="6" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${25 - acc}" transform="rotate(-90 21 21)"></circle>`;
    acc += pct;
  });
  svg.innerHTML = circles + `<text x="21" y="23" text-anchor="middle" font-size="7" font-weight="700" fill="#16223F" font-family="Space Grotesk">${total}</text>`;
}

/* ============ MONTHLY ============ */
function renderMonthly() {
  const now = new Date();
  const monthLogs = dailyLogs.filter(l => { const d = new Date(l.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  const counts = { ontrack: 0, warning: 0, delay: 0, done: 0 };
  projects.forEach(p => counts[computeStatus(p)]++);
  const monthName = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  document.getElementById('monthlySummary').innerHTML = `
    <div class="kpi c-total"><div class="num">${projects.length}</div><div class="lbl">Total Project</div></div>
    <div class="kpi c-done"><div class="num">${counts.done}</div><div class="lbl">Selesai s/d ${monthName}</div></div>
    <div class="kpi c-warn"><div class="num">${monthLogs.length}</div><div class="lbl">Update Tercatat Bulan Ini</div></div>
    <div class="kpi c-delay"><div class="num">${counts.delay}</div><div class="lbl">Perlu Perhatian (Delay)</div></div>
  `;
  const body = document.getElementById('monthlyTableBody');
  body.innerHTML = projects.map(p => {
    const logsThis = dailyLogs.filter(l => l.projectNo === p.no && new Date(l.date).getMonth() === now.getMonth());
    const estStart = Math.max(0, p.progressStage - logsThis.length);
    return `<tr><td class="mono">${p.no}</td><td>${escapeHTML(p.name)}</td><td>${estStart}/18</td><td>${p.progressStage}/18</td>
      <td style="color:${p.progressStage - estStart > 0 ? '#178A5D' : '#6B7490'}; font-weight:700;">+${p.progressStage - estStart}</td>
      <td>${logsThis.length}</td></tr>`;
  }).join('');
}

/* ============ TEAM ============ */
function renderTeam() {
  const grid = document.getElementById('teamGrid');
  grid.innerHTML = TEAM.map(t => {
    const activeProj = projects.filter(p => p.pic === t.name || p.support === t.name);
    return `<div class="proj-card" style="cursor:default;">
      <div class="proj-head">
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="avatar" style="width:42px;height:42px;font-size:14px;">${initials(t.name)}</div>
          <div><div class="proj-name">${escapeHTML(t.name)}</div><div style="font-size:11px; color:var(--mute); margin-top:2px;">NRP ${t.nrp}</div></div>
        </div>
      </div>
      <div class="proj-meta" style="margin-bottom:10px;"><span>${escapeHTML(t.role)}</span></div>
      <div style="font-size:11px; color:var(--mute); border-top:1px dashed var(--line); padding-top:10px;">
        Terlibat di <b style="color:var(--ink2);">${activeProj.length}</b> project aktif
      </div>
    </div>`;
  }).join('');
}

/* ============ NON-PROJECT SUPPORT (KOMARIGOTO/PICA) ============ */
function renderSupport() {
  document.getElementById('sjDate').value = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekJobs = supportJobs.filter(j => new Date(j.date) >= weekAgo);
  const totalManDay = weekJobs.reduce((a, b) => a + Number(b.manDay), 0);
  const pct = Math.round((totalManDay / SUPPORT_CAPACITY_MANDAY_PER_WEEK) * 100);
  const byType = {};
  supportJobs.forEach(j => { byType[j.type] = (byType[j.type] || 0) + Number(j.manDay); });
  const topType = Object.keys(byType).sort((a, b) => byType[b] - byType[a])[0] || '-';

  document.getElementById('supportSummary').innerHTML = `
    <div class="kpi ${pct > 10 ? 'c-delay' : 'c-ok'}"><div class="num">${pct}%</div><div class="lbl">Alokasi Man-Day / Minggu (Target ≤10%)</div></div>
    <div class="kpi c-total"><div class="num">${totalManDay}</div><div class="lbl">Total Man-Day (7 Hari)</div></div>
    <div class="kpi c-warn"><div class="num">${weekJobs.length}</div><div class="lbl">Kejadian Minggu Ini</div></div>
    <div class="kpi c-done"><div class="num">${topType}</div><div class="lbl" style="font-size:11px;">Jenis Job Terbanyak</div></div>
  `;
  const body = document.getElementById('supportTableBody');
  body.innerHTML = supportJobs.map(j => `<tr>
    <td class="mono">${fmtDate(j.date)}</td><td><span class="status-pill" style="background:var(--blue-soft); color:var(--blue);">${j.type}</span></td>
    <td>${escapeHTML(j.line)}</td><td>${escapeHTML(j.pic)}</td><td class="mono">${j.manDay}</td><td style="max-width:320px;">${escapeHTML(j.desc)}</td>
  </tr>`).join('') || `<tr><td colspan="6" style="text-align:center; color:var(--mute); padding:24px;">Belum ada data</td></tr>`;
}
function resetSupportForm() { ['sjLine', 'sjManDay', 'sjDesc'].forEach(id => document.getElementById(id).value = ''); }
function saveSupportJob() {
  const line = document.getElementById('sjLine').value.trim();
  const manDay = parseFloat(document.getElementById('sjManDay').value);
  const desc = document.getElementById('sjDesc').value.trim();
  if (!line || !manDay || !desc) { alert('Line/Area, Man-Day, dan Deskripsi wajib diisi.'); return; }
  const payload = { date: document.getElementById('sjDate').value, type: document.getElementById('sjType').value, line, pic: document.getElementById('sjPic').value, manDay, desc };
  const btn = document.getElementById('sjSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  apiPost('saveSupportJob', payload).then(res => {
    btn.disabled = false; btn.textContent = 'Simpan';
    if (!res.ok) { toast(res.message || 'Gagal menyimpan', true); return; }
    supportJobs.unshift(res.job);
    resetSupportForm(); renderSupport();
    toast('Job non-project tersimpan');
  }).catch(err => { btn.disabled = false; btn.textContent = 'Simpan'; toast('Error: ' + err.message, true); });
}

/* ============ GLOBAL SUPPORT MUSASHI GROUP ============ */
const COUNTRY_COLOR = { 'Musashi Vietnam': '#22B67D', 'Musashi India': '#F2A93B', 'Musashi Brasil': '#3B6FE0', 'Musashi Mexico': '#EF5A6F', 'Musashi Jepang': '#8C56E8' };
function renderGlobal() {
  const grid = document.getElementById('globalGrid');
  const byCountry = {};
  globalSupport.forEach(g => { (byCountry[g.country] = byCountry[g.country] || []).push(g); });
  grid.innerHTML = Object.keys(byCountry).map(c => {
    const items = byCountry[c];
    const color = COUNTRY_COLOR[c] || '#3B6FE0';
    return `<div class="proj-card" style="cursor:default;">
      <div class="proj-head">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:22px;">${items[0].flag}</span>
          <div class="proj-name" style="margin-top:0;">${escapeHTML(c)}</div>
        </div>
        <span class="status-pill" style="background:${color}22; color:${color};">${items.length} Item</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
        ${items.map(it => `<div style="background:var(--cloud); border-radius:10px; padding:9px 12px; border-left:3px solid ${color};">
          <div style="font-size:12.5px; font-weight:600; color:var(--ink); margin-bottom:3px;">${escapeHTML(it.item)}</div>
          <div style="font-size:11px; color:var(--mute); display:flex; justify-content:space-between;"><span>${escapeHTML(it.pic)}</span><b style="color:${color};">${it.status}</b></div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}
function openGlobalForm() { document.getElementById('globalFormCard').style.display = 'block'; }
function saveGlobalItem() {
  const country = document.getElementById('gsCountry').value.trim();
  const item = document.getElementById('gsItem').value.trim();
  if (!country || !item) { alert('Negara/Plant dan Item Support wajib diisi.'); return; }
  const payload = { country, flag: document.getElementById('gsFlag').value || '🌏', pic: document.getElementById('gsPic').value, status: document.getElementById('gsStatus').value, item };
  const btn = document.getElementById('gsSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  apiPost('saveGlobalItem', payload).then(res => {
    btn.disabled = false; btn.textContent = 'Simpan';
    if (!res.ok) { toast(res.message || 'Gagal menyimpan', true); return; }
    globalSupport.unshift(res.item);
    ['gsCountry', 'gsFlag', 'gsItem'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('globalFormCard').style.display = 'none';
    renderGlobal();
    toast('Item support global ditambahkan');
  }).catch(err => { btn.disabled = false; btn.textContent = 'Simpan'; toast('Error: ' + err.message, true); });
}

/* ============ DETAIL MODAL ============ */
function openDetail(id) {
  currentDetailId = id;
  const p = projects.find(x => x.id === id);
  if (!p) return;
  document.getElementById('mdCode').textContent = p.no;
  document.getElementById('mdName').textContent = p.name;
  document.getElementById('mdPic').textContent = p.pic + ' / ' + p.support;
  document.getElementById('mdLine').textContent = p.line;
  document.getElementById('mdDates').textContent = fmtDate(p.start) + ' → ' + fmtDate(p.target);
  const status = computeStatus(p);
  document.getElementById('mdStatus').innerHTML = `<span class="status-pill status-${status}">${STATUS_LABEL[status]}</span>`;
  renderStageTab(p);
  renderHistoryTab(p);
  document.getElementById('qDate').value = new Date().toISOString().slice(0, 10);
  switchTab('tahap');
  document.getElementById('detailOverlay').classList.add('show');
}
function closeDetail() { document.getElementById('detailOverlay').classList.remove('show'); }
function switchTab(t) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tab-pane').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
}
function renderStageTab(p) {
  let html = '';
  PHASES.forEach((ph, pi) => {
    html += `<div class="phase-block"><div class="phase-title"><span class="phase-dot" style="background:${ph.hex};"></span>${ph.name}</div>`;
    STAGES.forEach((s, i) => {
      if (s.phase !== pi) return;
      const state = i < p.progressStage ? 'done' : (i === p.progressStage ? 'now' : 'pending');
      const sd = p.stageDates[i] || p.stageDates[String(i)];
      const dateInfo = sd ? fmtDate(sd.end || sd.start) : '—';
      html += `<div class="stage-row ${state}">
        <div class="stage-num">${state === 'done' ? '✓' : (i + 1)}</div>
        <div class="stage-name">${escapeHTML(s.n)}</div>
        <div class="stage-date">${dateInfo}</div>
        <div class="stage-action" style="text-align:right;">
          ${state === 'done' ? `<button class="undo-btn" onclick="undoStageUI('${p.id}',${i})">Batalkan</button>` : ''}
          ${state === 'now' ? `<button class="mark-btn" onclick="markStageUI('${p.id}',${i})">Tandai Selesai</button>` : ''}
          ${state === 'pending' ? `<span style="font-size:11px; color:var(--mute);">Menunggu</span>` : ''}
        </div>
      </div>`;
    });
    html += `</div>`;
  });
  document.getElementById('tab-tahap').innerHTML = html;
}
function markStageUI(pid, idx) {
  apiPost('markStage', { projectId: pid, idx }).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal update tahap', true); return; }
    applyProjectUpdate(res.project);
    openDetail(pid); renderDashboard();
    toast('Tahap "' + STAGES[idx].n + '" ditandai selesai');
  }).catch(err => toast('Error: ' + err.message, true));
}
function undoStageUI(pid, idx) {
  apiPost('undoStage', { projectId: pid, idx }).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal update tahap', true); return; }
    applyProjectUpdate(res.project);
    openDetail(pid); renderDashboard();
  }).catch(err => toast('Error: ' + err.message, true));
}
function renderHistoryTab(p) {
  const logs = dailyLogs.filter(l => l.projectNo === p.no);
  document.getElementById('tab-riwayat').innerHTML = logs.length ? `<div class="log-list">${logs.map(l => logItemHTML(l)).join('')}</div>` : emptyHTML('Belum ada riwayat update untuk project ini.');
}
function saveQuickUpdate() {
  const p = projects.find(x => x.id === currentDetailId);
  const plan = document.getElementById('qPlan').value.trim();
  const actual = document.getElementById('qActual').value.trim();
  if (!plan || !actual) { alert('Plan dan Actual wajib diisi.'); return; }
  const payload = {
    projectId: p.id, date: document.getElementById('qDate').value,
    engineer: document.getElementById('qEngineer').value, stage: p.progressStage,
    plan, actual,
    problem: document.getElementById('qProblem').value || '-',
    next: document.getElementById('qNext').value || '-'
  };
  const btn = document.getElementById('qSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  apiPost('saveDailyLog', payload).then(res => {
    btn.disabled = false; btn.textContent = 'Simpan Update';
    if (!res.ok) { toast(res.message || 'Gagal menyimpan update', true); return; }
    dailyLogs.unshift(res.log);
    applyProjectUpdate(res.project);
    ['qPlan', 'qActual', 'qProblem', 'qNext'].forEach(id => document.getElementById(id).value = '');
    renderHistoryTab(projects.find(x => x.id === p.id));
    toast('Update tersimpan untuk ' + p.no);
    switchTab('riwayat');
  }).catch(err => { btn.disabled = false; btn.textContent = 'Simpan Update'; toast('Error: ' + err.message, true); });
}

/* ============ TOAST ============ */
function toast(msg, isError) {
  const t = document.createElement('div'); t.className = 'toast' + (isError ? ' err' : ''); t.innerHTML = `<span class="dot"></span>${escapeHTML(msg)}`;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 2600);
}

/* ============ PPT EXPORT ============ */
function exportToPPT() {
  if (typeof PptxGenJS === 'undefined') { alert('Modul export PPT sedang dimuat, coba lagi dalam beberapa detik (butuh koneksi internet).'); return; }
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  const INK = '16223F', BLUE = '3B6FE0', AQUA = '14B8A6', AMBER = 'F2A93B', CORAL = 'EF5A6F', GREEN = '22B67D', CLOUD = 'F4F6FB';
  const counts = { ontrack: 0, warning: 0, delay: 0, done: 0 };
  projects.forEach(p => counts[computeStatus(p)]++);
  const todayStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

  let s = pptx.addSlide(); s.background = { color: INK };
  s.addText('PSP PROJECT CONTROL', { x: 0.6, y: 2.7, w: 12, h: 0.9, fontFace: 'Arial', fontSize: 40, bold: true, color: 'FFFFFF' });
  s.addText('Laporan Progress Project — Manufacturing Engineering, Plant & Special Project', { x: 0.6, y: 3.55, w: 11, h: 0.5, fontSize: 16, color: 'B7C1E6' });
  s.addText(todayStr, { x: 0.6, y: 6.6, w: 6, h: 0.4, fontSize: 12, color: '8C9AC7' });
  s.addText('PT Musashi Autoparts Indonesia', { x: 9.5, y: 6.6, w: 3.3, h: 0.4, fontSize: 12, color: '8C9AC7', align: 'right' });

  s = pptx.addSlide(); s.background = { color: 'FFFFFF' };
  s.addText('Ringkasan Kontrol Project', { x: 0.5, y: 0.35, w: 9, h: 0.5, fontSize: 24, bold: true, color: INK });
  const kpis = [['Total Project', projects.length, BLUE], ['On Track', counts.ontrack, GREEN], ['Warning', counts.warning, AMBER], ['Delay', counts.delay, CORAL], ['Selesai', counts.done, AQUA]];
  kpis.forEach((k, i) => {
    const x = 0.5 + i * 2.5;
    s.addShape('roundRect', { x, y: 1.1, w: 2.3, h: 1.5, fill: { color: CLOUD }, line: { color: 'E4E8F2' }, rectRadius: 0.08 });
    s.addText(String(k[1]), { x, y: 1.25, w: 2.3, h: 0.7, align: 'center', fontSize: 32, bold: true, color: k[2] });
    s.addText(k[0], { x, y: 1.9, w: 2.3, h: 0.5, align: 'center', fontSize: 11, color: '6B7490' });
  });
  const pieData = [{ name: 'Status Project', labels: ['On Track', 'Warning', 'Delay', 'Selesai'], values: [counts.ontrack, counts.warning, counts.delay, counts.done] }];
  s.addChart(pptx.ChartType.pie, pieData, { x: 0.5, y: 2.9, w: 5.6, h: 4.0, showLegend: true, legendPos: 'b', chartColors: [GREEN, AMBER, CORAL, AQUA], showValue: true });
  const lineCounts = {}; projects.forEach(p => { lineCounts[p.line] = (lineCounts[p.line] || 0) + 1; });
  const barData = [{ name: 'Project per Line', labels: Object.keys(lineCounts), values: Object.values(lineCounts) }];
  s.addChart(pptx.ChartType.bar, barData, { x: 6.4, y: 2.9, w: 6.4, h: 4.0, barColor: BLUE, showValue: true, catAxisLabelFontSize: 9, valAxisTitle: 'Jumlah Project' });

  s = pptx.addSlide(); s.background = { color: 'FFFFFF' };
  s.addText('Daftar Project & Status', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: INK });
  const rows = [[{ text: 'No Project', options: { bold: true, color: 'FFFFFF', fill: INK } }, { text: 'Nama Project', options: { bold: true, color: 'FFFFFF', fill: INK } }, { text: 'Line', options: { bold: true, color: 'FFFFFF', fill: INK } }, { text: 'PIC', options: { bold: true, color: 'FFFFFF', fill: INK } }, { text: 'Tahap', options: { bold: true, color: 'FFFFFF', fill: INK } }, { text: 'Status', options: { bold: true, color: 'FFFFFF', fill: INK } }]];
  projects.slice(0, 16).forEach(p => {
    const st = computeStatus(p); const stColor = { ontrack: GREEN, warning: AMBER, delay: CORAL, done: AQUA }[st];
    rows.push([{ text: p.no, options: { fontSize: 9 } }, { text: p.name, options: { fontSize: 9 } }, { text: p.line, options: { fontSize: 9 } }, { text: p.pic, options: { fontSize: 9 } }, { text: `${p.progressStage}/18`, options: { fontSize: 9 } }, { text: STATUS_LABEL[st], options: { fontSize: 9, color: stColor, bold: true } }]);
  });
  s.addTable(rows, { x: 0.5, y: 0.9, w: 12.3, colW: [1.5, 5.3, 1.8, 1.8, 0.9, 1], fontSize: 9, border: { type: 'solid', color: 'E4E8F2', pt: 0.5 }, autoPage: false });

  s = pptx.addSlide(); s.background = { color: 'FFFFFF' };
  s.addText('Job Loading di Luar Project Automasi', { x: 0.5, y: 0.3, w: 10, h: 0.5, fontSize: 22, bold: true, color: INK });
  s.addText('Support Komarigoto & PICA', { x: 0.5, y: 0.85, w: 10, h: 0.4, fontSize: 14, color: '6B7490' });
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekJobs = supportJobs.filter(j => new Date(j.date) >= weekAgo);
  const totalManDay = weekJobs.reduce((a, b) => a + Number(b.manDay), 0);
  const pct = Math.round((totalManDay / SUPPORT_CAPACITY_MANDAY_PER_WEEK) * 100);
  s.addShape('roundRect', { x: 0.5, y: 1.4, w: 3, h: 1.3, fill: { color: pct > 10 ? CORAL : GREEN }, rectRadius: 0.08 });
  s.addText(pct + '%', { x: 0.5, y: 1.5, w: 3, h: 0.7, align: 'center', fontSize: 28, bold: true, color: 'FFFFFF' });
  s.addText('Alokasi Man-Day/Minggu (Target ≤10%)', { x: 0.5, y: 2.15, w: 3, h: 0.5, align: 'center', fontSize: 9, color: 'FFFFFF' });
  const supRows = [[{ text: 'Tanggal', options: { bold: true, color: 'FFFFFF', fill: INK, fontSize: 9 } }, { text: 'Jenis', options: { bold: true, color: 'FFFFFF', fill: INK, fontSize: 9 } }, { text: 'Line/Area', options: { bold: true, color: 'FFFFFF', fill: INK, fontSize: 9 } }, { text: 'PIC', options: { bold: true, color: 'FFFFFF', fill: INK, fontSize: 9 } }, { text: 'Man-Day', options: { bold: true, color: 'FFFFFF', fill: INK, fontSize: 9 } }]];
  supportJobs.slice(0, 10).forEach(j => supRows.push([{ text: fmtDate(j.date), options: { fontSize: 9 } }, { text: j.type, options: { fontSize: 9 } }, { text: j.line, options: { fontSize: 9 } }, { text: j.pic, options: { fontSize: 9 } }, { text: String(j.manDay), options: { fontSize: 9 } }]));
  s.addTable(supRows, { x: 4, y: 1.4, w: 8.8, fontSize: 9, border: { type: 'solid', color: 'E4E8F2', pt: 0.5 } });

  s = pptx.addSlide(); s.background = { color: INK };
  s.addText('Support ke Musashi Group Dunia', { x: 0.5, y: 0.35, w: 10, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF' });
  const byCountry = {}; globalSupport.forEach(g => { (byCountry[g.country] = byCountry[g.country] || []).push(g); });
  Object.keys(byCountry).forEach((c, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const bx = 0.5 + col * 4.2, by = 1.1 + row * 3.1;
    s.addShape('roundRect', { x: bx, y: by, w: 4.0, h: 2.9, fill: { color: '1E2C52' }, line: { color: '2E3D6B' }, rectRadius: 0.08 });
    s.addText(c, { x: bx + 0.2, y: by + 0.15, w: 3.6, h: 0.4, fontSize: 13, bold: true, color: 'FFFFFF' });
    const items = byCountry[c].map(it => '• ' + it.item + '  [' + it.status + ']').join('\n');
    s.addText(items, { x: bx + 0.2, y: by + 0.55, w: 3.6, h: 2.2, fontSize: 9.5, color: 'B7C1E6', valign: 'top' });
  });

  s = pptx.addSlide(); s.background = { color: CORAL };
  s.addText('TUJUAN AKHIR', { x: 0.6, y: 2.6, w: 12, h: 0.6, fontSize: 20, bold: true, color: 'FFFFFF' });
  s.addText('Project On Time · Cost Saving Optimal · Reduce MP Tercapai · Zero OT Tepat Waktu · AI & Smart Factory Berkembang · Business Risk Turun Signifikan', { x: 0.6, y: 3.2, w: 12, h: 1.2, fontSize: 16, color: 'FFFFFF' });

  pptx.writeFile({ fileName: 'PSP-Project-Control-Report.pptx' });
  toast('Laporan PPT sedang di-generate...');
}

/* ============================================================
 *  PROJECT CONTROL V1.1 (Phase 2 — additive, calls new backend
 *  actions: projectMasterList / externalProjectList / addProjectMaster).
 *  Requires backend/production/*.gs to be deployed to PSP_API_URL;
 *  until then these calls return "Aksi tidak dikenal" and the
 *  existing toast() error path shows it — nothing else on the page
 *  is affected.
 *
 *  Status lists mirror Config!EXTERNAL_PROJECT_STATUS_LIST /
 *  Config!INTERNAL_PROJECT_STATUS_LIST on the server (see
 *  backend/production/ProjectMaster.gs ensurePhase2Config_). Kept
 *  as plain constants here rather than adding another API action,
 *  to stay within Phase 2's approved action list — if the server
 *  list is ever edited, update this list to match.
 * ============================================================ */
const PM_EXTERNAL_STATUSES = ['PIPELINE', 'RFQ', 'STUDY', 'QUOTATION', 'NEGOTIATION', 'PO', 'EXECUTION', 'ON HOLD', 'COMPLETED', 'CANCELLED'];
const PM_INTERNAL_STATUSES = ['PIPELINE', 'EXECUTION', 'ON HOLD', 'COMPLETED', 'CANCELLED'];
let pmProjects = [];

function loadProjectMasterList() {
  return apiPost('projectMasterList', {}).then(res => {
    pmProjects = (res && res.projects) || [];
    return pmProjects;
  }).catch(err => { toast('Error memuat Project Master: ' + err.message, true); return []; });
}

function pmFillStatusOptions(selectEl, statuses, includeAll) {
  selectEl.innerHTML = (includeAll ? '<option value="">Semua Status</option>' : '') +
    statuses.map(s => `<option value="${s}">${s}</option>`).join('');
}

function renderPmExternal() {
  pmFillStatusOptions(document.getElementById('pmExtStatus'), PM_EXTERNAL_STATUSES, true);
  const picSel = document.getElementById('pmExtPic');
  picSel.innerHTML = '<option value="">Semua PIC</option>' + TEAM.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  loadProjectMasterList().then(() => pmRenderExternalTable());
}
function pmRenderExternalTable() {
  const q = (document.getElementById('pmExtSearch').value || '').toLowerCase();
  const status = document.getElementById('pmExtStatus').value;
  const pic = document.getElementById('pmExtPic').value;
  const priority = document.getElementById('pmExtPriority').value;
  const body = document.getElementById('pmExternalTableBody');
  let list = pmProjects.filter(p => p.type === 'EXTERNAL');
  list = list.filter(p => {
    if (q && !((p.name || '').toLowerCase().includes(q) || (p.customer || '').toLowerCase().includes(q))) return false;
    if (status && p.status !== status) return false;
    if (pic && p.pic !== pic) return false;
    if (priority && p.priority !== priority) return false;
    return true;
  });
  body.innerHTML = list.length ? list.map(p => `<tr>
    <td class="mono">${escapeHTML(p.no || '-')}</td><td>${escapeHTML(p.customer || '-')}${p.plant ? ' / ' + escapeHTML(p.plant) : ''}</td>
    <td><b>${escapeHTML(p.name)}</b></td><td class="mono">${escapeHTML(p.rfqNo || '-')}</td><td class="mono">${escapeHTML(p.poNo || '-')}</td>
    <td>${escapeHTML(p.pic || '-')}</td><td><span class="status-pill" style="background:var(--blue-soft); color:var(--blue);">${escapeHTML(p.status)}</span></td>
    <td class="mono">${fmtDate(p.targetDate)}</td><td>${escapeHTML(p.priority || '-')}</td>
  </tr>`).join('') : `<tr><td colspan="9" style="text-align:center; color:var(--mute); padding:24px;">Belum ada External Project.</td></tr>`;
}

function renderPmInternal() {
  pmFillStatusOptions(document.getElementById('pmIntStatus'), PM_INTERNAL_STATUSES, true);
  const picSel = document.getElementById('pmIntPic');
  picSel.innerHTML = '<option value="">Semua PIC</option>' + TEAM.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  loadProjectMasterList().then(() => pmRenderInternalTable());
}
function pmRenderInternalTable() {
  const q = (document.getElementById('pmIntSearch').value || '').toLowerCase();
  const status = document.getElementById('pmIntStatus').value;
  const pic = document.getElementById('pmIntPic').value;
  const priority = document.getElementById('pmIntPriority').value;
  const body = document.getElementById('pmInternalTableBody');
  let list = pmProjects.filter(p => p.type === 'INTERNAL');
  list = list.filter(p => {
    if (q && !(p.name || '').toLowerCase().includes(q)) return false;
    if (status && p.status !== status) return false;
    if (pic && p.pic !== pic) return false;
    if (priority && p.priority !== priority) return false;
    return true;
  });
  body.innerHTML = list.length ? list.map(p => `<tr>
    <td class="mono">${escapeHTML(p.no || '-')}</td><td><b>${escapeHTML(p.name)}</b></td><td>${escapeHTML(p.category || '-')}</td>
    <td>${escapeHTML(p.pic || '-')}</td><td><span class="status-pill" style="background:var(--blue-soft); color:var(--blue);">${escapeHTML(p.status)}</span></td>
    <td class="mono">${fmtDate(p.targetDate)}</td><td>${escapeHTML(p.priority || '-')}</td>
  </tr>`).join('') : `<tr><td colspan="7" style="text-align:center; color:var(--mute); padding:24px;">Belum ada Internal Project.</td></tr>`;
}

function renderPmAddNew() {
  document.getElementById('pmTypeSelectCard').style.display = 'block';
  document.getElementById('pmExternalFormCard').style.display = 'none';
  document.getElementById('pmInternalFormCard').style.display = 'none';
  pmFillStatusOptions(document.getElementById('pmExtStatus2'), PM_EXTERNAL_STATUSES, false);
}
function pmSelectType(type) {
  document.getElementById('pmTypeSelectCard').style.display = 'none';
  document.getElementById('pmExternalFormCard').style.display = type === 'EXTERNAL' ? 'block' : 'none';
  document.getElementById('pmInternalFormCard').style.display = type === 'INTERNAL' ? 'block' : 'none';
}
function pmCancelAddNew() {
  renderPmAddNew();
}
function savePmProject(type) {
  const btn = document.getElementById(type === 'EXTERNAL' ? 'pmExtSaveBtn' : 'pmIntSaveBtn');
  let payload;
  if (type === 'EXTERNAL') {
    const name = document.getElementById('pmExtName').value.trim();
    const targetDate = document.getElementById('pmExtTarget').value;
    if (!name || !targetDate) { alert('Project Name dan Target Date wajib diisi.'); return; }
    payload = {
      type: 'EXTERNAL',
      customer: document.getElementById('pmExtCustomer').value.trim(),
      country: document.getElementById('pmExtCountry').value.trim(),
      rfqNo: document.getElementById('pmExtRfqNo').value.trim(),
      rfqDate: document.getElementById('pmExtRfqDate').value,
      name, note: document.getElementById('pmExtNote').value.trim(),
      pic: document.getElementById('pmExtPic2').value,
      priority: document.getElementById('pmExtPriority2').value,
      targetDate,
      status: document.getElementById('pmExtStatus2').value || 'PIPELINE'
    };
  } else {
    const name = document.getElementById('pmIntName').value.trim();
    const targetDate = document.getElementById('pmIntTarget').value;
    if (!name || !targetDate) { alert('Project Name dan Target Date wajib diisi.'); return; }
    payload = {
      type: 'INTERNAL',
      name, category: document.getElementById('pmIntCategory').value.trim(),
      pic: document.getElementById('pmIntPic2').value,
      priority: document.getElementById('pmIntPriority2').value,
      targetDate,
      note: document.getElementById('pmIntNote').value.trim()
    };
  }
  btn.disabled = true; btn.textContent = 'Menyimpan...';
  apiPost('addProjectMaster', payload).then(res => {
    btn.disabled = false; btn.textContent = 'Simpan';
    if (!res.ok) { toast(res.message || 'Gagal menyimpan project', true); return; }
    toast((type === 'EXTERNAL' ? 'External' : 'Internal') + ' project "' + res.project.name + '" berhasil ditambahkan');
    goPage(type === 'EXTERNAL' ? 'pmExternal' : 'pmInternal');
  }).catch(err => { btn.disabled = false; btn.textContent = 'Simpan'; toast('Error: ' + err.message, true); });
}

/* ============================================================
 *  RESOURCE & CAPACITY V1.1 (Phase 3 — additive foundation).
 *  Requires backend/production/*.gs (Phase 3) to be deployed to
 *  PSP_API_URL; until then these calls return "Aksi tidak dikenal"
 *  and the existing toast() error path shows it.
 * ============================================================ */
let rcWbsRows = [];

function rcProjectOptionsHtml() {
  return pmProjects.map(p => `<option value="${p.id}">${p.no ? p.no + ' — ' : ''}${escapeHTML(p.name)}</option>`).join('');
}

/* ---- WBS ---- */
function renderRcWbsPage() {
  loadProjectMasterList().then(() => {
    const sel = document.getElementById('rcWbsProject');
    sel.innerHTML = rcProjectOptionsHtml();
    if (sel.value) renderRcWbsTree();
  });
}
function renderRcWbsTree() {
  const projectId = document.getElementById('rcWbsProject').value;
  const treeEl = document.getElementById('rcWbsTree');
  const parentSel = document.getElementById('rcWbsParent');
  if (!projectId) { treeEl.innerHTML = emptyHTML('Pilih project terlebih dahulu.'); return; }
  apiPost('getActivities', { projectId }).then(res => {
    rcWbsRows = (res && res.wbs) || [];
    parentSel.innerHTML = '<option value="">— Top level —</option>' +
      rcWbsRows.map(w => `<option value="${w.id}">${'— '.repeat(w.level)}${escapeHTML(w.name)}</option>`).join('');
    if (!rcWbsRows.length) { treeEl.innerHTML = emptyHTML('Belum ada WBS untuk project ini.'); return; }
    treeEl.innerHTML = rcWbsRows.map(w => `<div style="padding:6px 0 6px ${(w.level - 1) * 20}px; border-bottom:1px dashed var(--line); font-size:12.5px; display:flex; justify-content:space-between;">
      <span>${w.level > 1 ? '↳ ' : ''}<b>${escapeHTML(w.name)}</b> <span style="color:var(--mute);">${escapeHTML(w.type || '')}</span></span>
      <span><span class="status-pill" style="background:var(--blue-soft); color:var(--blue);">${escapeHTML(w.status)}</span> <span style="color:var(--mute);">${w.planManDay} MD</span></span>
    </div>`).join('');
  }).catch(err => toast('Error memuat WBS: ' + err.message, true));
}
function saveRcWbs() {
  const projectId = document.getElementById('rcWbsProject').value;
  const name = document.getElementById('rcWbsName').value.trim();
  if (!projectId) { alert('Pilih project terlebih dahulu.'); return; }
  if (!name) { alert('Name wajib diisi.'); return; }
  const btn = document.getElementById('rcWbsSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  apiPost('createWBS', {
    projectId, parentId: document.getElementById('rcWbsParent').value || '', name,
    type: document.getElementById('rcWbsType').value.trim(), pic: document.getElementById('rcWbsPic').value,
    skill: document.getElementById('rcWbsSkill').value.trim(),
    startDate: document.getElementById('rcWbsStart').value, targetDate: document.getElementById('rcWbsTarget').value,
    planManDay: document.getElementById('rcWbsPlanMd').value || 0
  }).then(res => {
    btn.disabled = false; btn.textContent = 'Simpan WBS';
    if (!res.ok) { toast(res.message || 'Gagal menyimpan WBS', true); return; }
    ['rcWbsName', 'rcWbsType', 'rcWbsSkill', 'rcWbsStart', 'rcWbsTarget', 'rcWbsPlanMd'].forEach(id => document.getElementById(id).value = '');
    toast('WBS "' + res.wbs.name + '" ditambahkan');
    renderRcWbsTree();
  }).catch(err => { btn.disabled = false; btn.textContent = 'Simpan WBS'; toast('Error: ' + err.message, true); });
}

/* ---- WORKLOAD ---- */
function renderRcWorkload() {
  const periodType = document.getElementById('rcWorkloadPeriodType').value;
  apiPost('getWorkloadSummary', { periodType }).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat workload', true); return; }
    document.getElementById('rcWorkloadKpi').innerHTML = `
      <div class="kpi c-total"><div class="num">${res.totalPlannedMD}</div><div class="lbl">Total Planned MD</div></div>
      <div class="kpi c-ok"><div class="num">${res.totalActualMD}</div><div class="lbl">Total Actual MD</div></div>
      <div class="kpi c-warn"><div class="num">${Math.round(res.availableMD * 10) / 10}</div><div class="lbl">Available MD</div></div>
      <div class="kpi ${res.overloadMD > 0 ? 'c-delay' : 'c-done'}"><div class="num">${res.utilizationPct}%</div><div class="lbl">Utilization</div></div>
    `;
    const body = document.getElementById('rcWorkloadByType');
    body.innerHTML = ['EXTERNAL', 'INTERNAL', 'IRREGULAR'].map(t => `<tr><td>${t}</td><td>${res.byType[t].plannedMD}</td><td>${res.byType[t].actualMD}</td></tr>`).join('');
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ---- MAN-DAY (Resource Allocation) ---- */
function renderRcManDayPage() {
  loadProjectMasterList().then(() => {
    document.getElementById('rcMdProject').innerHTML = rcProjectOptionsHtml();
    renderRcManDayWbsOptions();
  });
}
function renderRcManDayWbsOptions() {
  const projectId = document.getElementById('rcMdProject').value;
  const wbsSel = document.getElementById('rcMdWbs');
  if (!projectId) { wbsSel.innerHTML = ''; return; }
  apiPost('getActivities', { projectId }).then(res => {
    const rows = (res && res.wbs) || [];
    wbsSel.innerHTML = rows.map(w => `<option value="${w.id}">${'— '.repeat(w.level)}${escapeHTML(w.name)}</option>`).join('');
    renderRcManDay();
  });
}
function renderRcManDay() {
  const wbsId = document.getElementById('rcMdWbs').value;
  const body = document.getElementById('rcManDayTableBody');
  if (!wbsId) { body.innerHTML = ''; document.getElementById('rcManDayTotal').textContent = '0'; return; }
  apiPost('getResourceAllocation', { wbsId }).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat alokasi', true); return; }
    body.innerHTML = res.allocations.length ? res.allocations.map(a =>
      `<tr><td>${escapeHTML(a.engineer)}</td><td>${escapeHTML(a.role)}</td><td>${a.planManDay}</td><td>${a.actualManDay}</td></tr>`
    ).join('') : `<tr><td colspan="4" style="text-align:center; color:var(--mute); padding:16px;">Belum ada alokasi.</td></tr>`;
    document.getElementById('rcManDayTotal').textContent = res.totalPlanManDay;
  }).catch(err => toast('Error: ' + err.message, true));
}
function saveRcManDay() {
  const wbsId = document.getElementById('rcMdWbs').value;
  const engineer = document.getElementById('rcMdEngineer').value;
  if (!wbsId) { alert('Pilih WBS/Activity terlebih dahulu.'); return; }
  const btn = document.getElementById('rcMdSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  apiPost('saveResourceAllocation', {
    wbsId, engineer, role: document.getElementById('rcMdRole').value,
    planManDay: document.getElementById('rcMdPlanMd').value || 0
  }).then(res => {
    btn.disabled = false; btn.textContent = 'Simpan';
    if (!res.ok) { toast(res.message || 'Gagal menyimpan alokasi', true); return; }
    document.getElementById('rcMdPlanMd').value = '';
    toast('Alokasi untuk ' + res.allocation.engineer + ' disimpan');
    renderRcManDay();
  }).catch(err => { btn.disabled = false; btn.textContent = 'Simpan'; toast('Error: ' + err.message, true); });
}

/* ---- CAPACITY ---- */
function renderRcCapacity() {
  const periodType = document.getElementById('rcCapacityPeriodType').value;
  Promise.all([
    apiPost('getCapacitySummary', { periodType }),
    apiPost('getEngineerLoading', { periodType }),
    apiPost('getSkillLoading', { periodType })
  ]).then(([cap, loading, skill]) => {
    if (!cap.ok) { toast(cap.message || 'Gagal memuat capacity', true); return; }
    document.getElementById('rcCapacityKpi').innerHTML = `
      <div class="kpi c-total"><div class="num">${cap.currentMp}</div><div class="lbl">Current MP</div></div>
      <div class="kpi c-ok"><div class="num">${cap.grossCapacityMD}</div><div class="lbl">Gross Capacity MD</div></div>
      <div class="kpi c-warn"><div class="num">${Math.round(cap.netCapacityMD * 10) / 10}</div><div class="lbl">Net Capacity MD</div></div>
      <div class="kpi c-done"><div class="num">${Math.round(cap.utilizationFactor * 100)}%</div><div class="lbl">Utilization Factor</div></div>
    `;
    const engBody = document.getElementById('rcEngineerLoadingBody');
    engBody.innerHTML = loading.engineers.length ? loading.engineers.map(e => `<tr>
      <td>${escapeHTML(e.engineer)}</td><td>${e.plannedMD}</td><td>${Math.round(e.availableMD * 10) / 10}</td>
      <td>${Math.round(e.overloadMD * 10) / 10}</td>
      <td><span class="status-pill" style="background:${e.status === 'OVERLOAD' ? 'var(--coral-soft)' : 'var(--green-soft)'}; color:${e.status === 'OVERLOAD' ? 'var(--coral)' : 'var(--green)'};">${e.status}</span></td>
    </tr>`).join('') : `<tr><td colspan="5" style="text-align:center; color:var(--mute); padding:16px;">Belum ada workload.</td></tr>`;
    const skillBody = document.getElementById('rcSkillLoadingBody');
    skillBody.innerHTML = skill.skills.length ? skill.skills.map(s => `<tr><td>${escapeHTML(s.skill)}</td><td>${s.plannedMD}</td><td>${s.actualMD}</td></tr>`).join('') : `<tr><td colspan="3" style="text-align:center; color:var(--mute); padding:16px;">Belum ada data.</td></tr>`;
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ---- MANPOWER ANALYSIS ---- */
function renderRcManpower() {
  const periodType = document.getElementById('rcMpPeriodType').value;
  apiPost('getManpowerAnalysis', { periodType }).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat analisis', true); return; }
    document.getElementById('rcMpKpi').innerHTML = `
      <div class="kpi c-total"><div class="num">${res.currentMp}</div><div class="lbl">Current MP</div></div>
      <div class="kpi c-warn"><div class="num">${Math.round(res.requiredMD * 10) / 10}</div><div class="lbl">Required MD</div></div>
      <div class="kpi c-ok"><div class="num">${Math.round(res.availableMD * 10) / 10}</div><div class="lbl">Available MD</div></div>
      <div class="kpi ${res.gapMD > 0 ? 'c-delay' : 'c-done'}"><div class="num">${Math.round(res.gapMD * 10) / 10}</div><div class="lbl">Gap MD</div></div>
      <div class="kpi c-warn"><div class="num">${res.indicativeAdditionalMP}</div><div class="lbl">Indicative Additional MP<br><span style="font-size:9px;">(system calc, not HR recommendation)</span></div></div>
      <div class="kpi c-total"><div class="num">+${res.managementBaselineAdditionalMP}</div><div class="lbl">Management Baseline<br><span style="font-size:9px;">(reference only)</span></div></div>
      <div class="kpi ${res.differenceVsBaseline >= 0 ? 'c-ok' : 'c-warn'}"><div class="num">${res.differenceVsBaseline > 0 ? '+' : ''}${res.differenceVsBaseline}</div><div class="lbl">Difference vs Baseline</div></div>
    `;
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ============================================================
 *  MANPOWER & CAPACITY V1.1 (Phase 4 — additive). Requires
 *  backend/production/*.gs (Phase 2-4) to be deployed; until then
 *  these calls return "Aksi tidak dikenal" and toast() shows it.
 * ============================================================ */
let mpOrgFlat = [];

/* ---- DASHBOARD (Part K) ---- */
function renderMpDashboard() {
  const periodType = document.getElementById('mpDashPeriodType').value;
  Promise.all([
    apiPost('getManpowerAnalysis', { periodType }),
    apiPost('getManpowerBySkill', { periodType }),
    apiPost('getEngineerLoading', { periodType }),
    apiPost('getVacancySummary', {}),
    apiPost('projectMasterList', {}),
    apiPost('getDataQualityReport', {})
  ]).then(([mp, skill, eng, vac, projects, dq]) => {
    if (!mp.ok) { toast(mp.message || 'Gagal memuat manpower analysis', true); return; }
    const externalCount = (projects.projects || []).filter(p => p.type === 'EXTERNAL').length;
    const internalCount = (projects.projects || []).filter(p => p.type === 'INTERNAL').length;
    document.getElementById('mpDashTopCards').innerHTML = `
      <div class="kpi c-total"><div class="num">${mp.currentMp}</div><div class="lbl">Current MP</div></div>
      <div class="kpi c-warn"><div class="num">${mp.idealMP.exact}</div><div class="lbl">Ideal MP<br><span style="font-size:9px;">(calculated, roundup ${mp.idealMP.roundedUp})</span></div></div>
      <div class="kpi ${mp.indicativeAdditionalMPExact > 0 ? 'c-delay' : 'c-done'}"><div class="num">${mp.indicativeAdditionalMPExact}</div><div class="lbl">Indicative Gap<br><span style="font-size:9px;">(not an HR decision)</span></div></div>
      <div class="kpi c-total"><div class="num">+${mp.managementBaselineAdditionalMP}</div><div class="lbl">Management Baseline<br><span style="font-size:9px;">(reference only)</span></div></div>
      <div class="kpi c-ok"><div class="num">${externalCount + internalCount}</div><div class="lbl">Active Projects<br><span style="font-size:9px;">${externalCount} External / ${internalCount} Internal</span></div></div>
      <div class="kpi c-warn"><div class="num">${dq.totalIssues || 0}</div><div class="lbl">Data Quality Issues</div></div>
    `;
    document.getElementById('mpDashSkillBody').innerHTML = skill.skills.length ? skill.skills.map(s => `<tr>
      <td>${escapeHTML(s.skill)}</td><td>${s.currentMp}</td><td>${s.workloadMD}</td><td>${s.availableMD}</td>
      <td style="color:${s.overloadMD > 0 ? 'var(--coral)' : 'var(--mute)'};">${s.overloadMD}</td>
    </tr>`).join('') : `<tr><td colspan="5" style="text-align:center; color:var(--mute); padding:16px;">Belum ada data.</td></tr>`;
    document.getElementById('mpDashEngineerBody').innerHTML = eng.engineers.length ? eng.engineers.map(e => `<tr>
      <td>${escapeHTML(e.engineer)}</td><td>${e.plannedMD}</td><td>${e.availableMD}</td>
      <td><span class="status-pill" style="background:${e.status === 'OVERLOAD' ? 'var(--coral-soft)' : e.status === 'HIGH LOAD' ? 'var(--amber-soft)' : 'var(--green-soft)'}; color:${e.status === 'OVERLOAD' ? 'var(--coral)' : e.status === 'HIGH LOAD' ? 'var(--amber)' : 'var(--green)'};">${e.status}</span></td>
    </tr>`).join('') : `<tr><td colspan="4" style="text-align:center; color:var(--mute); padding:16px;">Belum ada data.</td></tr>`;
    document.getElementById('mpDashVacancySummary').innerHTML = vac.vacancies.length ?
      vac.vacancies.map(v => `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px dashed var(--line); font-size:12.5px;">
        <span><b>${escapeHTML(v.name)}</b> ${v.skill ? '(' + escapeHTML(v.skill) + ')' : ''}</span>
        <span>Current ${v.current} / Ideal ${v.ideal} — <b style="color:${v.vacant > 0 ? 'var(--coral)' : 'var(--green)'};">Vacant ${v.vacant}</b></span>
      </div>`).join('') : emptyHTML('Belum ada struktur organisasi dengan target headcount.');
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ---- WORKLOAD CALENDAR (Part B) ---- */
function renderMpCalendar() {
  const scope = document.getElementById('mpCalScope').value;
  const valueSel = document.getElementById('mpCalValue');
  const needsValue = scope === 'ENGINEER' || scope === 'SKILL';
  valueSel.style.display = needsValue ? '' : 'none';
  if (needsValue && !valueSel.dataset.loaded) {
    if (scope === 'ENGINEER') valueSel.innerHTML = TEAM.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    else valueSel.innerHTML = [...new Set(TEAM.map(t => t.skill).filter(Boolean))].map(s => `<option value="${s}">${s}</option>`).join('');
    valueSel.dataset.loaded = '1';
  }
  if (!needsValue) valueSel.dataset.loaded = '';
  const periodType = document.getElementById('mpCalPeriodType').value;
  const value = needsValue ? valueSel.value : '';
  apiPost('getWorkloadCalendar', { periodType, scope, value }).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat workload calendar', true); return; }
    document.getElementById('mpCalKpi').innerHTML = `
      <div class="kpi c-total"><div class="num">${res.plannedMD}</div><div class="lbl">Planned MD</div></div>
      <div class="kpi c-ok"><div class="num">${res.actualMD}</div><div class="lbl">Actual MD</div></div>
      <div class="kpi c-warn"><div class="num">${res.availableMD}</div><div class="lbl">Available Capacity</div></div>
      <div class="kpi ${res.utilizationPct > 100 ? 'c-delay' : 'c-done'}"><div class="num">${res.utilizationPct}%</div><div class="lbl">Utilization</div></div>
      <div class="kpi ${res.overloadMD > 0 ? 'c-delay' : 'c-done'}"><div class="num">${res.overloadMD}</div><div class="lbl">Overload MD</div></div>
    `;
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ---- ORGANIZATION (Part C/D) ---- */
function renderMpOrg() {
  document.getElementById('mpOrgPerson').innerHTML = '<option value="">— Belum ditugaskan —</option>' + TEAM.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  apiPost('getOrgStructure', {}).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat struktur organisasi', true); return; }
    mpOrgFlat = res.flat;
    document.getElementById('mpOrgParent').innerHTML = '<option value="">— Root —</option>' +
      mpOrgFlat.map(n => `<option value="${n.id}">${'— '.repeat(n.level)}${escapeHTML(n.name)}</option>`).join('');
    const treeEl = document.getElementById('mpOrgTree');
    if (!res.tree.length) { treeEl.innerHTML = emptyHTML('Belum ada struktur organisasi.'); return; }
    treeEl.innerHTML = renderOrgTreeHtml(res.tree);
  }).catch(err => toast('Error: ' + err.message, true));
}
function renderOrgTreeHtml(nodes) {
  return nodes.map(n => `<div style="padding:6px 0 6px ${(n.level - 1) * 20}px; border-bottom:1px dashed var(--line); font-size:12.5px;">
    <div style="display:flex; justify-content:space-between;">
      <span>${n.level > 1 ? '↳ ' : ''}<b>${escapeHTML(n.name)}</b>${n.position ? ' — ' + escapeHTML(n.position) : ''}${n.personName ? ' (' + escapeHTML(n.personName) + ')' : ''}</span>
      <span>${n.idealHeadcount > 0 ? `Current ${n.currentHeadcount} / Ideal ${n.idealHeadcount} <b style="color:${n.vacantHeadcount > 0 ? 'var(--coral)' : 'var(--green)'};">Vacant ${n.vacantHeadcount}</b>` : ''}</span>
    </div>
    ${n.children && n.children.length ? renderOrgTreeHtml(n.children) : ''}
  </div>`).join('');
}
function saveMpOrgNode() {
  const name = document.getElementById('mpOrgName').value.trim();
  if (!name) { alert('Name wajib diisi.'); return; }
  const btn = document.getElementById('mpOrgSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan...';
  apiPost('createOrgNode', {
    parentId: document.getElementById('mpOrgParent').value || '', name,
    position: document.getElementById('mpOrgPosition').value.trim(),
    personName: document.getElementById('mpOrgPerson').value,
    skill: document.getElementById('mpOrgSkill').value.trim(),
    idealHeadcount: document.getElementById('mpOrgIdeal').value || 0
  }).then(res => {
    btn.disabled = false; btn.textContent = 'Simpan';
    if (!res.ok) { toast(res.message || 'Gagal menyimpan', true); return; }
    ['mpOrgName', 'mpOrgPosition', 'mpOrgSkill'].forEach(id => document.getElementById(id).value = '');
    toast('Branch "' + res.node.name + '" ditambahkan');
    renderMpOrg();
  }).catch(err => { btn.disabled = false; btn.textContent = 'Simpan'; toast('Error: ' + err.message, true); });
}

/* ---- VACANCY (Part H) ---- */
function renderMpVacancy() {
  apiPost('getVacancySummary', {}).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat vacancy', true); return; }
    const grid = document.getElementById('mpVacancyGrid');
    if (!res.vacancies.length) { grid.innerHTML = emptyHTML('Belum ada struktur organisasi dengan target headcount.'); return; }
    grid.innerHTML = res.vacancies.map(v => {
      const filledBoxes = Array.from({ length: v.current }).map(() => `<div style="width:28px; height:28px; border-radius:6px; background:var(--green); display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px;">●</div>`).join('');
      const vacantBoxes = Array.from({ length: v.vacant }).map(() => `<div style="width:28px; height:28px; border-radius:6px; border:2px dashed var(--coral); display:flex; align-items:center; justify-content:center; color:var(--coral); font-size:11px;">?</div>`).join('');
      return `<div class="proj-card" style="cursor:default;">
        <div class="proj-head"><div><div class="proj-name">${escapeHTML(v.name)}</div>${v.skill ? `<div style="font-size:11px; color:var(--mute);">${escapeHTML(v.skill)}</div>` : ''}</div>
        <span class="status-pill" style="background:${v.vacant > 0 ? 'var(--coral-soft)' : 'var(--green-soft)'}; color:${v.vacant > 0 ? 'var(--coral)' : 'var(--green)'};">Vacant ${v.vacant}</span></div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px;">${filledBoxes}${vacantBoxes}</div>
        <div style="font-size:11px; color:var(--mute); margin-top:10px;">Current ${v.current} / Ideal ${v.ideal}</div>
      </div>`;
    }).join('');
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ---- SCENARIO (Part I) ---- */
function renderMpScenario() {
  const periodType = document.getElementById('mpScenPeriodType').value;
  apiPost('getManpowerScenario', { periodType }).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat scenario', true); return; }
    document.getElementById('mpScenarioBody').innerHTML = res.scenarios.map(s => `<tr>
      <td><b>${s.label}</b></td><td>${s.simulatedMp}</td><td>${s.availableMD}</td>
      <td>${s.utilizationPct}%</td>
      <td style="color:${s.overloadMD > 0 ? 'var(--coral)' : 'var(--mute)'};">${s.overloadMD}</td>
      <td style="color:${s.remainingGapMD > 0 ? 'var(--coral)' : 'var(--green)'};">${s.remainingGapMD}</td>
    </tr>`).join('');
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ============================================================
 *  PHASE 5 — EXECUTIVE DASHBOARD + WEEKLY REPORT FOUNDATION
 *  Every table/card below only ever displays fields the server
 *  already returns — no client-side risk or health computation.
 * ============================================================ */

/* ---- EXECUTIVE DASHBOARD (Part A/B/C) ---- */
function renderExDashboard() {
  const periodType = document.getElementById('exDashPeriodType').value;
  apiPost('getExecutiveDashboard', { periodType }).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat executive dashboard', true); return; }
    const pf = res.summary.portfolio, pg = res.summary.progress, mp = res.manpower;
    document.getElementById('exDashPortfolioCards').innerHTML = `
      <div class="kpi c-total"><div class="num">${pf.totalActive}</div><div class="lbl">Total Project Aktif</div></div>
      <div class="kpi c-ok"><div class="num">${pf.external}</div><div class="lbl">External</div></div>
      <div class="kpi c-ok"><div class="num">${pf.internal}</div><div class="lbl">Internal</div></div>
      <div class="kpi c-warn"><div class="num">${pf.po}</div><div class="lbl">PO</div></div>
      <div class="kpi c-warn"><div class="num">${pf.execution}</div><div class="lbl">Execution</div></div>
      <div class="kpi c-done"><div class="num">${pf.completed}</div><div class="lbl">Completed</div></div>
      <div class="kpi c-total"><div class="num">${pf.onHold}</div><div class="lbl">On Hold</div></div>
    `;
    document.getElementById('exDashProgressCards').innerHTML = `
      <div class="kpi c-done"><div class="num">${pg.onTrack}</div><div class="lbl">On Track (GREEN)</div></div>
      <div class="kpi c-warn"><div class="num">${pg.atRisk}</div><div class="lbl">At Risk (ORANGE)</div></div>
      <div class="kpi c-delay"><div class="num">${pg.delayed}</div><div class="lbl">Delayed (RED)</div></div>
      <div class="kpi c-warn"><div class="num">${pg.withoutRecentUpdate}</div><div class="lbl">Tanpa Update Terbaru</div></div>
      <div class="kpi c-warn"><div class="num">${pg.nearTargetDate}</div><div class="lbl">Mendekati Target</div></div>
      <div class="kpi c-delay"><div class="num">${pg.overdue}</div><div class="lbl">Overdue</div></div>
    `;
    document.getElementById('exDashManpowerCards').innerHTML = `
      <div class="kpi c-total"><div class="num">${mp.currentMp}</div><div class="lbl">Current MP</div></div>
      <div class="kpi c-warn"><div class="num">${mp.requiredMp}</div><div class="lbl">Required MP<br><span style="font-size:9px;">(calculated)</span></div></div>
      <div class="kpi ${mp.additionalMp > 0 ? 'c-delay' : 'c-done'}"><div class="num">${mp.additionalMp}</div><div class="lbl">Indicative Additional MP<br><span style="font-size:9px;">(not an HR decision)</span></div></div>
      <div class="kpi c-total"><div class="num">+${mp.managementBaselineMp}</div><div class="lbl">Management Baseline<br><span style="font-size:9px;">(reference only)</span></div></div>
      <div class="kpi c-ok"><div class="num">${mp.managementTargetMp}</div><div class="lbl">Management Target MP<br><span style="font-size:9px;">Current + Baseline</span></div></div>
      <div class="kpi ${mp.utilizationPct > 100 ? 'c-delay' : 'c-done'}"><div class="num">${mp.utilizationPct}%</div><div class="lbl">Utilization</div></div>
      <div class="kpi ${mp.overloadedEngineers > 0 ? 'c-delay' : 'c-done'}"><div class="num">${mp.overloadedEngineers}</div><div class="lbl">Overload Engineers</div></div>
    `;
    const gs = res.globalSupport;
    document.getElementById('exDashGlobalSupport').innerHTML = `
      <div style="font-size:12.5px; line-height:1.9;">
        Active: <b>${gs.activeExternal}</b> &nbsp;|&nbsp; PO: <b>${gs.po}</b> &nbsp;|&nbsp; RFQ: <b>${gs.rfq}</b> &nbsp;|&nbsp; Execution: <b>${gs.execution}</b><br>
        Butuh update customer: <b style="color:${gs.requiringCustomerUpdate > 0 ? 'var(--coral)' : 'var(--green)'};">${gs.requiringCustomerUpdate}</b>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px;">
        <div>
          <div style="font-size:10.5px; color:var(--mute); text-transform:uppercase; margin-bottom:4px;">By Customer</div>
          ${gs.byCustomer.length ? gs.byCustomer.map(c => `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--line); font-size:12px;"><span>${escapeHTML(c.customer)}</span><b>${c.count}</b></div>`).join('') : '<span style="font-size:11px; color:var(--mute);">-</span>'}
        </div>
        <div>
          <div style="font-size:10.5px; color:var(--mute); text-transform:uppercase; margin-bottom:4px;">By Country</div>
          ${gs.byCountry.length ? gs.byCountry.map(c => `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--line); font-size:12px;"><span>${escapeHTML(c.country)}</span><b>${c.count}</b></div>`).join('') : '<span style="font-size:11px; color:var(--mute);">-</span>'}
        </div>
      </div>
    `;
    const dq = res.dataQuality;
    document.getElementById('exDashDataQuality').innerHTML = `
      <span class="status-pill" style="background:${dq.status === 'OK' ? 'var(--green-soft)' : 'var(--amber-soft)'}; color:${dq.status === 'OK' ? 'var(--green)' : 'var(--amber)'};">DATA QUALITY ${dq.status}</span>
      <span style="font-size:12px; color:var(--mute); margin-left:8px;">${dq.totalIssues} issue(s) — ${dq.bySeverity.ERROR || 0} error, ${dq.bySeverity.WARNING || 0} warning, ${dq.bySeverity.INFO || 0} info</span>
    `;
    const gl = res.globalSupportLegacy;
    document.getElementById('exDashGlobalSupportLegacy').innerHTML = `
      <p style="font-size:11px; color:var(--mute);">${escapeHTML(gl.note)}</p>
      <div style="font-size:12.5px;">Total: <b>${gl.total}</b></div>
      ${Object.keys(gl.byStatus).map(k => `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--line); font-size:12px;"><span>${escapeHTML(k)}</span><b>${gl.byStatus[k]}</b></div>`).join('')}
    `;
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ---- EXTERNAL WEEKLY REPORT (Part G/H/K) ---- */
function renderExExternal() {
  const week = document.getElementById('exExtWeek').value;
  const view = document.getElementById('exExtView').value;
  apiPost('getExternalWeeklyReport', week ? { week } : {}).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat external weekly report', true); return; }
    const s = res.summary;
    document.getElementById('exExtKpi').innerHTML = `
      <div class="kpi c-total"><div class="num">${s.totalActiveProject}</div><div class="lbl">Total Active</div></div>
      <div class="kpi c-warn"><div class="num">${s.poProject}</div><div class="lbl">PO</div></div>
      <div class="kpi c-done"><div class="num">${s.projectCompleted}</div><div class="lbl">Completed</div></div>
      <div class="kpi c-done"><div class="num">${s.projectOnTrack}</div><div class="lbl">On Track</div></div>
      <div class="kpi c-warn"><div class="num">${s.projectAtRisk}</div><div class="lbl">At Risk</div></div>
      <div class="kpi c-delay"><div class="num">${s.projectDelayed}</div><div class="lbl">Delayed</div></div>
    `;
    const rows = view === 'customer' ? res.customerFacingProjects : res.projects;
    const head = view === 'customer'
      ? ['Customer', 'Country', 'Plant', 'No', 'Nama Project', 'PIC', 'Status', 'Progress', 'Current Activity', 'Plan Minggu Ini', 'Actual', 'Problem', 'Next Action', 'Target', 'Schedule Status']
      : ['Customer', 'Country', 'Plant', 'No', 'Nama Project', 'PIC', 'Status', 'Progress', 'Current Activity', 'Plan Minggu Ini', 'Actual', 'Problem', 'Next Action', 'Target', 'Schedule Status', 'Risk', 'MD Plan', 'MD Actual'];
    document.getElementById('exExtTableHead').innerHTML = head.map(h => `<th>${h}</th>`).join('');
    document.getElementById('exExtTableBody').innerHTML = rows.length ? rows.map(r => {
      const cells = [
        escapeHTML(r.customer || ''), escapeHTML(r.country || '-'), escapeHTML(r.plant || ''), escapeHTML(r.projectNo || ''), escapeHTML(r.projectName || ''),
        escapeHTML(r.pic || ''), escapeHTML(r.status || ''), r.overallProgress + '%', escapeHTML(r.currentActivity || ''),
        escapeHTML(r.plannedThisWeek || ''), escapeHTML(r.actualThisWeek || ''), escapeHTML(r.problem || ''), escapeHTML(r.nextAction || ''),
        escapeHTML(r.targetDate || ''), `<span class="status-pill" style="background:${r.scheduleStatus === 'DELAYED' ? 'var(--coral-soft)' : r.scheduleStatus === 'AT RISK' ? 'var(--amber-soft)' : 'var(--green-soft)'}; color:${r.scheduleStatus === 'DELAYED' ? 'var(--coral)' : r.scheduleStatus === 'AT RISK' ? 'var(--amber)' : 'var(--green)'};">${r.scheduleStatus}</span>`
      ];
      if (view !== 'customer') cells.push(escapeHTML(r.riskLevel || ''), r.manDayPlanned, r.manDayActual);
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    }).join('') : `<tr><td colspan="${head.length}" style="text-align:center; color:var(--mute); padding:16px;">Belum ada external project pada periode ini.</td></tr>`;
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ---- INTERNAL WEEKLY REPORT (Part I) ---- */
function renderExInternal() {
  const week = document.getElementById('exIntWeek').value;
  apiPost('getInternalWeeklyReport', week ? { week } : {}).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat internal weekly report', true); return; }
    document.getElementById('exIntTableBody').innerHTML = res.projects.length ? res.projects.map(p => `<tr>
      <td>${escapeHTML(p.projectNo || '')}</td><td>${escapeHTML(p.projectName || '')}</td><td>${escapeHTML(p.pic || '')}</td>
      <td>${escapeHTML(p.status || '')}</td><td>${p.progress}%</td><td>${p.wbsCount}</td>
      <td>${escapeHTML(p.plannedThisWeek || '')}</td><td>${escapeHTML(p.actualThisWeek || '')}</td>
      <td>${escapeHTML(p.problem || '')}</td><td>${escapeHTML(p.nextAction || '')}</td>
      <td>${p.manDayPlanned}</td><td>${p.manDayActual}</td>
      <td>${p.loading ? escapeHTML(p.loading.status) : '-'}</td>
      <td><span class="status-pill">${escapeHTML(p.riskLevel || '')}</span></td>
    </tr>`).join('') : `<tr><td colspan="14" style="text-align:center; color:var(--mute); padding:16px;">Belum ada internal project.</td></tr>`;
    const irr = res.irregularJobs;
    document.getElementById('exIntIrregularBody').innerHTML = irr.byCategory.length ? irr.byCategory.map(c => `<tr>
      <td>${escapeHTML(c.category)}</td><td>${c.count}</td><td>${c.manDay}</td>
    </tr>`).join('') : `<tr><td colspan="3" style="text-align:center; color:var(--mute); padding:16px;">Tidak ada irregular job pada periode ini.</td></tr>`;
    document.getElementById('exIntIrregularTotal').textContent = `Total: ${irr.totalCount} job, ${irr.totalManDay} Man-Day (dibaca langsung dari SupportJobs — tidak ada duplikasi data).`;
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ---- PROJECTS NEED ATTENTION (Part L) ---- */
function renderExAttention() {
  apiPost('getProjectsNeedAttention', {}).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat attention list', true); return; }
    const grid = document.getElementById('exAttentionGrid');
    if (!res.projects.length) { grid.innerHTML = emptyHTML('Tidak ada project yang memerlukan perhatian saat ini.'); return; }
    const riskColor = { CRITICAL: 'coral', 'AT RISK': 'amber', WATCH: 'amber' };
    grid.innerHTML = res.projects.map(p => `<div class="proj-card" style="cursor:default;">
      <div class="proj-head">
        <div><div class="proj-name">#${p.priority} ${escapeHTML(p.projectName || '')}</div><div style="font-size:11px; color:var(--mute);">${escapeHTML(p.projectNo || '')} — PIC ${escapeHTML(p.pic || '-')}</div></div>
        <span class="status-pill" style="background:var(--${riskColor[p.riskLevel] || 'coral'}-soft); color:var(--${riskColor[p.riskLevel] || 'coral'});">${escapeHTML(p.riskLevel)}</span>
      </div>
      <div style="font-size:12.5px; margin-top:8px;"><b>Alasan:</b> ${escapeHTML(p.reason || '')}</div>
      <div style="font-size:12.5px; margin-top:4px;"><b>Rekomendasi:</b> ${escapeHTML(p.recommendedAction || '')}</div>
      <div style="font-size:11px; color:var(--mute); margin-top:8px;">Status ${escapeHTML(p.status || '-')} · Target ${escapeHTML(p.target || '-')} · Source: ${escapeHTML(p.source || '-')}</div>
    </div>`).join('');
  }).catch(err => toast('Error: ' + err.message, true));
}

/* ---- REPORTING PREVIEW (Part M) ---- */
function renderExPreview() {
  apiPost('getReportingPreview', {}).then(res => {
    if (!res.ok) { toast(res.message || 'Gagal memuat reporting preview', true); return; }
    const pf = res.summary.portfolio, pg = res.summary.progress;
    document.getElementById('exPreviewPortfolioCards').innerHTML = `
      <div class="kpi c-total"><div class="num">${pf.totalActive}</div><div class="lbl">Total Project Aktif</div></div>
      <div class="kpi c-ok"><div class="num">${pf.external}</div><div class="lbl">External</div></div>
      <div class="kpi c-ok"><div class="num">${pf.internal}</div><div class="lbl">Internal</div></div>
      <div class="kpi c-done"><div class="num">${pg.onTrack}</div><div class="lbl">On Track</div></div>
      <div class="kpi c-warn"><div class="num">${pg.atRisk}</div><div class="lbl">At Risk</div></div>
      <div class="kpi c-delay"><div class="num">${pg.delayed}</div><div class="lbl">Delayed</div></div>
    `;
    const ext = res.externalReportSummary;
    document.getElementById('exPreviewExternal').innerHTML = `
      <div style="font-size:12.5px; line-height:1.9;">
        Total Active: <b>${ext.totalActiveProject}</b><br>PO: <b>${ext.poProject}</b> · Completed: <b>${ext.projectCompleted}</b><br>
        On Track: <b>${ext.projectOnTrack}</b> · At Risk: <b>${ext.projectAtRisk}</b> · Delayed: <b>${ext.projectDelayed}</b>
      </div>`;
    const intl = res.internalReportSummary;
    document.getElementById('exPreviewInternal').innerHTML = `
      <div style="font-size:12.5px; line-height:1.9;">
        Total Internal Project: <b>${intl.totalProjects}</b><br>
        Irregular Job: <b>${intl.irregularJobs.totalCount}</b> job, <b>${intl.irregularJobs.totalManDay}</b> Man-Day
      </div>`;
    document.getElementById('exPreviewAttention').innerHTML = res.attention.length ? res.attention.map(p => `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px dashed var(--line); font-size:12.5px;">
        <span>#${p.priority} <b>${escapeHTML(p.projectName || '')}</b> (${escapeHTML(p.projectNo || '')})</span>
        <span class="status-pill">${escapeHTML(p.riskLevel)}</span>
      </div>`).join('') : emptyHTML('Tidak ada project yang memerlukan perhatian saat ini.');
  }).catch(err => toast('Error: ' + err.message, true));
}
