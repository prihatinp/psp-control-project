/**
 * ============================================================
 *  WBS + MAN-DAY + WORKLOAD + CAPACITY — PHASE 3 ADDITIVE EXTENSION
 *  ------------------------------------------------------------
 *  Lives alongside Code.gs and ProjectMaster.gs in the same Apps
 *  Script project (shared global scope). Reuses the real
 *  verifyToken_/checkRateLimit_/sanitizeObjStrings_/LockService/
 *  getSheet_/ensureHeader_/rowsToObjects_/findRowIndexById_/
 *  newId_/todayStr_/fmtDateCell_ verbatim — nothing here redefines
 *  any of those.
 *
 *  Scope (Phase 3 only): WBS (generic recursive tree — a WBS row's
 *  WBS_LEVEL/TYPE says whether it's a Phase, Activity, or Task; the
 *  table is the same regardless), RESOURCE_ALLOCATION (multi-person
 *  Man-Day per WBS row), and the workload/capacity/manpower-gap
 *  calculation engine. No hiring recommendation, no AI prediction,
 *  no optimization, no auto-assignment, no reports/export, no org
 *  chart — those are later phases.
 *
 *  "Activity" and "WBS" are the same entity in this schema.
 *  createActivity/updateActivity/getActivities (requested action
 *  names) are wired in Code.gs to the same handlers as
 *  createWBS/updateWBS/getWBS — provided to match the requested API
 *  surface, not because they are a separate data model.
 * ============================================================
 */

/* ============================================================
 *  SCHEMA
 * ============================================================ */
var WBS_HEADERS = [
  'WBS_ID', 'PROJECT_ID', 'PARENT_WBS_ID', 'WBS_LEVEL', 'WBS_CODE', 'NAME', 'TYPE', 'STATUS',
  'PIC', 'SKILL', 'DEPENDENCY', 'PRIORITY',
  'START_DATE', 'TARGET_DATE', 'ACTUAL_START', 'ACTUAL_END',
  'PLAN_MAN_DAY', 'ACTUAL_MAN_DAY', 'PROGRESS', 'NOTE',
  'CREATED_BY', 'CREATED_AT', 'UPDATED_AT'
];
// Additions beyond the suggested field list, each justified:
//  DEPENDENCY — required by Phase 3 Section C ("dependency") but missing from
//               Section B's suggested column list. Single predecessor WBS_ID
//               for Phase 3 (multi-dependency chains are a later-phase concern).
//  PRIORITY   — required by Phase 3 Section C ("priority"), also missing from
//               Section B's suggested column list.

var RESOURCE_ALLOCATION_HEADERS = [
  'ALLOC_ID', 'WBS_ID', 'ENGINEER_NAME', 'ROLE', 'PLAN_MAN_DAY', 'ACTUAL_MAN_DAY',
  'CREATED_BY', 'CREATED_AT'
];
// Kept deliberately minimal: SKILL is not stored here — it is looked up live
// from Team.Skill by ENGINEER_NAME at aggregation time, so skill-loading
// reports never go stale if someone's skill label changes later.

function setupWbsSheet_() {
  ensureHeader_(getSheet_(SHEET_NAMES.WBS), WBS_HEADERS);
}
function setupResourceAllocationSheet_() {
  ensureHeader_(getSheet_(SHEET_NAMES.RESOURCE_ALLOCATION), RESOURCE_ALLOCATION_HEADERS);
}

/**
 * New Config keys for Phase 3, appended to the REAL existing Config
 * sheet (same Key/Value shape, no new sheet) — skips any key already
 * present so re-running never overwrites a value someone tuned.
 *
 * ALL of these are explicitly configurable assumptions, not fixed
 * truths — see backend/production/CAPACITY_MODEL.md for the formula
 * that uses them and why each default was chosen.
 */
