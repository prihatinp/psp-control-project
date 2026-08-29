/**
 * ============================================================
 *  PSP PROJECT CONTROL SYSTEM — BACKEND (Google Apps Script)
 *  Berperan sebagai REST-style JSON API untuk front-end statis
 *  yang di-hosting terpisah di GitHub Pages (folder /frontend).
 *
 *  Database: Google Spreadsheet (dibuat & diisi otomatis oleh
 *  fungsi setupSpreadsheet()).
 *
 *  KEAMANAN (baca README.md untuk detail lengkap):
 *   - Login (nama + PIN) -> server menerbitkan token bertanda-tangan
 *     HMAC-SHA256 (bukan disimpan di sheet, stateless, auto-expire).
 *   - SEMUA aksi yang membaca/mengubah data project mewajibkan token
 *     valid & belum kedaluwarsa (verifyToken_). Hanya action
 *     "teamNames" dan "login" yang boleh dipanggil tanpa token.
 *   - Percobaan login gagal dibatasi (anti brute-force) via CacheService.
 *   - Setiap token dibatasi jumlah request per menit (rate limit) via
 *     CacheService, mencegah penyalahgunaan/DoS sederhana.
 *   - Semua teks yang disimpan ke Spreadsheet disanitasi agar tidak
 *     bisa memicu "formula injection" (=, +, -, @ di awal sel).
 *   - Rahasia (HMAC secret) hanya ada di server (Script Properties),
 *     TIDAK PERNAH dikirim ke client / tersimpan di kode sumber.
 * ============================================================
 *
 * CARA SETUP: lihat README.md.
 */

const SHEET_NAMES = {
  TEAM: 'Team',
  STAGES: 'Stages',
  PHASES: 'Phases',
  PROJECTS: 'Projects',
  DAILY: 'DailyLogs',
  SUPPORT: 'SupportJobs',
  GLOBAL: 'GlobalSupport',
  CONFIG: 'Config',
  // --- Phase 2 addition: new sheet, existing keys/values above are untouched ---
  PROJECT_MASTER: 'PROJECT_MASTER',
  // --- Phase 3 additions: two new sheets, existing keys/values above are untouched ---
  WBS: 'WBS',
  RESOURCE_ALLOCATION: 'RESOURCE_ALLOCATION'
};

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;   // token berlaku 8 jam
const RATE_LIMIT_PER_MIN = 60;             // maks 60 request/menit per token (atau per IP anonim)
const LOGIN_MAX_FAIL = 5;                  // maks 5 kali gagal login berturut-turut
const LOGIN_LOCK_SEC = 15 * 60;            // lalu dikunci 15 menit

/* ============================================================
 *  WEB APP ENTRY POINTS (JSON API — dipanggil dari GitHub Pages)
 * ============================================================ */
