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

/** Phase 4 additions to the same real Config sheet — same skip-if-present rule. */
function ensurePhase4Config_() {
  var sh = getSheet_(SHEET_NAMES.CONFIG);
  var existingKeys = {};
  rowsToObjects_(sh).forEach(function (r) { existingKeys[r.Key] = true; });
  var defaults = [
    ['HIGH_LOAD_THRESHOLD_PCT', '85'], // Part G: NORMAL vs HIGH LOAD boundary (OVERLOAD is always >100%)
    ['ORG_STATUS_LIST', 'ACTIVE,PLANNED,CLOSED']
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
  // Phase 5.2 hardening: reject negative Man-Day at write time instead of only
  // flagging it after the fact via getDataQualityReport (same pattern already
  // used for idealHeadcount in Organization.gs).
  if (body.planManDay !== undefined && Number(body.planManDay) < 0) {
    return { ok: false, message: 'Plan Man-Day tidak boleh negatif.' };
  }
  if (body.actualManDay !== undefined && Number(body.actualManDay) < 0) {
    return { ok: false, message: 'Actual Man-Day tidak boleh negatif.' };
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
  if (body.planManDay !== undefined && Number(body.planManDay) < 0) {
    return { ok: false, message: 'Plan Man-Day tidak boleh negatif.' };
  }
  if (body.actualManDay !== undefined && Number(body.actualManDay) < 0) {
    return { ok: false, message: 'Actual Man-Day tidak boleh negatif.' };
  }
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
  if (body.planManDay !== undefined && Number(body.planManDay) < 0) {
    return { ok: false, message: 'Plan Man-Day tidak boleh negatif.' };
  }
  if (body.actualManDay !== undefined && Number(body.actualManDay) < 0) {
    return { ok: false, message: 'Actual Man-Day tidak boleh negatif.' };
  }
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
 * ============================================================ */
function parseDate_(s) { var d = s ? new Date(s) : null; return (d && !isNaN(d.getTime())) ? d : null; }
function isoWeekStart_(d) {
  var day = d.getDay() || 7; // Sunday=0 -> 7
  var monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}
function monthKey_(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function periodKeyForDate_(d, periodType) { return periodType === 'week' ? isoWeekStart_(d) : monthKey_(d); }
function currentPeriodKey_(periodType) {
  var now = new Date();
  return periodType === 'week' ? isoWeekStart_(now) : monthKey_(now);
}
function isWorkingDay_(d, perWeek) {
  var wd = d.getDay(); // 0=Sun..6=Sat
  var mondayIndexed = wd === 0 ? 7 : wd;
  return mondayIndexed <= perWeek;
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
    if (isWorkingDay_(new Date(year, month, d), perWeek)) count++;
  }
  return count;
}
function countWorkingDaysInRange_(start, end, perWeek) {
  var count = 0;
  var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  var last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (d <= last) {
    if (isWorkingDay_(d, perWeek)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/* ============================================================
 *  PART A — MULTI-WEEK MAN-DAY DISTRIBUTION (even distribution
 *  across working days, per MULTIWEEK_DISTRIBUTION_DESIGN.md).
 *
 *  distributeManDay_ returns {periodKey: attributedMD, ...} covering
 *  every week/month a [startDateStr, targetDateStr] range touches.
 *  Rules (each with an explicit, tested fallback):
 *   - missing/invalid START_DATE  -> cannot place anywhere -> {} (empty)
 *   - missing/invalid TARGET_DATE -> treated as a single-day activity
 *     (target = start)
 *   - TARGET_DATE before START_DATE -> same single-day fallback
 *   - zero working days in the range (e.g. a single-day activity that
 *     falls on a configured non-working day) -> the full amount is
 *     attributed to START_DATE's period anyway, so Man-Day is never
 *     silently lost
 *   - planManDay <= 0 -> returns {} (never a negative contribution)
 *  Deterministic: a pure function of its three inputs plus the
 *  WORKING_DAYS_PER_WEEK config value, no randomness, no side effects.
 * ============================================================ */
function distributeManDay_(startDateStr, targetDateStr, planManDay, periodType) {
  var perWeek = getConfigNum_('WORKING_DAYS_PER_WEEK', 5);
  var md = Math.max(0, Number(planManDay) || 0);
  var result = {};
  if (md === 0) return result;

  var start = parseDate_(startDateStr);
  if (!start) return result; // no usable start date -> cannot place anywhere, never invented

  var end = parseDate_(targetDateStr);
  if (!end || end < start) end = start; // missing/invalid target, or target before start -> single-day fallback

  var totalWorkingDays = countWorkingDaysInRange_(start, end, perWeek);
  if (totalWorkingDays === 0) {
    // whole range is non-working days (e.g. a single-day activity on a
    // weekend) -> attribute the full amount to start date's period so
    // it is never silently dropped
    result[periodKeyForDate_(start, periodType)] = md;
    return result;
  }

  var dailyRate = md / totalWorkingDays;
  var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  var last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (d <= last) {
    if (isWorkingDay_(d, perWeek)) {
      var key = periodKeyForDate_(d, periodType);
      result[key] = (result[key] || 0) + dailyRate;
    }
    d.setDate(d.getDate() + 1);
  }
  return result;
}
function attributedManDayForPeriod_(startDateStr, targetDateStr, planManDay, periodType, periodKey) {
  var dist = distributeManDay_(startDateStr, targetDateStr, planManDay, periodType);
  return dist[periodKey] || 0;
}

/* ============================================================
 *  WORKLOAD SOURCES
 *  Two sources feed workload, kept distinguishable by "source":
 *   - PROJECT (External/Internal): WBS + RESOURCE_ALLOCATION, joined
 *     to PROJECT_MASTER for the External/Internal split. Each row now
 *     carries a date RANGE (not a single date) so distributeManDay_
 *     can spread it; Actual MD uses ACTUAL_START/ACTUAL_END if set,
 *     falling back to the planned dates otherwise.
 *   - IRREGULAR: the existing legacy SupportJobs sheet (already has
 *     PIC + ManDay per row) — read-only, exactly as Phase 1.5 found
 *     it. A SupportJobs row has one Date, so its "range" is that same
 *     single day for both start and end (distributeManDay_ handles a
 *     single-day range correctly, including the weekend edge case).
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
    out.push({
      planStart: wbs.START_DATE, planEnd: wbs.TARGET_DATE,
      actualStart: wbs.ACTUAL_START || wbs.START_DATE, actualEnd: wbs.ACTUAL_END || wbs.TARGET_DATE,
      engineer: a.ENGINEER_NAME,
      planManDay: Number(a.PLAN_MAN_DAY) || 0,
      actualManDay: Number(a.ACTUAL_MAN_DAY) || 0,
      projectType: project ? project.Type : 'UNKNOWN',
      projectId: wbs.PROJECT_ID,
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
      planStart: j.Date, planEnd: j.Date, actualStart: j.Date, actualEnd: j.Date,
      engineer: j.PIC,
      planManDay: Number(j.ManDay) || 0,
      actualManDay: Number(j.ManDay) || 0, // legacy SupportJobs has one ManDay field only (realized), used for both
      projectType: 'IRREGULAR',
      projectId: '',
      source: 'IRREGULAR',
      wbsId: '',
      skill: ''
    };
  });
}
function allWorkloadRows_() {
  return collectProjectWorkloadRows_().concat(collectIrregularWorkloadRows_());
}
/** Sum of distributed Plan/Actual MD for a set of rows in one period. */
function sumDistributedMd_(rows, periodType, periodKey) {
  var plannedMD = 0, actualMD = 0;
  rows.forEach(function (r) {
    plannedMD += attributedManDayForPeriod_(r.planStart, r.planEnd, r.planManDay, periodType, periodKey);
    actualMD += attributedManDayForPeriod_(r.actualStart, r.actualEnd, r.actualManDay, periodType, periodKey);
  });
  return { plannedMD: plannedMD, actualMD: actualMD };
}

/* ============================================================
 *  H. WEEKLY / MONTHLY WORKLOAD SUMMARY (now using distributed MD)
 * ============================================================ */
function handleGetWorkloadSummary_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);
  var rows = allWorkloadRows_();

  var currentMp = rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).length;
  var workingDays = workingDaysInPeriod_(periodType, periodKey);
  var utilization = getConfigNum_('UTILIZATION_FACTOR', 0.75);
  var availableMD = currentMp * workingDays * utilization;

  var totals = sumDistributedMd_(rows, periodType, periodKey);
  var plannedMD = totals.plannedMD, actualMD = totals.actualMD;
  var remainingMD = availableMD - actualMD;
  var utilizationPct = availableMD > 0 ? Math.round((plannedMD / availableMD) * 100) : 0;
  var overloadMD = Math.max(0, plannedMD - availableMD);
  var underloadMD = Math.max(0, availableMD - plannedMD);

  function byType(type) {
    return sumDistributedMd_(rows.filter(function (r) { return r.projectType === type; }), periodType, periodKey);
  }

  return {
    ok: true, periodType: periodType, periodKey: periodKey,
    totalPlannedMD: round2_(plannedMD), totalActualMD: round2_(actualMD),
    availableMD: round2_(availableMD), remainingMD: round2_(remainingMD),
    utilizationPct: utilizationPct, overloadMD: round2_(overloadMD), underloadMD: round2_(underloadMD),
    byType: {
      EXTERNAL: roundPair_(byType('EXTERNAL')),
      INTERNAL: roundPair_(byType('INTERNAL')),
      IRREGULAR: roundPair_(byType('IRREGULAR'))
    }
  };
}
function round2_(n) { return Math.round(n * 100) / 100; }
function roundPair_(p) { return { plannedMD: round2_(p.plannedMD), actualMD: round2_(p.actualMD) }; }

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
 *  E/F/G/I. ENGINEER LOADING + OVERLOAD DETECTION + SKILL LOADING
 *  (distributed MD; engineer loading now also reports Skill and the
 *  4-state status Part G asks for: AVAILABLE / NORMAL / HIGH LOAD /
 *  OVERLOAD — the threshold between NORMAL and HIGH LOAD is a new
 *  configurable Config key, HIGH_LOAD_THRESHOLD_PCT, default 85.)
 * ============================================================ */
function teamSkillByName_() {
  var map = {};
  rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).forEach(function (t) { map[t.Name] = t.Skill || 'Unassigned'; });
  return map;
}
function engineerLoadStatus_(plannedMD, availableMD) {
  if (plannedMD <= 0) return 'AVAILABLE';
  if (availableMD <= 0) return 'OVERLOAD';
  var pct = (plannedMD / availableMD) * 100;
  var highLoadThreshold = getConfigNum_('HIGH_LOAD_THRESHOLD_PCT', 85);
  if (pct > 100) return 'OVERLOAD';
  if (pct >= highLoadThreshold) return 'HIGH LOAD';
  return 'NORMAL';
}

function handleGetEngineerLoading_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);
  var rows = allWorkloadRows_();
  var workingDays = workingDaysInPeriod_(periodType, periodKey);
  var utilization = getConfigNum_('UTILIZATION_FACTOR', 0.75);
  var personalAvailableMD = workingDays * utilization; // per-person net capacity for the period
  var skillByName = teamSkillByName_();

  var byEngineer = {};
  rows.forEach(function (r) {
    if (!r.engineer) return;
    var planned = attributedManDayForPeriod_(r.planStart, r.planEnd, r.planManDay, periodType, periodKey);
    var actual = attributedManDayForPeriod_(r.actualStart, r.actualEnd, r.actualManDay, periodType, periodKey);
    if (!byEngineer[r.engineer]) byEngineer[r.engineer] = { engineer: r.engineer, skill: skillByName[r.engineer] || 'Unassigned', plannedMD: 0, actualMD: 0 };
    byEngineer[r.engineer].plannedMD += planned;
    byEngineer[r.engineer].actualMD += actual;
  });

  var list = Object.keys(byEngineer).map(function (name) {
    var e = byEngineer[name];
    var overload = Math.max(0, e.plannedMD - personalAvailableMD);
    return {
      engineer: e.engineer, skill: e.skill,
      plannedMD: round2_(e.plannedMD), actualMD: round2_(e.actualMD),
      availableMD: round2_(personalAvailableMD),
      overloadMD: round2_(overload),
      status: engineerLoadStatus_(e.plannedMD, personalAvailableMD)
    };
  });

  return { ok: true, periodType: periodType, periodKey: periodKey, personalAvailableMD: round2_(personalAvailableMD), engineers: list };
}