function ensurePhase3Config_() {
  var sh = getSheet_(SHEET_NAMES.CONFIG);
  var existingKeys = {};
  rowsToObjects_(sh).forEach(function (r) { existingKeys[r.Key] = true; });
  var defaults = [
    ['WBS_STATUS_LIST', 'NOT STARTED,PLANNED,ON PROGRESS,BLOCKED,DONE,CANCELLED'],
    ['WORKING_DAYS_PER_WEEK', '5'],
    ['WORKING_HOURS_PER_DAY', '8'],
    ['AVAILABLE_HOURS_PER_PERSON', '8'],
    ['UTILIZATION_FACTOR', '0.75'],
    ['MEETING_ALLOWANCE', '0.05'],
    ['ADMIN_ALLOWANCE', '0.05'],
    ['LEAVE_ALLOWANCE', '0.05'],
    ['MANAGEMENT_BASELINE_ADDITIONAL_MP', '8'] // Management Baseline — Reference Only. See getManpowerAnalysis_.
  ];
  defaults.forEach(function (row) {
    if (!existingKeys[row[0]]) sh.appendRow(row);
  });
}

function getConfigNum_(key, fallback) {
  var row = rowsToObjects_(getSheet_(SHEET_NAMES.CONFIG)).filter(function (r) { return r.Key === key; })[0];
  var n = row ? Number(row.Value) : NaN;
  return isNaN(n) ? fallback : n;
}

/* ============================================================
 *  ROW <-> OBJECT MAPPING
 * ============================================================ */
function wbsRowToObj_(w) {
  return {
    id: w.WBS_ID, projectId: w.PROJECT_ID, parentId: w.PARENT_WBS_ID || '', level: Number(w.WBS_LEVEL) || 1,
    code: w.WBS_CODE || '', name: w.NAME, type: w.TYPE || '', status: w.STATUS,
    pic: w.PIC || '', skill: w.SKILL || '', dependency: w.DEPENDENCY || '', priority: w.PRIORITY || '',
    startDate: fmtDateCell_(w.START_DATE), targetDate: fmtDateCell_(w.TARGET_DATE),
    actualStart: fmtDateCell_(w.ACTUAL_START), actualEnd: fmtDateCell_(w.ACTUAL_END),
    planManDay: Number(w.PLAN_MAN_DAY) || 0, actualManDay: Number(w.ACTUAL_MAN_DAY) || 0,
    progress: Number(w.PROGRESS) || 0, note: w.NOTE || '',
    createdBy: w.CREATED_BY, createdAt: w.CREATED_AT, updatedAt: w.UPDATED_AT
  };
}
function allocRowToObj_(a) {
  return {
    id: a.ALLOC_ID, wbsId: a.WBS_ID, engineer: a.ENGINEER_NAME, role: a.ROLE || 'SUPPORT',
    planManDay: Number(a.PLAN_MAN_DAY) || 0, actualManDay: Number(a.ACTUAL_MAN_DAY) || 0,
    createdBy: a.CREATED_BY, createdAt: a.CREATED_AT
  };
}

/* ============================================================
 *  WBS CRUD
 * ============================================================ */
function validateWbsStatus_(status) {
  var allowed = getConfigList_('WBS_STATUS_LIST', ['NOT STARTED']);
  return allowed.indexOf(status) !== -1;
}

function handleCreateWbs_(body, auth) {
  if (!body.projectId || !body.name) {
    return { ok: false, message: 'projectId dan name wajib diisi.' };
  }
  var status = body.status || 'NOT STARTED';
  if (!validateWbsStatus_(status)) {
    return { ok: false, message: 'Status tidak dikenal. Lihat Config!WBS_STATUS_LIST.' };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensurePhase3Config_();
    setupWbsSheet_();
    var sh = getSheet_(SHEET_NAMES.WBS);
    var id = newId_('wbs');
    var clean = sanitizeObjStrings_(body, ['code', 'name', 'type', 'pic', 'skill', 'dependency', 'priority', 'note']);
    var level = body.parentId ? (Number(body.level) || 2) : (Number(body.level) || 1);
    var nowIso = new Date().toISOString();
    var row = [
      id, body.projectId, body.parentId || '', level, clean.code || '', clean.name, clean.type || '', status,
      clean.pic || '', clean.skill || '', clean.dependency || '', clean.priority || '',
      body.startDate || '', body.targetDate || '', body.actualStart || '', body.actualEnd || '',
      Number(body.planManDay) || 0, Number(body.actualManDay) || 0, Number(body.progress) || 0, clean.note || '',
      auth.n, nowIso, nowIso
    ];
    sh.appendRow(row);
    var obj = {};
    WBS_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
    return { ok: true, wbs: wbsRowToObj_(obj) };
  } finally {
    lock.releaseLock();
  }
}