function doGet(e) {
  try {
    const action = e.parameter.action;
    if (!action) {
      return jsonOut_({ ok: true, message: 'PSP Project Control API is running.' });
    }
    if (action === 'teamNames') {
      return jsonOut_(publicTeamNames_());
    }
    return jsonOut_({ ok: false, message: 'Aksi GET tidak diizinkan. Gunakan POST untuk aksi ini.' });
  } catch (err) {
    return jsonOut_({ ok: false, message: 'Server error: ' + err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;

    if (action === 'login') {
      return jsonOut_(handleLogin_(body));
    }

    // semua action lain wajib token valid
    const auth = verifyToken_(body.token);
    if (!auth) {
      return jsonOut_({ ok: false, authError: true, message: 'Sesi tidak valid atau kedaluwarsa.' });
    }
    if (!checkRateLimit_(auth.n)) {
      return jsonOut_({ ok: false, message: 'Terlalu banyak permintaan, coba lagi sebentar lagi.' });
    }

    switch (action) {
      case 'bootstrap': return jsonOut_(Object.assign({ ok: true }, getBootstrapData_()));
      case 'addProject': return jsonOut_(handleAddProject_(body, auth));
      case 'saveDailyLog': return jsonOut_(handleSaveDailyLog_(body, auth));
      case 'markStage': return jsonOut_(handleMarkStage_(body, auth));
      case 'undoStage': return jsonOut_(handleUndoStage_(body, auth));
      case 'saveSupportJob': return jsonOut_(handleSaveSupportJob_(body, auth));
      case 'saveGlobalItem': return jsonOut_(handleSaveGlobalItem_(body, auth));
      // --- Phase 2 additions (PROJECT_MASTER + External stream). Handlers live in
      //     ProjectMaster.gs, a separate file in this same Apps Script project. ---
      case 'addProjectMaster': return jsonOut_(handleAddProjectMaster_(body, auth));
      case 'updateProjectMaster': return jsonOut_(handleUpdateProjectMaster_(body, auth));
      case 'getProjectMaster': return jsonOut_(handleGetProjectMaster_(body));
      case 'projectMasterList': return jsonOut_(handleProjectMasterList_(body));
      case 'externalProjectList': return jsonOut_(handleExternalProjectList_());
      case 'migrateLegacyProjects': return jsonOut_(handleMigrateLegacyProjects_(body, auth));
      // --- Phase 3 additions (WBS + Man-Day + Workload + Capacity foundation).
      //     Handlers live in WbsWorkload.gs, a separate file in this same project. ---
      case 'createWBS': return jsonOut_(handleCreateWbs_(body, auth));
      case 'createActivity': return jsonOut_(handleCreateWbs_(body, auth));
      case 'updateWBS': return jsonOut_(handleUpdateWbs_(body, auth));
      case 'updateActivity': return jsonOut_(handleUpdateWbs_(body, auth));
      case 'deleteWBS': return jsonOut_(handleDeleteWbs_(body, auth));
      case 'getWBS': return jsonOut_(handleGetWbs_(body));
      case 'getActivities': return jsonOut_(handleListWbsForProject_(body));
      case 'listWbsForProject': return jsonOut_(handleListWbsForProject_(body));
      case 'saveResourceAllocation': return jsonOut_(handleSaveResourceAllocation_(body, auth));
      case 'getResourceAllocation': return jsonOut_(handleGetResourceAllocation_(body));
      case 'getWorkloadSummary': return jsonOut_(handleGetWorkloadSummary_(body));
      case 'getCapacitySummary': return jsonOut_(handleGetCapacitySummary_(body));
      case 'getEngineerLoading': return jsonOut_(handleGetEngineerLoading_(body));
      case 'getSkillLoading': return jsonOut_(handleGetSkillLoading_(body));
      case 'getManpowerAnalysis': return jsonOut_(handleGetManpowerAnalysis_(body));
      default: return jsonOut_({ ok: false, message: 'Aksi tidak dikenal.' });
    }
  } catch (err) {
    return jsonOut_({ ok: false, message: 'Server error: ' + err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
 *  SECRET / TOKEN (HMAC, stateless, auto-expire)
 * ============================================================ */
function getSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('HMAC_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('HMAC_SECRET', secret);
  }
  return secret;
}

function makeToken_(user) {
  const payload = { n: user.name, r: user.role, exp: Date.now() + TOKEN_TTL_MS };
  const payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const sig = signPayload_(payloadB64);
  return payloadB64 + '.' + sig;
}

function signPayload_(payloadB64) {
  const raw = Utilities.computeHmacSha256Signature(payloadB64, getSecret_());
  return Utilities.base64EncodeWebSafe(raw);
}

function verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const payloadB64 = parts[0], sig = parts[1];
  const expectedSig = signPayload_(payloadB64);
  if (sig !== expectedSig) return null; // tanda tangan tidak cocok -> token dipalsukan/rusak
  let payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadB64)).getDataAsString());
  } catch (e) {
    return null;
  }
  if (!payload || !payload.exp || Date.now() > payload.exp) return null; // kedaluwarsa
  if (!payload.n) return null;
  return payload;
}

/* ============================================================
 *  RATE LIMIT & BRUTE-FORCE PROTECTION (CacheService)
 * ============================================================ */
function checkRateLimit_(key) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'rate_' + key;
  const current = Number(cache.get(cacheKey) || 0);
  if (current >= RATE_LIMIT_PER_MIN) return false;
  cache.put(cacheKey, String(current + 1), 60); // reset tiap 60 detik
  return true;
}

function isLoginLocked_(name) {
  const cache = CacheService.getScriptCache();
  return cache.get('lock_' + name) === '1';
}
function recordLoginFail_(name) {
  const cache = CacheService.getScriptCache();
  const key = 'fail_' + name;
  const count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), LOGIN_LOCK_SEC);
  if (count >= LOGIN_MAX_FAIL) {
    cache.put('lock_' + name, '1', LOGIN_LOCK_SEC);
  }
}
function clearLoginFail_(name) {
  const cache = CacheService.getScriptCache();
  cache.remove('fail_' + name);
  cache.remove('lock_' + name);
}

/* ============================================================
 *  INPUT SANITIZATION (cegah formula/CSV injection di Spreadsheet)
 * ============================================================ */