function handleGetSkillLoading_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);
  var rows = allWorkloadRows_();
  var skillByName = teamSkillByName_();

  var bySkill = {};
  rows.forEach(function (r) {
    var skill = skillByName[r.engineer] || 'Unassigned';
    var planned = attributedManDayForPeriod_(r.planStart, r.planEnd, r.planManDay, periodType, periodKey);
    var actual = attributedManDayForPeriod_(r.actualStart, r.actualEnd, r.actualManDay, periodType, periodKey);
    if (!bySkill[skill]) bySkill[skill] = { skill: skill, plannedMD: 0, actualMD: 0 };
    bySkill[skill].plannedMD += planned;
    bySkill[skill].actualMD += actual;
  });

  return {
    ok: true, periodType: periodType, periodKey: periodKey,
    skills: Object.keys(bySkill).map(function (k) { return Object.assign({ skill: k }, roundPair_(bySkill[k])); })
  };
}

/* ============================================================
 *  J/K. MANPOWER GAP FOUNDATION + MANAGEMENT BASELINE COMPARISON
 * ============================================================ */
/**
 * Part E/J: Current vs Ideal MP, and System Calculation vs Management
 * Baseline. Backward-compatible with the Phase 3 response shape (every
 * flat field Phase 3's frontend/tests already read is unchanged) —
 * Phase 4 adds Ideal MP and exact/rounded-up/tag fields alongside,
 * it does not restructure what's already shipped.
 *
 * Tags: CALCULATED = this engine's own output from live workload/
 * capacity data; REFERENCE = the management-entered baseline, never
 * derived or overwritten by this function.
 */