function handleUpdateWbs_(body, auth) {
  if (!body.id) return { ok: false, message: 'ID WBS wajib diisi.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_(SHEET_NAMES.WBS);
    var rowIdx = findRowIndexById_(sh, 'WBS_ID', body.id);
    if (rowIdx === -1) return { ok: false, message: 'WBS tidak ditemukan.' };
    var rowVals = sh.getRange(rowIdx, 1, 1, WBS_HEADERS.length).getValues()[0];
    var obj = {};
    WBS_HEADERS.forEach(function (h, i) { obj[h] = rowVals[i]; });

    if (body.status !== undefined && !validateWbsStatus_(body.status)) {
      return { ok: false, message: 'Status tidak dikenal. Lihat Config!WBS_STATUS_LIST.' };
    }
    var clean = sanitizeObjStrings_(body, ['code', 'name', 'type', 'pic', 'skill', 'dependency', 'priority', 'note']);
    var fieldMap = {
      code: 'WBS_CODE', name: 'NAME', type: 'TYPE', status: 'STATUS', pic: 'PIC', skill: 'SKILL',
      dependency: 'DEPENDENCY', priority: 'PRIORITY', startDate: 'START_DATE', targetDate: 'TARGET_DATE',
      actualStart: 'ACTUAL_START', actualEnd: 'ACTUAL_END', planManDay: 'PLAN_MAN_DAY',
      actualManDay: 'ACTUAL_MAN_DAY', progress: 'PROGRESS', note: 'NOTE'
    };
    var patch = {};
    Object.keys(fieldMap).forEach(function (f) {
      if (body[f] === undefined) return;
      var v = clean[f] !== undefined ? clean[f] : body[f];
      patch[fieldMap[f]] = v;
    });
    patch.UPDATED_AT = new Date().toISOString();
    WBS_HEADERS.forEach(function (h, i) {
      if (Object.prototype.hasOwnProperty.call(patch, h)) sh.getRange(rowIdx, i + 1).setValue(patch[h]);
    });
    return { ok: true, wbs: wbsRowToObj_(Object.assign({}, obj, patch)) };
  } finally {
    lock.releaseLock();
  }
}

/** Non-destructive: marks CANCELLED rather than removing the row, matching this
 *  system's append-only convention elsewhere (legacy code never deletes rows). */
function handleDeleteWbs_(body, auth) {
  return handleUpdateWbs_({ id: body.id, status: 'CANCELLED' }, auth);
}

function handleGetWbs_(body) {
  if (!body.id) return { ok: false, message: 'ID WBS wajib diisi.' };
  var row = rowsToObjects_(getSheet_(SHEET_NAMES.WBS)).filter(function (r) { return r.WBS_ID === body.id; })[0];
  if (!row) return { ok: false, message: 'WBS tidak ditemukan.' };
  return { ok: true, wbs: wbsRowToObj_(row) };
}

function handleListWbsForProject_(body) {
  if (!body.projectId) return { ok: false, message: 'projectId wajib diisi.' };
  var rows = rowsToObjects_(getSheet_(SHEET_NAMES.WBS)).filter(function (r) { return r.PROJECT_ID === body.projectId; });
  return { ok: true, wbs: rows.map(wbsRowToObj_) };
}

/* ============================================================
 *  RESOURCE ALLOCATION (multi-engineer per WBS row)
 * ============================================================ */