function sanitizeStr_(s) {
  if (s === undefined || s === null) return '';
  s = String(s);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // cegah string dieksekusi sebagai formula saat sheet dibuka
  return s.slice(0, 4000); // batasi panjang wajar
}
function sanitizeObjStrings_(obj, fields) {
  const out = Object.assign({}, obj);
  fields.forEach(function (f) { if (out[f] !== undefined) out[f] = sanitizeStr_(out[f]); });
  return out;
}

/* ============================================================
 *  SPREADSHEET HELPERS
 * ============================================================ */
function getSS_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SS_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (err) { /* fallthrough */ }
  }
  const ss = SpreadsheetApp.create('PSP Project Control - Database');
  props.setProperty('SS_ID', ss.getId());
  return ss;
}
function getSheet_(name) {
  const ss = getSS_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}
function ensureHeader_(sheet, headers) {
  const first = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const isEmpty = first.every(function (v) { return v === '' || v === null; });
  if (isEmpty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}
function rowsToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    out.push(obj);
  }
  return out;
}
function findRowIndexById_(sheet, idColName, id) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf(idColName);
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(id)) return r + 1;
  }
  return -1;
}
function newId_(prefix) { return prefix + '_' + Utilities.getUuid().slice(0, 8); }
function todayStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Jakarta', 'yyyy-MM-dd'); }
function fmtDateCell_(v) { if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd'); return v; }

/* ============================================================
 *  SETUP + SEED DATA (jalankan sekali secara manual dari editor)
 * ============================================================ */
function setupSpreadsheet() {
  const ss = getSS_();
  ss.rename('PSP Project Control - Database');
  setupTeamSheet_();
  setupStagesSheet_();
  setupPhasesSheet_();
  setupConfigSheet_();
  setupProjectsSheet_();
  setupDailySheet_();
  setupSupportSheet_();
  setupGlobalSheet_();
  // --- Phase 2 addition: new sheet + config keys, appended after all legacy setup calls above ---
  setupProjectMasterSheet_();
  ensurePhase2Config_();
  // --- Phase 3 addition: two new sheets + config keys, appended after Phase 2's calls above ---
  setupWbsSheet_();
  setupResourceAllocationSheet_();
  ensurePhase3Config_();
  getSecret_(); // pastikan HMAC secret sudah dibuat
  const sh1 = ss.getSheetByName('Sheet1');
  if (sh1 && ss.getSheets().length > 1) ss.deleteSheet(sh1);
  Logger.log('Setup selesai. Spreadsheet URL: ' + ss.getUrl());
  return ss.getUrl();
}

function setupTeamSheet_() {
  const sh = getSheet_(SHEET_NAMES.TEAM);
  ensureHeader_(sh, ['NRP', 'Name', 'Role', 'Skill']);
  if (sh.getLastRow() > 1) return;
  const team = [
    ['535', 'Prihatin Purwadi', 'Section Head', 'Analysis, Plan & Relationship'],
    ['426', 'Sukiyo', 'Design Electric, Wiring & PLC Programmer', 'Electrical / PLC'],
    ['943', 'Wardiyono', 'Design & Assy Mekanik', 'Mechanical Design'],
    ['1195', 'Muharir', 'Design & Assy Mekanik', 'Mechanical Design'],
    ['942', 'Fajar Sani', 'Design & Assy Mekanik', 'Mechanical Design'],
    ['713', 'Nugroho Edy S', 'Design Electric, Wiring & PLC Programmer', 'Electrical / PLC'],
    ['29', 'Sumarko', 'Layout, Control Asset', 'Layout & Asset'],
    ['124', 'Eko Nurcahyanto', 'Report, Layout, Control Asset & Koordinator', 'Layout & Report'],
    ['1224', 'Chilvi Octafia Rizki', 'Admin', 'Administrasi'],
    ['1348', 'Teguh Rianto', 'IoT, AGV & Electric', 'IoT / AGV'],
    ['1386', 'Fahri Wahyu Prastama', 'AI & Programmer Software', 'AI / Software'],
    ['16353', 'Satria Naufal Jauhari', 'AI & Programmer Software', 'AI / Software'],
    ['16355', 'Iqbal Fauzan', 'IoT & AGV', 'IoT / AGV'],
    ['16359', 'Muhammad Zidan Arrizik', 'Wiring Electric', 'Electrical']
  ];
  sh.getRange(2, 1, team.length, 4).setValues(team);
}
function setupStagesSheet_() {
  const sh = getSheet_(SHEET_NAMES.STAGES);
  ensureHeader_(sh, ['Idx', 'Name', 'PhaseIdx']);
  if (sh.getLastRow() > 1) return;
  const names = [
    'Penentuan Tema', 'Observasi', 'Konsep', 'Design Assy', 'Detail Drawing',
    'Breakdown Part List (Mekanik & Elektrik)',
    'Request & Approval Penawaran', 'Management Meeting', 'Propose Ringgi', 'PO', 'Incoming Parts',
    'Assembling', 'Programming', 'Trial', 'Running',
    'Approval Monitoring Masspro', 'Evaluasi', 'Serah Terima ke Produksi'
  ];
  const phaseOf = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3];
  const rows = names.map(function (n, i) { return [i, n, phaseOf[i]]; });
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
}
function setupPhasesSheet_() {
  const sh = getSheet_(SHEET_NAMES.PHASES);
  ensureHeader_(sh, ['Idx', 'Name', 'Hex']);
  if (sh.getLastRow() > 1) return;
  const rows = [[0, 'Konsep & Design', '#3B6FE0'], [1, 'Approval & Procurement', '#F2A93B'], [2, 'Build & Trial', '#14B8A6'], [3, 'Handover', '#22B67D']];
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
}
function setupConfigSheet_() {
  const sh = getSheet_(SHEET_NAMES.CONFIG);
  ensureHeader_(sh, ['Key', 'Value']);
  if (sh.getLastRow() > 1) return;
  sh.getRange(2, 1, 2, 2).setValues([['LOGIN_PIN', 'psp2026'], ['SUPPORT_CAPACITY_MANDAY_PER_WEEK', '60']]);
}
function setupProjectsSheet_() {
  const sh = getSheet_(SHEET_NAMES.PROJECTS);
  const headers = ['ID', 'No', 'Name', 'Line', 'PIC', 'Support', 'Category', 'Start', 'Target', 'ProgressStage', 'StageDatesJSON', 'StageNotesJSON', 'Note', 'CreatedAt'];
  ensureHeader_(sh, headers);
  if (sh.getLastRow() > 1) return;
  function mk(no, name, line, pic, support, start, target, stage) {
    return [newId_('p'), no, name, line, pic, support, 'Reduce MP', start, target, stage, '{}', '{}', '', new Date().toISOString()];
  }
  const rows = [
    mk('2026-PSP-001', 'Automation MC Reamer Finishing Cam Shaft Line-7 (MC 37015)', 'C/S Fact 3', 'Wardiyono', 'Nugroho Edy S', '2026-04-01', '2026-05-30', 10),
    mk('2026-PSP-002', 'Automation MC Reamer Finishing Cam Shaft Line-8 (MC 39054)', 'C/S Fact 3', 'Wardiyono', 'Nugroho Edy S', '2026-04-15', '2026-06-15', 7),
    mk('2026-PSP-006', 'Renewal Automation Line C/S Fact 3', 'C/S Fact 3', 'Muharir', 'Sukiyo', '2026-04-01', '2026-08-15', 5),
    mk('2026-PSP-012', 'Automation FAS Line-5 dengan Robot Palletizing BOK 62015', 'FAS Fact 2', 'Fajar Sani', 'Sukiyo', '2026-04-01', '2026-05-30', 15),
    mk('2026-PSP-013', 'Automation Hizumitori Fact-1', 'Factory 1', 'Wardiyono', 'Nugroho Edy S', '2026-04-01', '2026-05-30', 18),
    mk('2026-PSP-015', 'Automation Shaft Input D11K Machining', 'Karawang', 'Fahri Wahyu Prastama', 'Satria Naufal Jauhari', '2026-09-01', '2026-12-20', 3),
    mk('2026-PSP-016', 'Automation Instocker Washing Assy Diff Com', 'Karawang', 'Muharir', 'Sukiyo', '2026-05-01', '2026-08-30', 6),
    mk('2026-PSP-017', 'Automation Honing Pinion Diff dan Bevel MC Fine Boring', 'Karawang', 'Muharir', 'Sukiyo', '2026-06-01', '2026-09-30', 8),
    mk('NO-BUDGET', 'Automation Camshaft 4R Mach Line-1 (Centering-Lathe-DTR-Oil Hole-Milling)', 'Karawang', 'Fajar Sani', 'Sukiyo', '2026-08-01', '2027-02-28', 2),
    mk('NO-BUDGET', 'Automation Camshaft 4R Mach Line-2 (Centering-Lathe-DTR-Oil Hole-Milling)', 'Karawang', 'Fajar Sani', 'Sukiyo', '2026-08-01', '2027-03-30', 1),
    mk('2026-PSP-020', 'Automation Loading In-Stocker MGS Line-1 12167', 'Fact 2 (MGS)', 'Wardiyono', 'Nugroho Edy S', '2026-01-01', '2026-04-30', 13),
    mk('2026-PSP-014', 'Automation MC 12169-71002-48018 (K58 C-3 & C-5)', 'Machining 1 Fact 1', 'Muharir', 'Sukiyo', '2026-06-01', '2026-09-30', 9),
    mk('2026-PSP-021', 'Additional Pre-washing Machine Cam Shaft Finishing Line-6', 'Karawang', 'Fajar Sani', 'Sukiyo', '2026-08-01', '2027-02-28', 0),
    mk('2026-PSP-005', 'Automation MC Reamer Finishing Cam Shaft Line-3 (MC 37005)', 'C/S Fact 3', 'Wardiyono', 'Nugroho Edy S', '2026-04-01', '2026-06-30', 18)
  ];
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}
function setupDailySheet_() {
  const sh = getSheet_(SHEET_NAMES.DAILY);
  const headers = ['ID', 'ProjectID', 'ProjectNo', 'Date', 'Engineer', 'Stage', 'Plan', 'Actual', 'Problem', 'Next', 'CreatedAt'];
  ensureHeader_(sh, headers);
  if (sh.getLastRow() > 1) return;
  function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd'); }
  const rows = [
    [newId_('l'), '', '2026-PSP-001', daysAgo(1), 'Wardiyono', 9, 'Finalisasi drawing breakdown part mekanik', 'Breakdown part 90% selesai, list elektrik masih perlu review PLC', 'Menunggu konfirmasi spare part reamer dari vendor', 'Follow up vendor & lanjut request penawaran', new Date().toISOString()],
    [newId_('l'), '', '2026-PSP-012', daysAgo(2), 'Fajar Sani', 14, 'Trial robot palletizing BOK 62015', 'Trial cycle 1-2 berhasil, cycle time sesuai target', '-', 'Lanjut trial cycle 3-5 & siapkan approval running', new Date().toISOString()],
    [newId_('l'), '', '2026-PSP-020', daysAgo(1), 'Nugroho Edy S', 12, 'Setup PLC in-stocker 12167', 'Wiring & PLC selesai 100%', '-', 'Lanjut approval monitoring masspro', new Date().toISOString()],
    [newId_('l'), '', '2026-PSP-013', daysAgo(3), 'Wardiyono', 17, 'Evaluasi hasil running Hizumitori 75077', 'Hasil evaluasi baik, siap serah terima', '-', 'Jadwalkan serah terima ke produksi minggu depan', new Date().toISOString()]
  ];
  const projects = rowsToObjects_(getSheet_(SHEET_NAMES.PROJECTS));
  rows.forEach(function (r) {
    const p = projects.filter(function (pr) { return pr.No === r[2]; })[0];
    r[1] = p ? p.ID : '';
  });
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}
function setupSupportSheet_() {
  const sh = getSheet_(SHEET_NAMES.SUPPORT);
  const headers = ['ID', 'Date', 'Type', 'Line', 'PIC', 'ManDay', 'Desc', 'CreatedAt'];
  ensureHeader_(sh, headers);
  if (sh.getLastRow() > 1) return;
  function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd'); }
  const rows = [
    [newId_('s'), daysAgo(1), 'Komarigoto', 'Cam Grinding Line-7', 'Wardiyono', 1.5, 'Perbaikan komarigoto AP2-Pi Intake, adjust program grinding.', new Date().toISOString()],
    [newId_('s'), daysAgo(2), 'PICA', 'Finishing Line-1', 'Fajar Sani', 1, 'PICA problem kualitas AP2-Pi Intake, analisa akar masalah bersama QA.', new Date().toISOString()],
    [newId_('s'), daysAgo(3), 'Trouble Mesin', 'Machining Line-8 (MC 39054)', 'Nugroho Edy S', 2, 'Trouble centering bearing conveyor, koordinasi dengan Maintenance (MME).', new Date().toISOString()],
    [newId_('s'), daysAgo(4), 'Support Produksi', 'Grinding 52065', 'Muharir', 1, 'Follow up spare part & estimasi jadwal perbaikan mesin journal grinding.', new Date().toISOString()]
  ];
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}
function setupGlobalSheet_() {
  const sh = getSheet_(SHEET_NAMES.GLOBAL);
  const headers = ['ID', 'Country', 'Flag', 'PIC', 'Status', 'Item', 'CreatedAt'];
  ensureHeader_(sh, headers);
  if (sh.getLastRow() > 1) return;
  const rows = [
    [newId_('g'), 'Musashi Vietnam', '🇻🇳', 'Wardiyono, Sukiyo', 'OPEN', 'PO 2 Mesin Gear Checker', new Date().toISOString()],
    [newId_('g'), 'Musashi Vietnam', '🇻🇳', 'Fajar Sani, Sukiyo', 'OPEN', 'Automasi Camshaft Machining', new Date().toISOString()],
    [newId_('g'), 'Musashi India', '🇮🇳', 'Fahri Wahyu Prastama', 'OPEN', 'RFQ Mesin Auto Assembly Camshaft', new Date().toISOString()],
    [newId_('g'), 'Musashi India', '🇮🇳', 'Satria Naufal Jauhari', 'ON PROGRESS', 'RFQ Mesin AI Visual Inspection', new Date().toISOString()],
    [newId_('g'), 'Musashi India', '🇮🇳', 'Teguh Rianto', 'OPEN', 'RFQ Mesin Bibiri Cek', new Date().toISOString()],
    [newId_('g'), 'Musashi Brasil', '🇧🇷', 'Muharir, Sukiyo', 'OPEN', 'RFQ Mesin Bibiri Cek', new Date().toISOString()],
    [newId_('g'), 'Musashi Brasil', '🇧🇷', 'Fajar Sani, Sukiyo', 'ON PROGRESS', 'RFQ Improvement Machine', new Date().toISOString()],
    [newId_('g'), 'Musashi Brasil', '🇧🇷', 'Sumarko, Eko Nurcahyanto', 'OPEN', 'Support Design & Trial', new Date().toISOString()],
    [newId_('g'), 'Musashi Mexico', '🇲🇽', 'Muharir, Sukiyo', 'OPEN', 'RFQ Automasi Chamber Press', new Date().toISOString()],
    [newId_('g'), 'Musashi Jepang', '🇯🇵', 'Prihatin Purwadi', 'ON PROGRESS', 'RFQ Automasi IN & OUT Normalising', new Date().toISOString()],
    [newId_('g'), 'Musashi Jepang', '🇯🇵', 'Sumarko, Eko Nurcahyanto', 'OPEN', 'Support Design & Layout', new Date().toISOString()],
    [newId_('g'), 'Musashi Jepang', '🇯🇵', 'Prihatin Purwadi', 'CLOSE', 'Technical Clarification', new Date().toISOString()]
  ];
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/* ============================================================
 *  PUBLIC (tanpa token) — hanya nama & role, tidak sensitif
 * ============================================================ */
function publicTeamNames_() {
  return rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).map(function (t) {
    return { nrp: String(t.NRP), name: t.Name, role: t.Role };
  });
}