function handleGetManpowerAnalysis_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);

  var workload = handleGetWorkloadSummary_({ periodType: periodType, periodKey: periodKey });
  var capacity = handleGetCapacitySummary_({ periodType: periodType, periodKey: periodKey });

  var currentMp = capacity.currentMp;
  var requiredMD = workload.totalPlannedMD;
  var availableMD = capacity.netCapacityMD;
  var gapMD = requiredMD - availableMD;
  var perPersonNetMD = capacity.workingDays * capacity.utilizationFactor;
  var indicativeAdditionalMPExact = gapMD > 0 && perPersonNetMD > 0 ? gapMD / perPersonNetMD : 0;
  var idealMPExact = currentMp + indicativeAdditionalMPExact;
  var baselineMP = getConfigNum_('MANAGEMENT_BASELINE_ADDITIONAL_MP', 8);

  return {
    ok: true, periodType: periodType, periodKey: periodKey,
    // --- Phase 3 fields, unchanged shape (existing frontend/tests depend on these) ---
    currentMp: currentMp, requiredMD: requiredMD, availableMD: availableMD, gapMD: gapMD,
    indicativeAdditionalMP: Math.round(indicativeAdditionalMPExact * 10) / 10,
    indicativeAdditionalMPLabel: 'Indicative Additional MP — system calculation, NOT an HR recommendation',
    managementBaselineAdditionalMP: baselineMP,
    managementBaselineLabel: 'Management Baseline — Reference Only',
    differenceVsBaseline: Math.round((indicativeAdditionalMPExact - baselineMP) * 10) / 10,
    // --- Phase 4 additions: Ideal MP (Part E) + exact/rounded-up + CALCULATED/REFERENCE tags (Part J) ---
    idealMP: {
      exact: round2_(idealMPExact), roundedUp: Math.ceil(idealMPExact), tag: 'CALCULATED',
      label: 'Ideal MP (= Calculated Required MP) — Current MP + Indicative Additional MP, not rounded prematurely'
    },
    indicativeAdditionalMPExact: round2_(indicativeAdditionalMPExact),
    indicativeAdditionalMPRoundedUp: Math.ceil(indicativeAdditionalMPExact),
    currentMpTag: 'CALCULATED', managementBaselineTag: 'REFERENCE'
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
  var projectById = {};
  projects.forEach(function (p) { projectById[p.ID] = p; });
  var wbsRows = rowsToObjects_(getSheet_(SHEET_NAMES.WBS));
  var wbsProjectIdsSeen = {};
  var statusList = getConfigList_('WBS_STATUS_LIST', ['NOT STARTED']);
  var allocRows = rowsToObjects_(getSheet_(SHEET_NAMES.RESOURCE_ALLOCATION));
  var wbsIdsWithAlloc = {};
  allocRows.forEach(function (a) { wbsIdsWithAlloc[a.WBS_ID] = true; });

  wbsRows.forEach(function (w) {
    wbsProjectIdsSeen[w.PROJECT_ID] = true;
    if (!w.PIC) add('MISSING_PIC', 'WARNING', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has no PIC.');
    if (!w.SKILL) add('MISSING_SKILL', 'INFO', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has no required skill set.');
    if (!w.START_DATE) add('MISSING_START_DATE', 'WARNING', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has no start date — cannot be bucketed into any weekly/monthly workload period.');
    if (!w.TARGET_DATE) add('MISSING_TARGET_DATE', 'INFO', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has no target date.');
    if (Number(w.PLAN_MAN_DAY) < 0) add('NEGATIVE_MAN_DAY', 'ERROR', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has a negative Plan Man-Day.');
    if (w.STATUS && statusList.indexOf(w.STATUS) === -1) add('INVALID_STATUS', 'ERROR', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has status "' + w.STATUS + '", not in Config!WBS_STATUS_LIST.');
    var project = w.PROJECT_ID ? projectById[w.PROJECT_ID] : null;
    if (w.PROJECT_ID && !project) add('WBS_WITHOUT_PROJECT', 'ERROR', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" references PROJECT_ID "' + w.PROJECT_ID + '", which does not exist in PROJECT_MASTER.');
    if (!wbsIdsWithAlloc[w.WBS_ID]) add('WBS_WITHOUT_RESOURCE', 'INFO', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has no resource allocation yet.');
    var wStart = parseDate_(w.START_DATE), wEnd = parseDate_(w.TARGET_DATE);
    if (wStart && wEnd && wEnd < wStart) add('INVALID_DATE_RANGE', 'ERROR', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" has Target Date before Start Date.');
    if (project && wStart) {
      var pStart = parseDate_(project.IntakeDate), pTarget = parseDate_(project.TargetDate);
      if ((pStart && wStart < pStart) || (pTarget && wEnd && wEnd > pTarget)) {
        add('ACTIVITY_OUTSIDE_PROJECT_PERIOD', 'WARNING', 'WBS', w.WBS_ID, 'WBS "' + w.NAME + '" falls outside its project\'s Intake–Target date range.');
      }
    }
  });

  projects.forEach(function (p) {
    if (!p.PIC) add('MISSING_PIC', 'WARNING', 'PROJECT_MASTER', p.ID, 'Project "' + p.Name + '" has no PIC.');
    if (!wbsProjectIdsSeen[p.ID]) add('PROJECT_WITHOUT_WBS', 'INFO', 'PROJECT_MASTER', p.ID, 'Project "' + p.Name + '" has no WBS rows yet.');
  });

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

  var orgRows = rowsToObjects_(getSheet_(SHEET_NAMES.ORG_STRUCTURE));
  var orgIds = {};
  orgRows.forEach(function (o) { orgIds[o.ORG_ID] = true; });
  orgRows.forEach(function (o) {
    if (o.PARENT_ORG_ID && !orgIds[o.PARENT_ORG_ID]) {
      add('ORPHAN_ORG_NODE', 'ERROR', 'ORG_STRUCTURE', o.ORG_ID, 'Org node "' + o.ORG_NAME + '" references PARENT_ORG_ID "' + o.PARENT_ORG_ID + '", which does not exist.');
    }
    if (o.PERSON_NAME && !teamNames[o.PERSON_NAME]) {
      add('ORPHAN_ORG_NODE', 'ERROR', 'ORG_STRUCTURE', o.ORG_ID, 'Org node "' + o.ORG_NAME + '" is assigned to "' + o.PERSON_NAME + '", not found in Team.');
    }
    if (Number(o.IDEAL_HEADCOUNT) < 0) {
      add('INVALID_VACANCY', 'ERROR', 'ORG_STRUCTURE', o.ORG_ID, 'Org node "' + o.ORG_NAME + '" has a negative Ideal Headcount.');
    }
  });

  var bySeverity = { ERROR: 0, WARNING: 0, INFO: 0 };
  issues.forEach(function (i) { bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1; });

  return { ok: true, totalIssues: issues.length, bySeverity: bySeverity, issues: issues };
}

/* ============================================================
 *  PHASE 4 — PART B: WORKLOAD CALENDAR (weekly/monthly, filterable
 *  by All PSP / Engineer / Skill / Project / External / Internal /
 *  Irregular). Reuses the same distributed-MD engine as
 *  getWorkloadSummary_ — this is that same computation with a scope
 *  filter applied before summing, not a parallel calculation.
 * ============================================================ */
function filterWorkloadRows_(rows, scope, value) {
  if (!scope || scope === 'ALL') return rows;
  if (scope === 'EXTERNAL') return rows.filter(function (r) { return r.projectType === 'EXTERNAL'; });
  if (scope === 'INTERNAL') return rows.filter(function (r) { return r.projectType === 'INTERNAL'; });
  if (scope === 'IRREGULAR') return rows.filter(function (r) { return r.projectType === 'IRREGULAR'; });
  if (scope === 'ENGINEER') return rows.filter(function (r) { return r.engineer === value; });
  if (scope === 'PROJECT') return rows.filter(function (r) { return r.projectId === value; });
  if (scope === 'SKILL') {
    var skillByName = teamSkillByName_();
    return rows.filter(function (r) { return (skillByName[r.engineer] || 'Unassigned') === value; });
  }
  return rows;
}
/** Available capacity for a given scope — team-wide net capacity for
 *  ALL/type/project scopes (none of those are person-specific), a
 *  single person's net capacity for ENGINEER, and the net capacity of
 *  everyone with that skill for SKILL. */
function availableMdForScope_(scope, value, periodType, periodKey) {
  var workingDays = workingDaysInPeriod_(periodType, periodKey);
  var utilization = getConfigNum_('UTILIZATION_FACTOR', 0.75);
  var perPersonNetMD = workingDays * utilization;
  if (scope === 'ENGINEER') return perPersonNetMD;
  if (scope === 'SKILL') {
    var count = rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).filter(function (t) { return (t.Skill || 'Unassigned') === value; }).length;
    return count * perPersonNetMD;
  }
  var currentMp = rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).length;
  return currentMp * perPersonNetMD;
}

function handleGetWorkloadCalendar_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);
  var scope = (body && body.scope) || 'ALL';
  var value = (body && body.value) || '';

  var rows = filterWorkloadRows_(allWorkloadRows_(), scope, value);
  var totals = sumDistributedMd_(rows, periodType, periodKey);
  var availableMD = availableMdForScope_(scope, value, periodType, periodKey);
  var utilizationPct = availableMD > 0 ? Math.round((totals.plannedMD / availableMD) * 100) : 0;
  var overloadMD = Math.max(0, totals.plannedMD - availableMD);

  return {
    ok: true, periodType: periodType, periodKey: periodKey, scope: scope, value: value,
    plannedMD: round2_(totals.plannedMD), actualMD: round2_(totals.actualMD),
    availableMD: round2_(availableMD), utilizationPct: utilizationPct, overloadMD: round2_(overloadMD)
  };
}
function handleGetWeeklyWorkload_(body) { return handleGetWorkloadCalendar_(Object.assign({}, body, { periodType: 'week' })); }
function handleGetMonthlyWorkload_(body) { return handleGetWorkloadCalendar_(Object.assign({}, body, { periodType: 'month' })); }

/* ============================================================
 *  PHASE 4 — PART F: MANPOWER BY SKILL. Skill groups come only from
 *  Team.Skill (no hard-coded skill list) — a skill with zero people
 *  and zero workload simply won't appear, matching "do not invent
 *  fake skills."
 * ============================================================ */
function handleGetManpowerBySkill_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);
  var workingDays = workingDaysInPeriod_(periodType, periodKey);
  var utilization = getConfigNum_('UTILIZATION_FACTOR', 0.75);
  var perPersonNetMD = workingDays * utilization;

  var teamBySkill = {};
  rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).forEach(function (t) {
    var skill = t.Skill || 'Unassigned';
    teamBySkill[skill] = (teamBySkill[skill] || 0) + 1;
  });

  var loading = handleGetSkillLoading_({ periodType: periodType, periodKey: periodKey }).skills;
  var loadingBySkill = {};
  loading.forEach(function (s) { loadingBySkill[s.skill] = s; });

  var allSkills = Object.keys(teamBySkill);
  loading.forEach(function (s) { if (allSkills.indexOf(s.skill) === -1) allSkills.push(s.skill); });

  var result = allSkills.map(function (skill) {
    var currentMp = teamBySkill[skill] || 0;
    var availableMD = currentMp * perPersonNetMD;
    var workloadMD = (loadingBySkill[skill] && loadingBySkill[skill].plannedMD) || 0;
    var overloadMD = Math.max(0, workloadMD - availableMD);
    var indicativeAdditionalMP = overloadMD > 0 && perPersonNetMD > 0 ? overloadMD / perPersonNetMD : 0;
    return {
      skill: skill, currentMp: currentMp, availableMD: round2_(availableMD),
      workloadMD: round2_(workloadMD), overloadMD: round2_(overloadMD),
      indicativeAdditionalMP: round2_(indicativeAdditionalMP)
    };
  });

  return { ok: true, periodType: periodType, periodKey: periodKey, skills: result };
}

/* ============================================================
 *  PHASE 4 — PART I: MANPOWER SCENARIO (CURRENT / +1 / +2 / +4 / +8).
 *  Read-only simulation — never writes to Team or any other sheet.
 * ============================================================ */
function handleGetManpowerScenario_(body) {
  var periodType = (body && body.periodType === 'month') ? 'month' : 'week';
  var periodKey = (body && body.periodKey) || currentPeriodKey_(periodType);

  var workload = handleGetWorkloadSummary_({ periodType: periodType, periodKey: periodKey });
  var currentMp = rowsToObjects_(getSheet_(SHEET_NAMES.TEAM)).length;
  var workingDays = workingDaysInPeriod_(periodType, periodKey);
  var utilization = getConfigNum_('UTILIZATION_FACTOR', 0.75);
  var requiredMD = workload.totalPlannedMD;

  var deltas = [0, 1, 2, 4, 8];
  var scenarios = deltas.map(function (delta) {
    var simulatedMp = currentMp + delta;
    var availableMD = simulatedMp * workingDays * utilization;
    var overloadMD = Math.max(0, requiredMD - availableMD);
    var remainingGapMD = requiredMD - availableMD;
    return {
      label: delta === 0 ? 'CURRENT' : 'CURRENT + ' + delta,
      simulatedMp: simulatedMp, availableMD: round2_(availableMD),
      utilizationPct: availableMD > 0 ? Math.round((requiredMD / availableMD) * 100) : 0,
      overloadMD: round2_(overloadMD), remainingGapMD: round2_(remainingGapMD),
      tag: 'SIMULATION'
    };
  });

  return { ok: true, periodType: periodType, periodKey: periodKey, requiredMD: round2_(requiredMD), scenarios: scenarios };
}