function handleSaveResourceAllocation_(body, auth) {
  if (!body.wbsId || !body.engineer) return { ok: false, message: 'wbsId dan engineer wajib diisi.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    setupResourceAllocationSheet_();
    var wbsRow = rowsToObjects_(getSheet_(SHEET_NAMES.WBS)).filter(function (r) { return r.WBS_ID === body.wbsId; })[0];
    if (!wbsRow) return { ok: false, message: 'WBS tidak ditemukan.' };
    var sh = getSheet_(SHEET_NAMES.RESOURCE_ALLOCATION);
    var id = newId_('alc');
    var clean = sanitizeObjStrings_(body, ['engineer', 'role']);
    var row = [
      id, body.wbsId, clean.engineer, clean.role || 'SUPPORT',
      Number(body.planManDay) || 0, Number(body.actualManDay) || 0,
      auth.n, new Date().toISOString()
    ];
    sh.appendRow(row);
    var obj = {};
    RESOURCE_ALLOCATION_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
    return { ok: true, allocation: allocRowToObj_(obj) };
  } finally {
    lock.releaseLock();
  }
}

function handleGetResourceAllocation_(body) {
  if (!body.wbsId) return { ok: false, message: 'wbsId wajib diisi.' };
  var rows = rowsToObjects_(getSheet_(SHEET_NAMES.RESOURCE_ALLOCATION)).filter(function (r) { return r.WBS_ID === body.wbsId; });
  return { ok: true, allocations: rows.map(allocRowToObj_), totalPlanManDay: rows.reduce(function (s, r) { return s + (Number(r.PLAN_MAN_DAY) || 0); }, 0) };
}

/* ============================================================
 *  DATE / PERIOD HELPERS
 *  Simplification (documented, not hidden): a Man-Day allocation is
 *  attributed to the week/month containing its WBS row's START_DATE
 *  (ACTUAL_START if present) — not spread day-by-day across a
 *  multi-week activity. Precise spreading is a later-phase concern;
 *  Phase 3 is a data foundation, not a scheduling engine.
 * ============================================================ */
function parseDate_(s) { return s ? new Date(s) : null; }
function isoWeekStart_(d) {
  var day = d.getDay() || 7; // Sunday=0 -> 7
  var monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}