/* ============================================================
 *  LOGIN
 * ============================================================ */
function handleLogin_(body) {
  const name = sanitizeStr_(body.name || '');
  const pin = String(body.pin || '');
  if (!name || !pin) return { ok: false, message: 'Nama dan PIN wajib diisi.' };

  if (isLoginLocked_(name)) {
    return { ok: false, message: 'Terlalu banyak percobaan gagal. Coba lagi dalam beberapa menit.' };
  }

  const team = rowsToObjects_(getSheet_(SHEET_NAMES.TEAM));
  const user = team.filter(function (t) { return t.Name === name; })[0];
  if (!user) { recordLoginFail_(name); return { ok: false, message: 'Nama atau PIN salah.' }; }

  const config = rowsToObjects_(getSheet_(SHEET_NAMES.CONFIG));
  const pinCfg = config.filter(function (c) { return c.Key === 'LOGIN_PIN'; })[0];
  const validPin = pinCfg ? String(pinCfg.Value) : 'psp2026';

  if (pin !== validPin) { recordLoginFail_(name); return { ok: false, message: 'Nama atau PIN salah.' }; }

  clearLoginFail_(name);
  const userObj = { nrp: String(user.NRP), name: user.Name, role: user.Role, skill: user.Skill };
  return { ok: true, token: makeToken_(userObj), user: userObj };
}