function monthKey_(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

function inPeriod_(dateObj, periodType, periodKey) {
  if (!dateObj) return false;
  if (periodType === 'week') return isoWeekStart_(dateObj) === periodKey;
  return monthKey_(dateObj) === periodKey;
}
function currentPeriodKey_(periodType) {
  var now = new Date();
  return periodType === 'week' ? isoWeekStart_(now) : monthKey_(now);
}
/** Working days available in the given period under the configured week length. */
function workingDaysInPeriod_(periodType, periodKey) {
  var perWeek = getConfigNum_('WORKING_DAYS_PER_WEEK', 5);
  if (periodType === 'week') return perWeek;
  var parts = periodKey.split('-');
  var year = Number(parts[0]), month = Number(parts[1]) - 1;
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var count = 0;
  for (var d = 1; d <= daysInMonth; d++) {
    var wd = new Date(year, month, d).getDay(); // 0=Sun..6=Sat
    var mondayIndexed = wd === 0 ? 7 : wd;
    if (mondayIndexed <= perWeek) count++;
  }
  return count;
}

/* ============================================================
 *  WORKLOAD SOURCES
 *  Two sources feed workload, kept distinguishable by "source":
 *   - PROJECT (External/Internal): WBS + RESOURCE_ALLOCATION, joined
 *     to PROJECT_MASTER for the External/Internal split.
 *   - IRREGULAR: the existing legacy SupportJobs sheet (already has
 *     PIC + ManDay per row) — read-only, exactly as Phase 1.5 found
 *     it. No parallel WBS-for-Irregular-Job structure is invented;
 *     Irregular Job workload already has a working, real home.
 * ============================================================ */
function collectProjectWorkloadRows_() {
  var wbsRows = rowsToObjects_(getSheet_(SHEET_NAMES.WBS));
  var allocRows = rowsToObjects_(getSheet_(SHEET_NAMES.RESOURCE_ALLOCATION));
  var projectById = {};
  rowsToObjects_(getSheet_(SHEET_NAMES.PROJECT_MASTER)).forEach(function (p) { projectById[p.ID] = p; });
  var wbsById = {};
  wbsRows.forEach(function (w) { wbsById[w.WBS_ID] = w; });

  var out = [];
  allocRows.forEach(function (a) {
    var wbs = wbsById[a.WBS_ID];
    if (!wbs) return;
    var project = projectById[wbs.PROJECT_ID];
    var dateStr = wbs.ACTUAL_START || wbs.START_DATE;
    out.push({
      date: parseDate_(dateStr),
      engineer: a.ENGINEER_NAME,
      planManDay: Number(a.PLAN_MAN_DAY) || 0,
      actualManDay: Number(a.ACTUAL_MAN_DAY) || 0,
      projectType: project ? project.Type : 'UNKNOWN',
      source: 'PROJECT',
      wbsId: wbs.WBS_ID,
      skill: wbs.SKILL || ''
    });
  });
  return out;
}
function collectIrregularWorkloadRows_() {
  return rowsToObjects_(getSheet_(SHEET_NAMES.SUPPORT)).map(function (j) {
    return {
      date: parseDate_(j.Date),
      engineer: j.PIC,
      planManDay: Number(j.ManDay) || 0,
      actualManDay: Number(j.ManDay) || 0, // legacy SupportJobs has one ManDay field only (realized), used for both
      projectType: 'IRREGULAR',
      source: 'IRREGULAR',
      wbsId: '',
      skill: ''
    };
  });
}
function allWorkloadRows_() {
  return collectProjectWorkloadRows_().concat(collectIrregularWorkloadRows_());
}

/* ============================================================
 *  H. WEEKLY / MONTHLY WORKLOAD SUMMARY
 * ============================================================ */
function handleGetWorkloadSummary_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);
  var rows = allWorkloadRows_().filter(function (r) { return inPeriod_(r.date, periodType, periodKey); });

  var currentMp = rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).length;
  var workingDays = workingDaysInPeriod_(periodType, periodKey);
  var utilization = getConfigNum_('UTILIZATION_FACTOR', 0.75);
  var availableMD = currentMp * workingDays * utilization;

  var plannedMD = rows.reduce(function (s, r) { return s + r.planManDay; }, 0);
  var actualMD = rows.reduce(function (s, r) { return s + r.actualManDay; }, 0);
  var remainingMD = availableMD - actualMD;
  var utilizationPct = availableMD > 0 ? Math.round((plannedMD / availableMD) * 100) : 0;
  var overloadMD = Math.max(0, plannedMD - availableMD);
  var underloadMD = Math.max(0, availableMD - plannedMD);

  function byType(type) {
    var subset = rows.filter(function (r) { return r.projectType === type; });
    return { plannedMD: subset.reduce(function (s, r) { return s + r.planManDay; }, 0), actualMD: subset.reduce(function (s, r) { return s + r.actualManDay; }, 0) };
  }

  return {
    ok: true, periodType: periodType, periodKey: periodKey,
    totalPlannedMD: plannedMD, totalActualMD: actualMD,
    availableMD: availableMD, remainingMD: remainingMD,
    utilizationPct: utilizationPct, overloadMD: overloadMD, underloadMD: underloadMD,
    byType: { EXTERNAL: byType('EXTERNAL'), INTERNAL: byType('INTERNAL'), IRREGULAR: byType('IRREGULAR') }
  };
}

/* ============================================================
 *  D. CAPACITY SUMMARY (gross vs net)
 * ============================================================ */
function handleGetCapacitySummary_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);
  var currentMp = rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).length;
  var workingDays = workingDaysInPeriod_(periodType, periodKey);
  var utilization = getConfigNum_('UTILIZATION_FACTOR', 0.75);

  var grossCapacityMD = currentMp * workingDays;
  var netCapacityMD = grossCapacityMD * utilization;

  return {
    ok: true, periodType: periodType, periodKey: periodKey, currentMp: currentMp, workingDays: workingDays,
    grossCapacityMD: grossCapacityMD, netCapacityMD: netCapacityMD, utilizationFactor: utilization,
    allowances: {
      meeting: getConfigNum_('MEETING_ALLOWANCE', 0.05),
      admin: getConfigNum_('ADMIN_ALLOWANCE', 0.05),
      leave: getConfigNum_('LEAVE_ALLOWANCE', 0.05)
    },
    note: 'UTILIZATION_FACTOR is the single dial used in Net Capacity. The three allowance keys are shown for breakdown/transparency only and are not separately multiplied in — see backend/production/CAPACITY_MODEL.md.'
  };
}

/* ============================================================
 *  E/F/I. ENGINEER LOADING + OVERLOAD DETECTION + SKILL LOADING
 * ============================================================ */
function handleGetEngineerLoading_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);
  var rows = allWorkloadRows_().filter(function (r) { return inPeriod_(r.date, periodType, periodKey); });
  var workingDays = workingDaysInPeriod_(periodType, periodKey);
  var utilization = getConfigNum_('UTILIZATION_FACTOR', 0.75);
  var personalAvailableMD = workingDays * utilization; // per-person net capacity for the period

  var byEngineer = {};
  rows.forEach(function (r) {
    if (!r.engineer) return;
    if (!byEngineer[r.engineer]) byEngineer[r.engineer] = { engineer: r.engineer, plannedMD: 0, actualMD: 0 };
    byEngineer[r.engineer].plannedMD += r.planManDay;
    byEngineer[r.engineer].actualMD += r.actualManDay;
  });

  var list = Object.keys(byEngineer).map(function (name) {
    var e = byEngineer[name];
    var overload = Math.max(0, e.plannedMD - personalAvailableMD);
    return Object.assign({}, e, {
      availableMD: personalAvailableMD,
      overloadMD: overload,
      status: overload > 0 ? 'OVERLOAD' : 'OK'
    });
  });

  return { ok: true, periodType: periodType, periodKey: periodKey, personalAvailableMD: personalAvailableMD, engineers: list };
}

function handleGetSkillLoading_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);
  var rows = allWorkloadRows_().filter(function (r) { return inPeriod_(r.date, periodType, periodKey); });

  var skillByName = {};
  rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).forEach(function (t) { skillByName[t.Name] = t.Skill || 'Unassigned'; });

  var bySkill = {};
  rows.forEach(function (r) {
    var skill = skillByName[r.engineer] || 'Unassigned';
    if (!bySkill[skill]) bySkill[skill] = { skill: skill, plannedMD: 0, actualMD: 0 };
    bySkill[skill].plannedMD += r.planManDay;
    bySkill[skill].actualMD += r.actualManDay;
  });

  return { ok: true, periodType: periodType, periodKey: periodKey, skills: Object.keys(bySkill).map(function (k) { return bySkill[k]; }) };
}

/* ============================================================
 *  J/K. MANPOWER GAP FOUNDATION + MANAGEMENT BASELINE COMPARISON
 * ============================================================ */
function handleGetManpowerAnalysis_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);

  var workload = handleGetWorkloadSummary_({ periodType: periodType, periodKey: periodKey });
  var capacity = handleGetCapacitySummary_({ periodType: periodType, periodKey: periodKey });

  var requiredMD = workload.totalPlannedMD;
  var availableMD = capacity.netCapacityMD;
  var gapMD = requiredMD - availableMD;
  var perPersonNetMD = capacity.workingDays * capacity.utilizationFactor;
  var indicativeAdditionalMP = gapMD > 0 && perPersonNetMD > 0 ? gapMD / perPersonNetMD : 0;

  var baselineMP = getConfigNum_('MANAGEMENT_BASELINE_ADDITIONAL_MP', 8);

  return {
    ok: true, periodType: periodType, periodKey: periodKey,
    currentMp: capacity.currentMp, requiredMD: requiredMD, availableMD: availableMD, gapMD: gapMD,
    indicativeAdditionalMP: Math.round(indicativeAdditionalMP * 10) / 10,
    indicativeAdditionalMPLabel: 'Indicative Additional MP — system calculation, NOT an HR recommendation',
    managementBaselineAdditionalMP: baselineMP,
    managementBaselineLabel: 'Management Baseline — Reference Only',
    differenceVsBaseline: Math.round((indicativeAdditionalMP - baselineMP) * 10) / 10
  };
}

/* ============================================================
 *  PHASE 3.1 — DATA QUALITY REPORT (read-only, identifies problems,
 *  fixes nothing). Every check below traces to one of the 12 items
 *  requested; "invalid engineer name" and "engineer not existing in
 *  Team" are the same underlying check (an ENGINEER_NAME with no
 *  matching Team.Name row), reported under one issue type.
 * ============================================================ */