/* ============================================================
 *  BOOTSTRAP (butuh token)
 * ============================================================ */
function getBootstrapData_() {
  const team = rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).map(function (t) {
    return { nrp: String(t.NRP), name: t.Name, role: t.Role, skill: t.Skill };
  });
  const stages = rowsToObjects_(getSheet_(SHEET_NAMES.STAGES)).sort(function (a, b) { return a.Idx - b.Idx; })
    .map(function (s) { return { n: s.Name, phase: s.PhaseIdx }; });
  const phases = rowsToObjects_(getSheet_(SHEET_NAMES.PHASES)).sort(function (a, b) { return a.Idx - b.Idx; })
    .map(function (p) { return { name: p.Name, hex: p.Hex }; });
  const projects = rowsToObjects_(getSheet_(SHEET_NAMES.PROJECTS)).map(projectRowToObj_);
  const dailyLogs = rowsToObjects_(getSheet_(SHEET_NAMES.DAILY)).map(function (l) {
    return { id: l.ID, projectId: l.ProjectID, projectNo: l.ProjectNo, date: fmtDateCell_(l.Date), engineer: l.Engineer, stage: l.Stage, plan: l.Plan, actual: l.Actual, problem: l.Problem, next: l.Next };
  }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
  const supportJobs = rowsToObjects_(getSheet_(SHEET_NAMES.SUPPORT)).map(function (j) {
    return { id: j.ID, date: fmtDateCell_(j.Date), type: j.Type, line: j.Line, pic: j.PIC, manDay: j.ManDay, desc: j.Desc };
  }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
  const globalSupport = rowsToObjects_(getSheet_(SHEET_NAMES.GLOBAL)).map(function (g) {
    return { id: g.ID, country: g.Country, flag: g.Flag, pic: g.PIC, status: g.Status, item: g.Item };
  });
  const config = rowsToObjects_(getSheet_(SHEET_NAMES.CONFIG));
  const capCfg = config.filter(function (c) { return c.Key === 'SUPPORT_CAPACITY_MANDAY_PER_WEEK'; })[0];
  const supportCapacity = capCfg ? Number(capCfg.Value) : 60;

  return { team: team, stages: stages, phases: phases, projects: projects, dailyLogs: dailyLogs, supportJobs: supportJobs, globalSupport: globalSupport, supportCapacity: supportCapacity };
}
function projectRowToObj_(p) {
  let stageDates = {}, stageNotes = {};
  try { stageDates = JSON.parse(p.StageDatesJSON || '{}'); } catch (e) { stageDates = {}; }
  try { stageNotes = JSON.parse(p.StageNotesJSON || '{}'); } catch (e) { stageNotes = {}; }
  return {
    id: p.ID, no: p.No, name: p.Name, line: p.Line, pic: p.PIC, support: p.Support,
    category: p.Category, start: fmtDateCell_(p.Start), target: fmtDateCell_(p.Target),
    progressStage: Number(p.ProgressStage) || 0, stageDates: stageDates, stageNotes: stageNotes,
    note: p.Note, createdAt: p.CreatedAt
  };
}
function getProjectHeaders_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; }
function updateProjectStageFields_(sh, rowIdx, headers, patch) {
  headers.forEach(function (h, i) { if (Object.prototype.hasOwnProperty.call(patch, h)) sh.getRange(rowIdx, i + 1).setValue(patch[h]); });
}