function handleGetDataQualityReport_() {
  var issues = [];
  function add(type, severity, entity, id, message) {
    issues.push({ type: type, severity: severity, entity: entity, id: id, message: message });
  }

  var teamNames = {};
  rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).forEach(function (t) { teamNames[t.Name] = true; });
  var projects = rowsToObjects_(getSheet_(SHEET_NAMES.PROJECT_MASTER));
  var projectIds = {};
  projects.forEach(function (p) { projectIds[p.ID] = true; });
  var wbsRows = rowsToObjects_(getSheet_(SHEET_NAMES.WBS));
  var wbsProjectIdsSeen = {};
  var statusList = getConfigList_('WBS_STATUS_LIST', ['NOT STARTED']);

  wbsRows.forEach(function (w) {
    wbsProjectIdsSeen[w.PROJECT_ID] = true;
    if (!w.PIC) add('MISSING_PIC', 'WARNING', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has no PIC.');
    if (!w.SKILL) add('MISSING_SKILL', 'INFO', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has no required skill set.');
    if (!w.START_DATE) add('MISSING_START_DATE', 'WARNING', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has no start date — cannot be bucketed into any weekly/monthly workload period.');
    if (!w.TARGET_DATE) add('MISSING_TARGET_DATE', 'INFO', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has no target date.');
    if (Number(w.PLAN_MAN_DAY) < 0) add('NEGATIVE_MAN_DAY', 'ERROR', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has a negative Plan Man-Day.');
    if (w.STATUS && statusList.indexOf(w.STATUS) === -1) add('INVALID_STATUS', 'ERROR', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has status "' + w.STATUS + '", not in Config!WBS_STATUS_LIST.');
    if (w.PROJECT_ID && !projectIds[w.PROJECT_ID]) add('WBS_WITHOUT_PROJECT', 'ERROR', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" references PROJECT_ID "' + w.PROJECT_ID + '", which does not exist in PROJECT_MASTER.');
  });

  projects.forEach(function (p) {
    if (!p.PIC) add('MISSING_PIC', 'WARNING', 'PROJECT_MASTER', p.ID, 'Project "' + p.Name + '" has no PIC.');
    if (!wbsProjectIdsSeen[p.ID]) add('PROJECT_WITHOUT_WBS', 'INFO', 'PROJECT_MASTER', p.ID, 'Project "' + p.Name + '" has no WBS rows yet.');
  });

  var allocRows = rowsToObjects_(getSheet_(SHEET_NAMES.RESOURCE_ALLOCATION));
  var seenAllocKeys = {};
  allocRows.forEach(function (a) {
    if (!a.ENGINEER_NAME || !teamNames[a.ENGINEER_NAME]) {
      add('ENGINEER_NOT_IN_TEAM', 'ERROR', 'RESOURCE_ALLOCATION', a.ALLOC_ID, 'Allocation references engineer "' + (a.ENGINEER_NAME || '(blank)') + '", not found in Team.');
    }
    var md = Number(a.PLAN_MAN_DAY);
    if (md === 0) add('ZERO_MAN_DAY', 'WARNING', 'RESOURCE_ALLOCATION', a.ALLOC_ID, 'Allocation for "' + a.ENGINEER_NAME + '" has 0 Plan Man-Day.');
    if (md < 0) add('NEGATIVE_MAN_DAY', 'ERROR', 'RESOURCE_ALLOCATION', a.ALLOC_ID, 'Allocation for "' + a.ENGINEER_NAME + '" has negative Plan Man-Day.');
    var key = a.WBS_ID + '::' + a.ENGINEER_NAME + '::' + (a.ROLE || '');
    if (seenAllocKeys[key]) add('DUPLICATE_ALLOCATION', 'WARNING', 'RESOURCE_ALLOCATION', a.ALLOC_ID, 'Duplicate allocation: "' + a.ENGINEER_NAME + '" already allocated to this WBS row with the same role.');
    seenAllocKeys[key] = true;
  });

  var bySeverity = { ERROR: 0, WARNING: 0, INFO: 0 };
  issues.forEach(function (i) { bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1; });

  return { ok: true, totalIssues: issues.length, bySeverity: bySeverity, issues: issues };
}