/* ============================================================
 *  PROJECTS
 * ============================================================ */
function handleAddProject_(body, auth) {
  if (!body.name || !body.line || !body.start || !body.target) {
    return { ok: false, message: 'Nama project, line, tanggal start, dan target wajib diisi.' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_(SHEET_NAMES.PROJECTS);
    const id = newId_('p');
    const clean = sanitizeObjStrings_(body, ['no', 'name', 'line', 'pic', 'support', 'category', 'note']);
    const row = [id, clean.no || 'NO-BUDGET', clean.name, clean.line, clean.pic || '', clean.support || '',
      clean.category || 'Reduce MP', body.start, body.target, 0, '{}', '{}', clean.note || '', new Date().toISOString()];
    sh.appendRow(row);
    const project = projectRowToObj_({
      ID: id, No: row[1], Name: row[2], Line: row[3], PIC: row[4], Support: row[5],
      Category: row[6], Start: row[7], Target: row[8], ProgressStage: row[9],
      StageDatesJSON: row[10], StageNotesJSON: row[11], Note: row[12], CreatedAt: row[13]
    });
    return { ok: true, project: project };
  } finally {
    lock.releaseLock();
  }
}

function handleMarkStage_(body, auth) {
  const idx = Number(body.idx);
  if (!body.projectId || isNaN(idx) || idx < 0 || idx > 17) return { ok: false, message: 'Data tidak valid.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_(SHEET_NAMES.PROJECTS);
    const headers = getProjectHeaders_(sh);
    const rowIdx = findRowIndexById_(sh, 'ID', body.projectId);
    if (rowIdx === -1) return { ok: false, message: 'Project tidak ditemukan.' };
    const rowVals = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
    const obj = {}; headers.forEach(function (h, i) { obj[h] = rowVals[i]; });
    let stageDates = {};
    try { stageDates = JSON.parse(obj.StageDatesJSON || '{}'); } catch (e) { stageDates = {}; }
    const today = todayStr_();
    stageDates[idx] = { start: (stageDates[idx] && stageDates[idx].start) || today, end: today };
    updateProjectStageFields_(sh, rowIdx, headers, { StageDatesJSON: JSON.stringify(stageDates), ProgressStage: idx + 1 });
    return { ok: true, project: projectRowToObj_(Object.assign({}, obj, { StageDatesJSON: JSON.stringify(stageDates), ProgressStage: idx + 1 })) };
  } finally {
    lock.releaseLock();
  }
}

function handleUndoStage_(body, auth) {
  const idx = Number(body.idx);
  if (!body.projectId || isNaN(idx) || idx < 0 || idx > 18) return { ok: false, message: 'Data tidak valid.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = getSheet_(SHEET_NAMES.PROJECTS);
    const headers = getProjectHeaders_(sh);
    const rowIdx = findRowIndexById_(sh, 'ID', body.projectId);
    if (rowIdx === -1) return { ok: false, message: 'Project tidak ditemukan.' };
    const rowVals = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
    const obj = {}; headers.forEach(function (h, i) { obj[h] = rowVals[i]; });
    updateProjectStageFields_(sh, rowIdx, headers, { ProgressStage: idx });
    return { ok: true, project: projectRowToObj_(Object.assign({}, obj, { ProgressStage: idx })) };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 *  DAILY UPDATE
 * ============================================================ */
function handleSaveDailyLog_(body, auth) {
  if (!body.projectId || !body.plan || !body.actual) return { ok: false, message: 'Project, Plan, dan Actual wajib diisi.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const projSheet = getSheet_(SHEET_NAMES.PROJECTS);
    const headers = getProjectHeaders_(projSheet);
    const rowIdx = findRowIndexById_(projSheet, 'ID', body.projectId);
    if (rowIdx === -1) return { ok: false, message: 'Project tidak ditemukan.' };
    const rowVals = projSheet.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
    const pObj = {}; headers.forEach(function (h, i) { pObj[h] = rowVals[i]; });

    const clean = sanitizeObjStrings_(body, ['engineer', 'plan', 'actual', 'problem', 'next']);
    const dailySh = getSheet_(SHEET_NAMES.DAILY);
    const id = newId_('l');
    const stage = Number(body.stage) || 0;
    dailySh.appendRow([id, body.projectId, pObj.No, body.date || todayStr_(), clean.engineer || auth.n, stage,
      clean.plan, clean.actual, clean.problem || '-', clean.next || '-', new Date().toISOString()]);

    let updatedProject = projectRowToObj_(pObj);
    const currentStage = Number(pObj.ProgressStage) || 0;
    if (stage + 1 > currentStage) {
      updateProjectStageFields_(projSheet, rowIdx, headers, { ProgressStage: Math.min(18, stage + 1) });
      updatedProject = projectRowToObj_(Object.assign({}, pObj, { ProgressStage: Math.min(18, stage + 1) }));
    }
    const log = { id: id, projectId: body.projectId, projectNo: pObj.No, date: body.date || todayStr_(), engineer: clean.engineer || auth.n, stage: stage, plan: clean.plan, actual: clean.actual, problem: clean.problem || '-', next: clean.next || '-' };
    return { ok: true, log: log, project: updatedProject };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 *  SUPPORT JOBS (Komarigoto & PICA)
 * ============================================================ */
function handleSaveSupportJob_(body, auth) {
  if (!body.line || !body.manDay || !body.desc) return { ok: false, message: 'Line/Area, Man-Day, dan Deskripsi wajib diisi.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const clean = sanitizeObjStrings_(body, ['type', 'line', 'pic', 'desc']);
    const sh = getSheet_(SHEET_NAMES.SUPPORT);
    const id = newId_('s');
    const manDay = Number(body.manDay) || 0;
    sh.appendRow([id, body.date || todayStr_(), clean.type, clean.line, clean.pic, manDay, clean.desc, new Date().toISOString()]);
    return { ok: true, job: { id: id, date: body.date || todayStr_(), type: clean.type, line: clean.line, pic: clean.pic, manDay: manDay, desc: clean.desc } };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 *  GLOBAL SUPPORT (Musashi Group)
 * ============================================================ */
function handleSaveGlobalItem_(body, auth) {
  if (!body.country || !body.item) return { ok: false, message: 'Negara/Plant dan Item Support wajib diisi.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const clean = sanitizeObjStrings_(body, ['country', 'flag', 'pic', 'status', 'item']);
    const sh = getSheet_(SHEET_NAMES.GLOBAL);
    const id = newId_('g');
    sh.appendRow([id, clean.country, clean.flag || '🌏', clean.pic || '', clean.status || 'OPEN', clean.item, new Date().toISOString()]);
    return { ok: true, item: { id: id, country: clean.country, flag: clean.flag || '🌏', pic: clean.pic || '', status: clean.status || 'OPEN', item: clean.item } };
  } finally {
    lock.releaseLock();
  }
}
