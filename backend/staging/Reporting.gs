/**
 * ============================================================
 *  REPORTING / RISK / EXECUTIVE DASHBOARD — PHASE 5 ADDITIVE EXTENSION
 *  ------------------------------------------------------------
 *  No new sheet (Part J: prefer computed, read-only aggregation —
 *  see PHASE5_REPORTING_MODEL.md for why one wasn't needed). Every
 *  handler in this file is READ-ONLY: none call LockService, none
 *  append or modify any row anywhere. Reuses the real
 *  verifyToken_/checkRateLimit_ (via the shared doPost gate — no
 *  extra code needed here for that) and every prior phase's handler
 *  functions rather than recomputing the same numbers twice.
 *
 *  Deterministic only. No AI, no prediction, no scoring beyond the
 *  explicit threshold rules documented in PROJECT_HEALTH_MODEL.md.
 * ============================================================ */

/** New Phase 5 Config keys, same skip-if-present rule as every prior phase. */
function ensurePhase5Config_() {
  var sh = getSheet_(SHEET_NAMES.CONFIG);
  var existingKeys = {};
  rowsToObjects_(sh).forEach(function (r) { existingKeys[r.Key] = true; });
  var defaults = [
    ['REPORTING_STALE_DAYS', '7'],
    ['PROJECT_AT_RISK_DAYS', '14'],
    ['PROJECT_CRITICAL_DAYS', '3'],
    ['OVERLOAD_THRESHOLD_PCT', '100'] // formalizes the >100% boundary engineerLoadStatus_ (Phase 4) already used implicitly
  ];
  defaults.forEach(function (row) {
    if (!existingKeys[row[0]]) sh.appendRow(row);
  });
  // MANAGEMENT_BASELINE_ADDITIONAL_MP is NOT touched here — it already exists
  // (Phase 3) and must never be silently changed, per explicit instruction.
}

/* ============================================================
 *  REPORTING PERIOD (Part F)
 * ============================================================ */
function dateOnly_(d) { return d.toISOString().slice(0, 10); }

/** 'YYYY-Www' -> the Monday of that ISO week, per ISO 8601 (week 1 contains Jan 4). */
function isoWeekToMonday_(isoWeekStr) {
  var m = /^(\d{4})-W(\d{2})$/.exec(String(isoWeekStr || ''));
  if (!m) return null;
  var year = Number(m[1]), week = Number(m[2]);
  var jan4 = new Date(year, 0, 4);
  var wd = jan4.getDay() || 7;
  var jan4Monday = new Date(jan4);
  jan4Monday.setDate(jan4.getDate() - wd + 1);
  var target = new Date(jan4Monday);
  target.setDate(jan4Monday.getDate() + (week - 1) * 7);
  return dateOnly_(target);
}

/** Accepts {week:'YYYY-Www'} OR {startDate,endDate} OR neither (defaults to the current week). */
function parseReportingPeriod_(body) {
  body = body || {};
  var start, end, label;
  if (body.week) {
    var monday = isoWeekToMonday_(body.week);
    if (monday) {
      start = parseDate_(monday);
      end = new Date(start); end.setDate(end.getDate() + 6);
      label = body.week;
    }
  }
  if (!start && body.startDate) {
    var s = parseDate_(body.startDate);
    if (s) { start = s; end = parseDate_(body.endDate) || s; label = dateOnly_(start) + ' to ' + dateOnly_(end); }
  }
  if (!start) {
    var nowMonday = parseDate_(isoWeekStart_(new Date()));
    start = nowMonday; end = new Date(start); end.setDate(end.getDate() + 6);
    label = dateOnly_(start) + ' (default: current week)';
  }
  start.setHours(0, 0, 0, 0); end.setHours(23, 59, 59, 999);
  return { startDate: start, endDate: end, label: label };
}

/* ============================================================
 *  SHARED CONTEXT — one read of each sheet, reused by every
 *  reporting/risk function below so numbers can never disagree
 *  between the dashboard, the reports, and the attention list.
 * ============================================================ */
function buildProjectRiskContext_() {
  var rawProjects = rowsToObjects_(getSheet_(SHEET_NAMES.PROJECT_MASTER));
  var projects = rawProjects.map(function (p) {
    return {
      id: p.ID, no: p.No, name: p.Name, type: p.Type, pic: p.PIC, status: p.Status,
      customer: p.Customer, plant: p.Plant, country: p.Country || '', // Phase 5.1: Country is its own field, never derived from customer/plant
      targetDate: fmtDateCell_(p.TargetDate), intakeDate: fmtDateCell_(p.IntakeDate),
      updatedAt: p.UpdatedAt, legacyProjectId: p.LegacyProjectId || ''
    };
  });
  var wbsAll = rowsToObjects_(getSheet_(SHEET_NAMES.WBS)).map(wbsRowToObj_);
  var allocAll = rowsToObjects_(getSheet_(SHEET_NAMES.RESOURCE_ALLOCATION)).map(allocRowToObj_);

  var dailyLogsRaw = rowsToObjects_(getSheet_(SHEET_NAMES.DAILY));
  var dailyByLegacyId = {};
  dailyLogsRaw.forEach(function (l) {
    var entry = { date: fmtDateCell_(l.Date), engineer: l.Engineer, plan: l.Plan, actual: l.Actual, problem: l.Problem, next: l.Next };
    (dailyByLegacyId[l.ProjectID] = dailyByLegacyId[l.ProjectID] || []).push(entry);
  });

  var engineerLoadingFull = handleGetEngineerLoading_({ periodType: 'week' });
  var engineerStatusByName = {};
  engineerLoadingFull.engineers.forEach(function (e) { engineerStatusByName[e.engineer] = e.status; });

  return {
    projects: projects, wbsAll: wbsAll, allocAll: allocAll,
    dailyByLegacyId: dailyByLegacyId, engineerStatusByName: engineerStatusByName, engineerLoadingFull: engineerLoadingFull
  };
}

/* ============================================================
 *  PART D/E — PROJECT RISK ENGINE + PROJECT HEALTH
 *  Every rule and threshold is documented, in the same order, in
 *  PROJECT_HEALTH_MODEL.md — keep that file in sync with this
 *  function if either changes.
 * ============================================================ */
function computeLastUpdateDate_(project, wbsRows, dailyLogsForProject) {
  var dates = [];
  var pd = parseDate_(project.updatedAt); if (pd) dates.push(pd);
  wbsRows.forEach(function (w) { var d = parseDate_(w.updatedAt); if (d) dates.push(d); });
  dailyLogsForProject.forEach(function (l) { var d = parseDate_(l.date); if (d) dates.push(d); });
  if (!dates.length) return null;
  return new Date(Math.max.apply(null, dates.map(function (d) { return d.getTime(); })));
}

/**
 * Phase 5.1 — one short "which data drove this flag" label per reason key,
 * shown as `source` on each risk/attention record (Part 4's audit asked
 * for a Source field alongside Project/Risk Level/Reason/Target
 * Date/Current Status). Purely descriptive — never used in the cascade
 * logic itself.
 */
var RISK_SOURCE_MAP_ = {
  overdue: 'PROJECT_MASTER.TargetDate',
  critical_deadline: 'PROJECT_MASTER.TargetDate',
  noRecentUpdate: 'PROJECT_MASTER.UpdatedAt + WBS.UPDATED_AT + legacy DailyLogs (via LegacyProjectId)',
  noWbs: 'WBS',
  wbsWithoutAllocation: 'WBS + RESOURCE_ALLOCATION',
  missingManDay: 'RESOURCE_ALLOCATION.PLAN_MAN_DAY',
  overloadedEngineer: 'RESOURCE_ALLOCATION + Engineer Loading (Phase 4)',
  highLoadEngineer: 'RESOURCE_ALLOCATION + Engineer Loading (Phase 4)',
  progressBehind: 'WBS.PROGRESS vs PROJECT_MASTER.IntakeDate/TargetDate',
  poApproaching: 'PROJECT_MASTER.Status + TargetDate',
  externalPoStale: 'PROJECT_MASTER.Status + UpdatedAt',
  onHold: 'PROJECT_MASTER.Status',
  missingCriticalData: 'PROJECT_MASTER.PIC/TargetDate'
};
/**
 * Phase 5.1 — which reason key actually explains the assigned riskLevel,
 * in the same priority order as the cascade's own boolean expressions
 * below. Audit finding: before this fix, getProjectsNeedAttention_ picked
 * reasonKeys[0] (the first flag evaluated in source order) as "the"
 * reason/action — for a project that was e.g. both noRecentUpdate (a
 * WATCH-tier flag, evaluated first) and overloadedEngineer (the actual
 * AT-RISK-tier flag that determined its riskLevel), the recommended
 * action shown could contradict the assigned risk level. These three
 * lists mirror the cascade's own conditions exactly, so the chosen
 * primaryReasonKey always belongs to the tier that actually won.
 */
var RISK_LEVEL_REASON_PRIORITY_ = {
  CRITICAL: ['overdue', 'critical_deadline', 'overloadedEngineer', 'poApproaching'],
  'AT RISK': ['poApproaching', 'progressBehind', 'overloadedEngineer', 'externalPoStale'],
  WATCH: ['noRecentUpdate', 'highLoadEngineer', 'wbsWithoutAllocation', 'missingManDay', 'onHold', 'missingCriticalData', 'noWbs']
};

function computeProjectRisk_(project, wbsAll, allocAll, dailyByLegacyId, engineerStatusByName, today) {
  var staleDays = getConfigNum_('REPORTING_STALE_DAYS', 7);
  var atRiskDays = getConfigNum_('PROJECT_AT_RISK_DAYS', 14);
  var criticalDays = getConfigNum_('PROJECT_CRITICAL_DAYS', 3);

  var isClosed = project.status === 'COMPLETED' || project.status === 'CANCELLED';
  var targetDate = parseDate_(project.targetDate);
  var daysUntilTarget = targetDate ? Math.round((targetDate - today) / 86400000) : null;
  var overdue = !isClosed && targetDate && daysUntilTarget < 0;
  var nearTarget = !isClosed && daysUntilTarget !== null && daysUntilTarget >= 0 && daysUntilTarget <= atRiskDays;
  var criticalDeadline = !isClosed && daysUntilTarget !== null && daysUntilTarget >= 0 && daysUntilTarget <= criticalDays;

  var relatedWbs = wbsAll.filter(function (w) { return w.projectId === project.id; });
  var relatedLogs = project.legacyProjectId ? (dailyByLegacyId[project.legacyProjectId] || []) : [];
  var lastUpdate = computeLastUpdateDate_(project, relatedWbs, relatedLogs);
  var noRecentUpdate = !isClosed && (!lastUpdate || Math.round((today - lastUpdate) / 86400000) > staleDays);

  var hasWbs = relatedWbs.length > 0;
  var wbsIdsForProject = relatedWbs.map(function (w) { return w.id; });
  var allocatedWbsIds = {};
  allocAll.forEach(function (a) { allocatedWbsIds[a.wbsId] = true; });
  // Phase 5.1 fix: these three are about whether *active* execution was ever
  // properly planned/resourced — like progressBehind/poApproaching, they
  // stop being relevant once a project is closed (COMPLETED/CANCELLED).
  // Before this fix, an old completed project with no Phase 3/4 WBS ever
  // created for it (true for most legacy-migrated projects, since WBS is a
  // newer feature) would show WATCH forever, and never leave the "Projects
  // Need Attention" list — a real bug, not an active risk.
  var noWbs = !isClosed && !hasWbs;
  var wbsWithoutAllocation = !isClosed && hasWbs && relatedWbs.every(function (w) { return !allocatedWbsIds[w.id]; });

  // Phase 5.1: distinct from wbsWithoutAllocation — this WBS row DOES have
  // one or more allocation rows, but they sum to zero Plan Man-Day (e.g.
  // an engineer assigned with no effort actually planned yet).
  var missingManDay = !isClosed && relatedWbs.some(function (w) {
    var allocsForThisWbs = allocAll.filter(function (a) { return a.wbsId === w.id; });
    if (!allocsForThisWbs.length) return false; // that case is wbsWithoutAllocation's job
    var sum = allocsForThisWbs.reduce(function (s, a) { return s + (Number(a.planManDay) || 0); }, 0);
    return sum === 0;
  });

  var projectEngineers = allocAll.filter(function (a) { return wbsIdsForProject.indexOf(a.wbsId) !== -1; }).map(function (a) { return a.engineer; });
  if (project.pic) projectEngineers.push(project.pic);
  var overloadedEngineer = projectEngineers.some(function (e) { return engineerStatusByName[e] === 'OVERLOAD'; });
  var highLoadEngineer = projectEngineers.some(function (e) { return engineerStatusByName[e] === 'HIGH LOAD'; });

  var avgProgress = hasWbs ? (relatedWbs.reduce(function (s, w) { return s + (Number(w.progress) || 0); }, 0) / relatedWbs.length) : null;
  var intake = parseDate_(project.intakeDate);
  var expectedProgress = null;
  if (intake && targetDate && targetDate > intake) {
    var totalDays = (targetDate - intake) / 86400000;
    var elapsed = Math.min(totalDays, Math.max(0, (today - intake) / 86400000));
    expectedProgress = (elapsed / totalDays) * 100;
  }
  var progressBehind = !isClosed && avgProgress !== null && expectedProgress !== null && (expectedProgress - avgProgress) > 20;

  var poApproaching = !isClosed && (project.status === 'PO' || project.status === 'EXECUTION') && nearTarget;
  var externalPoStale = project.type === 'EXTERNAL' && (project.status === 'PO' || project.status === 'EXECUTION') && noRecentUpdate;
  var onHold = project.status === 'ON HOLD';
  var missingCriticalData = !project.pic || !project.targetDate;

  var reasonKeys = [], reasonText = [], reasonTextByKey = {};
  function flag(key, text) { reasonKeys.push(key); reasonText.push(text); reasonTextByKey[key] = text; }
  if (overdue) flag('overdue', 'Target date terlewati, status belum COMPLETED');
  if (criticalDeadline) flag('critical_deadline', 'Target date dalam ' + daysUntilTarget + ' hari');
  if (noRecentUpdate) flag('noRecentUpdate', 'Tidak ada update dalam lebih dari ' + staleDays + ' hari');
  if (noWbs) flag('noWbs', 'Belum ada WBS untuk project ini');
  if (wbsWithoutAllocation) flag('wbsWithoutAllocation', 'WBS ada tapi belum ada alokasi resource');
  if (missingManDay) flag('missingManDay', 'Ada alokasi resource dengan Plan Man-Day = 0');
  if (overloadedEngineer) flag('overloadedEngineer', 'Engineer pada project ini berstatus OVERLOAD');
  if (highLoadEngineer) flag('highLoadEngineer', 'Engineer pada project ini berstatus HIGH LOAD');
  if (progressBehind) flag('progressBehind', 'Progress tertinggal dari jadwal (' + Math.round(avgProgress) + '% vs ekspektasi ' + Math.round(expectedProgress) + '%)');
  if (poApproaching) flag('poApproaching', 'Project PO/Execution mendekati target date (' + daysUntilTarget + ' hari lagi)');
  if (externalPoStale) flag('externalPoStale', 'External PO/Execution project tanpa update terbaru untuk customer report');
  if (onHold) flag('onHold', 'Project berstatus ON HOLD');
  if (missingCriticalData) flag('missingCriticalData', 'Data penting hilang (PIC atau Target Date)');

  // Deterministic cascade, checked in this exact order — see PROJECT_HEALTH_MODEL.md.
  var level = 'NORMAL';
  if (overdue || criticalDeadline || (overloadedEngineer && poApproaching)) level = 'CRITICAL';
  else if (poApproaching || progressBehind || overloadedEngineer || externalPoStale) level = 'AT RISK';
  else if (noRecentUpdate || highLoadEngineer || wbsWithoutAllocation || missingManDay || onHold || missingCriticalData || noWbs) level = 'WATCH';

  var health = onHold ? 'GRAY' : (level === 'CRITICAL' ? 'RED' : level === 'AT RISK' ? 'ORANGE' : level === 'WATCH' ? 'YELLOW' : 'GREEN');

  // Phase 5.1: pick the ONE reason that actually explains `level`, using the
  // same priority order as the cascade above (not just "first flag evaluated").
  var priorityForLevel = RISK_LEVEL_REASON_PRIORITY_[level] || [];
  var primaryReasonKey = null;
  for (var i = 0; i < priorityForLevel.length; i++) {
    if (reasonKeys.indexOf(priorityForLevel[i]) !== -1) { primaryReasonKey = priorityForLevel[i]; break; }
  }
  if (!primaryReasonKey && reasonKeys.length) primaryReasonKey = reasonKeys[0];

  return {
    projectId: project.id, projectNo: project.no, projectName: project.name, type: project.type, pic: project.pic,
    status: project.status, targetDate: project.targetDate,
    lastUpdate: lastUpdate ? dateOnly_(lastUpdate) : null,
    daysUntilTarget: daysUntilTarget, avgProgress: avgProgress === null ? null : Math.round(avgProgress),
    riskLevel: level, riskReasons: reasonText, reasonKeys: reasonKeys, health: health,
    // Phase 5.1 additions — additive only, every field above is unchanged.
    primaryReasonKey: primaryReasonKey,
    primaryReason: primaryReasonKey ? reasonTextByKey[primaryReasonKey] : null,
    primarySource: primaryReasonKey ? RISK_SOURCE_MAP_[primaryReasonKey] : null,
    sources: reasonKeys.map(function (k) { return RISK_SOURCE_MAP_[k]; }),
    flags: {
      overdue: !!overdue, nearTarget: !!nearTarget, noRecentUpdate: !!noRecentUpdate,
      externalPoStale: !!externalPoStale, missingManDay: !!missingManDay
    }
  };
}

function handleGetProjectRisks_(body) {
  var ctx = buildProjectRiskContext_();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var risks = ctx.projects.map(function (p) {
    return computeProjectRisk_(p, ctx.wbsAll, ctx.allocAll, ctx.dailyByLegacyId, ctx.engineerStatusByName, today);
  });
  if (body && body.type) risks = risks.filter(function (r) { return r.type === body.type; });
  return { ok: true, risks: risks };
}

/* ============================================================
 *  PART L — PROJECTS NEED ATTENTION
 *  Deterministic priority list, not an AI recommendation — each
 *  action comes from a fixed reason->action lookup, documented here
 *  and in PHASE5_REPORTING_MODEL.md.
 * ============================================================ */
var ATTENTION_ACTION_MAP_ = {
  overdue: 'Follow up target date & update status project',
  critical_deadline: 'Prioritaskan penyelesaian, koordinasi harian dengan PIC',
  noRecentUpdate: 'Minta update terbaru dari PIC',
  noWbs: 'Buat breakdown WBS untuk project ini',
  wbsWithoutAllocation: 'Tentukan alokasi resource untuk WBS yang ada',
  overloadedEngineer: 'Evaluasi ulang beban kerja engineer, pertimbangkan bantuan tambahan',
  highLoadEngineer: 'Pantau beban kerja engineer, waspadai potensi overload',
  progressBehind: 'Review kembali rencana kerja dan percepatan progress',
  poApproaching: 'Konfirmasi jadwal dengan customer, pastikan kesiapan',
  externalPoStale: 'Siapkan & kirim update progress ke customer',
  onHold: 'Review alasan ON HOLD, tentukan tindak lanjut',
  missingCriticalData: 'Lengkapi data PIC / Target Date project',
  missingManDay: 'Isi Plan Man-Day pada alokasi resource yang sudah ada'
};
function handleGetProjectsNeedAttention_(body) {
  var risksRes = handleGetProjectRisks_(body);
  var order = { CRITICAL: 0, 'AT RISK': 1, WATCH: 2 };
  var attention = risksRes.risks.filter(function (r) { return r.riskLevel !== 'NORMAL'; });
  attention.sort(function (a, b) { return order[a.riskLevel] - order[b.riskLevel]; });
  var withActions = attention.map(function (r, idx) {
    // Phase 5.1 fix: the action must match the reason that actually
    // determined riskLevel (primaryReasonKey), not just whichever flag was
    // evaluated first (reasonKeys[0]) — see RISK_LEVEL_REASON_PRIORITY_.
    return {
      priority: idx + 1, projectId: r.projectId, projectNo: r.projectNo, projectName: r.projectName, pic: r.pic,
      reason: r.riskReasons.join('; '), target: r.targetDate, status: r.status, riskLevel: r.riskLevel,
      primaryReason: r.primaryReason, source: r.primarySource,
      recommendedAction: r.primaryReasonKey ? (ATTENTION_ACTION_MAP_[r.primaryReasonKey] || 'Review project ini') : 'Review project ini'
    };
  });
  return { ok: true, projects: withActions };
}

/* ============================================================
 *  PART G/H/K — EXTERNAL WEEKLY REPORT
 *  Two shapes per project: `internal` (full detail, PSP-only) and
 *  `customerFacing` (a strictly reduced subset — see
 *  WEEKLY_REPORT_DATA_MODEL.md for the exact field-by-field
 *  inclusion/exclusion list and why).
 * ============================================================ */
/**
 * Phase 5.1 fix: pick the chronologically-latest log inside the period,
 * not just the last one in sheet insertion order. DailyLogs rows are
 * appended in whatever order they were entered — for normal same-day
 * entry that matches chronological order, but a backfilled/out-of-order
 * entry would otherwise silently make an older log look "latest".
 */
function latestLogInPeriod_(logs, period) {
  var inPeriod = logs.filter(function (l) { var d = parseDate_(l.date); return d && d >= period.startDate && d <= period.endDate; });
  inPeriod.sort(function (a, b) { return parseDate_(a.date) - parseDate_(b.date); });
  return inPeriod.length ? inPeriod[inPeriod.length - 1] : null;
}

function handleGetExternalWeeklyReport_(body) {
  var period = parseReportingPeriod_(body);
  var ctx = buildProjectRiskContext_();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var focusStatuses = ['PO', 'EXECUTION', 'ON HOLD', 'COMPLETED'];
  var includeAll = body && body.allStatuses;
  var externalProjects = ctx.projects.filter(function (p) {
    return p.type === 'EXTERNAL' && (includeAll || focusStatuses.indexOf(p.status) !== -1);
  });

  var rows = externalProjects.map(function (p) {
    var risk = computeProjectRisk_(p, ctx.wbsAll, ctx.allocAll, ctx.dailyByLegacyId, ctx.engineerStatusByName, today);
    var wbsForProject = ctx.wbsAll.filter(function (w) { return w.projectId === p.id; });
    var currentActivity = wbsForProject.filter(function (w) { return w.status === 'ON PROGRESS'; })[0] ||
      (wbsForProject.length ? wbsForProject[wbsForProject.length - 1] : null);
    var allocForProject = ctx.allocAll.filter(function (a) { return wbsForProject.some(function (w) { return w.id === a.wbsId; }); });
    var planMd = allocForProject.reduce(function (s, a) { return s + a.planManDay; }, 0);
    var actualMd = allocForProject.reduce(function (s, a) { return s + a.actualManDay; }, 0);
    var logs = p.legacyProjectId ? (ctx.dailyByLegacyId[p.legacyProjectId] || []) : [];
    var latestLog = latestLogInPeriod_(logs, period);
    var avgProgress = wbsForProject.length ? Math.round(wbsForProject.reduce(function (s, w) { return s + (Number(w.progress) || 0); }, 0) / wbsForProject.length) : 0;
    var scheduleStatus = risk.health === 'RED' ? 'DELAYED' : (risk.health === 'ORANGE' ? 'AT RISK' : 'ON TRACK');

    var internalRow = {
      projectId: p.id, customer: p.customer, country: p.country, plant: p.plant, projectNo: p.no, projectName: p.name,
      pic: p.pic, status: p.status, overallProgress: avgProgress,
      currentActivity: currentActivity ? currentActivity.name : '',
      plannedThisWeek: latestLog ? latestLog.plan : '', actualThisWeek: latestLog ? latestLog.actual : '',
      problem: latestLog ? latestLog.problem : '', nextAction: latestLog ? latestLog.next : '',
      targetDate: p.targetDate, scheduleStatus: scheduleStatus, riskLevel: risk.riskLevel,
      manDayPlanned: round2_(planMd), manDayActual: round2_(actualMd), remarks: ''
    };
    // CUSTOMER-FACING: excludes projectId, manDayPlanned/manDayActual (internal
    // capacity data), and riskLevel (internal classification) — see
    // WEEKLY_REPORT_DATA_MODEL.md and CUSTOMER_REPORT_DATA_CONTRACT.md.
    // Customer/Country/Plant are plain descriptive fields, not sensitive —
    // all three stay in the customer-facing row (Phase 5.1: Country is now
    // its own field, never derived from Customer/Plant — see
    // PHASE5.1_CALIBRATION_REPORT.md / ProjectMaster.gs).
    var customerFacingRow = {
      customer: p.customer, country: p.country, plant: p.plant, projectNo: p.no, projectName: p.name, pic: p.pic,
      status: p.status, overallProgress: avgProgress, currentActivity: internalRow.currentActivity,
      plannedThisWeek: internalRow.plannedThisWeek, actualThisWeek: internalRow.actualThisWeek,
      problem: internalRow.problem, nextAction: internalRow.nextAction,
      targetDate: p.targetDate, scheduleStatus: scheduleStatus, remarks: ''
    };
    return { internal: internalRow, customerFacing: customerFacingRow };
  });

  function countBy(pred) { return rows.filter(function (r) { return pred(r.internal); }).length; }
  var reportingPeriod = { startDate: dateOnly_(period.startDate), endDate: dateOnly_(period.endDate), label: period.label };
  var summary = {
    totalActiveProject: rows.length,
    poProject: countBy(function (r) { return r.status === 'PO'; }),
    projectCompleted: countBy(function (r) { return r.status === 'COMPLETED'; }),
    projectOnTrack: countBy(function (r) { return r.scheduleStatus === 'ON TRACK'; }),
    projectAtRisk: countBy(function (r) { return r.scheduleStatus === 'AT RISK'; }),
    projectDelayed: countBy(function (r) { return r.scheduleStatus === 'DELAYED'; })
  };
  function groupCount(keyFn) {
    var out = {};
    rows.forEach(function (r) { var k = keyFn(r.internal) || 'Unknown'; out[k] = (out[k] || 0) + 1; });
    return out;
  }
  // Phase 5.1 fix: `country` used to be an alias for grouping by `customer`
  // (a real bug — see PHASE5.1_CALIBRATION_REPORT.md). Now genuinely
  // separate: `customer` groups by Customer, `country` groups by the real
  // Country field (mostly "Unknown" until it is filled in going forward —
  // never backfilled/guessed for existing rows).
  var groupedBy = {
    customer: groupCount(function (r) { return r.customer; }),
    country: groupCount(function (r) { return r.country; }),
    plant: groupCount(function (r) { return r.plant; }),
    status: groupCount(function (r) { return r.status; }),
    pic: groupCount(function (r) { return r.pic; })
  };

  return {
    ok: true, reportingPeriod: reportingPeriod, summary: summary, groupedBy: groupedBy,
    projects: rows.map(function (r) { return r.internal; }),
    customerFacingProjects: rows.map(function (r) { return r.customerFacing; })
  };
}

/* ============================================================
 *  PART I — INTERNAL WEEKLY REPORT (+ Irregular Job, read from the
 *  existing SupportJobs sheet — no duplicate storage created)
 * ============================================================ */
function handleGetInternalWeeklyReport_(body) {
  var period = parseReportingPeriod_(body);
  var ctx = buildProjectRiskContext_();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var internalProjects = ctx.projects.filter(function (p) { return p.type === 'INTERNAL'; });

  var rows = internalProjects.map(function (p) {
    var risk = computeProjectRisk_(p, ctx.wbsAll, ctx.allocAll, ctx.dailyByLegacyId, ctx.engineerStatusByName, today);
    var wbsForProject = ctx.wbsAll.filter(function (w) { return w.projectId === p.id; });
    var allocForProject = ctx.allocAll.filter(function (a) { return wbsForProject.some(function (w) { return w.id === a.wbsId; }); });
    var planMd = allocForProject.reduce(function (s, a) { return s + a.planManDay; }, 0);
    var actualMd = allocForProject.reduce(function (s, a) { return s + a.actualManDay; }, 0);
    var logs = p.legacyProjectId ? (ctx.dailyByLegacyId[p.legacyProjectId] || []) : [];
    var latestLog = latestLogInPeriod_(logs, period);
    var avgProgress = wbsForProject.length ? Math.round(wbsForProject.reduce(function (s, w) { return s + (Number(w.progress) || 0); }, 0) / wbsForProject.length) : 0;
    var picLoading = ctx.engineerLoadingFull.engineers.filter(function (e) { return e.engineer === p.pic; })[0] || null;

    return {
      projectId: p.id, projectNo: p.no, projectName: p.name, pic: p.pic, status: p.status, progress: avgProgress,
      wbsCount: wbsForProject.length,
      plannedThisWeek: latestLog ? latestLog.plan : '', actualThisWeek: latestLog ? latestLog.actual : '',
      problem: latestLog ? latestLog.problem : '', nextAction: latestLog ? latestLog.next : '',
      targetDate: p.targetDate, manDayPlanned: round2_(planMd), manDayActual: round2_(actualMd),
      loading: picLoading ? { plannedMD: picLoading.plannedMD, availableMD: picLoading.availableMD, status: picLoading.status } : null,
      riskLevel: risk.riskLevel
    };
  });

  var irregularRaw = rowsToObjects_(getSheet_(SHEET_NAMES.SUPPORT));
  var irregularInPeriod = irregularRaw.filter(function (j) { var d = parseDate_(j.Date); return d && d >= period.startDate && d <= period.endDate; });
  var byCategory = {};
  irregularInPeriod.forEach(function (j) {
    var cat = j.Type || 'Other';
    if (!byCategory[cat]) byCategory[cat] = { category: cat, count: 0, manDay: 0 };
    byCategory[cat].count++;
    byCategory[cat].manDay += Number(j.ManDay) || 0;
  });

  return {
    ok: true,
    reportingPeriod: { startDate: dateOnly_(period.startDate), endDate: dateOnly_(period.endDate), label: period.label },
    projects: rows,
    irregularJobs: {
      byCategory: Object.keys(byCategory).map(function (k) { return byCategory[k]; }),
      totalManDay: round2_(irregularInPeriod.reduce(function (s, j) { return s + (Number(j.ManDay) || 0); }, 0)),
      totalCount: irregularInPeriod.length
    }
  };
}

/* ============================================================
 *  PART A/B/C — EXECUTIVE DASHBOARD
 * ============================================================ */
function handleGetExecutiveDashboard_(body) {
  var periodType = (body && body.periodType) || 'month';
  var ctx = buildProjectRiskContext_();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var risks = ctx.projects.map(function (p) {
    return computeProjectRisk_(p, ctx.wbsAll, ctx.allocAll, ctx.dailyByLegacyId, ctx.engineerStatusByName, today);
  });

  var portfolio = { totalActive: 0, external: 0, internal: 0, rfq: 0, study: 0, quotation: 0, negotiation: 0, po: 0, execution: 0, completed: 0, onHold: 0, cancelled: 0 };
  var statusKeyMap = { RFQ: 'rfq', STUDY: 'study', QUOTATION: 'quotation', NEGOTIATION: 'negotiation', PO: 'po', EXECUTION: 'execution', COMPLETED: 'completed', 'ON HOLD': 'onHold', CANCELLED: 'cancelled' };
  ctx.projects.forEach(function (p) {
    if (p.type === 'EXTERNAL') portfolio.external++; else if (p.type === 'INTERNAL') portfolio.internal++;
    if (p.status !== 'COMPLETED' && p.status !== 'CANCELLED') portfolio.totalActive++;
    var key = statusKeyMap[p.status];
    if (key) portfolio[key]++;
  });

  var progress = {
    onTrack: risks.filter(function (r) { return r.health === 'GREEN'; }).length,
    atRisk: risks.filter(function (r) { return r.health === 'ORANGE'; }).length,
    delayed: risks.filter(function (r) { return r.health === 'RED'; }).length,
    withoutRecentUpdate: risks.filter(function (r) { return r.flags.noRecentUpdate; }).length,
    nearTargetDate: risks.filter(function (r) { return r.flags.nearTarget; }).length,
    overdue: risks.filter(function (r) { return r.flags.overdue; }).length
  };

  var manpower = handleGetManpowerAnalysis_({ periodType: periodType });
  var eng = ctx.engineerLoadingFull;
  var manpowerSummary = {
    currentMp: manpower.currentMp,
    requiredMp: manpower.idealMP.exact,
    additionalMp: manpower.indicativeAdditionalMPExact,
    managementBaselineMp: manpower.managementBaselineAdditionalMP,
    managementTargetMp: manpower.currentMp + manpower.managementBaselineAdditionalMP,
    utilizationPct: handleGetWorkloadSummary_({ periodType: periodType }).utilizationPct,
    capacityGapMd: manpower.gapMD,
    overloadedEngineers: eng.engineers.filter(function (e) { return e.status === 'OVERLOAD'; }).length,
    highLoadEngineers: eng.engineers.filter(function (e) { return e.status === 'HIGH LOAD'; }).length
  };

  var weekly = handleGetWorkloadSummary_({ periodType: 'week' });
  var monthly = handleGetWorkloadSummary_({ periodType: 'month' });
  var bySkill = handleGetManpowerBySkill_({ periodType: periodType });
  var workload = {
    projectWorkloadMd: round2_(weekly.byType.EXTERNAL.plannedMD + weekly.byType.INTERNAL.plannedMD),
    irregularWorkloadMd: weekly.byType.IRREGULAR.plannedMD,
    totalWorkloadMd: weekly.totalPlannedMD,
    weekly: weekly, monthly: monthly, bySkill: bySkill.skills, byEngineer: eng.engineers
  };

  // "GLOBAL SUPPORT" per Part A is the External/Global PROJECT_MASTER stream
  // (its PO/RFQ/Execution sub-bullets are PROJECT_MASTER status values, not
  // the legacy GlobalSupport sheet's OPEN/ON PROGRESS/CLOSE) — same naming
  // collision flagged in the Phase 1.5 audit. Both are reported, clearly
  // separated. See PHASE5_REPORTING_MODEL.md.
  var externalProjects = ctx.projects.filter(function (p) { return p.type === 'EXTERNAL'; });
  var byCustomer = {}, byCountry = {};
  externalProjects.forEach(function (p) {
    var k = p.customer || 'Unknown'; byCustomer[k] = (byCustomer[k] || 0) + 1;
    // Phase 5.1: genuinely grouped by the Country field now, not Customer — see
    // PHASE5.1_CALIBRATION_REPORT.md. "Unknown" until Country is filled in.
    var c = p.country || 'Unknown'; byCountry[c] = (byCountry[c] || 0) + 1;
  });
  var globalSupport = {
    activeExternal: externalProjects.filter(function (p) { return p.status !== 'COMPLETED' && p.status !== 'CANCELLED'; }).length,
    byCustomer: Object.keys(byCustomer).map(function (k) { return { customer: k, count: byCustomer[k] }; }),
    byCountry: Object.keys(byCountry).map(function (k) { return { country: k, count: byCountry[k] }; }),
    po: externalProjects.filter(function (p) { return p.status === 'PO'; }).length,
    rfq: externalProjects.filter(function (p) { return p.status === 'RFQ'; }).length,
    execution: externalProjects.filter(function (p) { return p.status === 'EXECUTION'; }).length,
    requiringCustomerUpdate: risks.filter(function (r) { return r.type === 'EXTERNAL' && r.flags.externalPoStale; }).length
  };
  var legacyGlobalSupportRows = rowsToObjects_(getSheet_(SHEET_NAMES.GLOBAL));
  var legacyByStatus = {};
  legacyGlobalSupportRows.forEach(function (g) { legacyByStatus[g.Status] = (legacyByStatus[g.Status] || 0) + 1; });

  // Phase 5.1, Part 10: surface the existing (Phase 3.1) Data Quality Report
  // on the dashboard, read-only — this never modifies source data, it only
  // reports the count getDataQualityReport already computes. Status is a
  // plain, documented rule: any issue at all -> WARNING, otherwise OK.
  var dq = handleGetDataQualityReport_();
  var dataQuality = {
    status: dq.totalIssues > 0 ? 'WARNING' : 'OK',
    totalIssues: dq.totalIssues,
    bySeverity: dq.bySeverity
  };

  return {
    ok: true,
    reportingPeriod: { periodType: periodType, generatedAt: new Date().toISOString() },
    summary: { portfolio: portfolio, progress: progress },
    manpower: manpowerSummary,
    workload: workload,
    globalSupport: globalSupport,
    globalSupportLegacy: {
      note: 'Ad-hoc support-to-other-Musashi-plants log (legacy GlobalSupport sheet) — a different concept from the External/Global project stream above.',
      byStatus: legacyByStatus, total: legacyGlobalSupportRows.length
    },
    irregularJobsTotal: rowsToObjects_(getSheet_(SHEET_NAMES.SUPPORT)).length,
    dataQuality: dataQuality,
    risks: risks
  };
}

/* ============================================================
 *  Combined preview (Part M "Reporting Preview" page) — reuses
 *  every handler above, computes nothing new itself.
 * ============================================================ */
function handleGetReportingPreview_(body) {
  var dashboard = handleGetExecutiveDashboard_(body);
  var external = handleGetExternalWeeklyReport_(body);
  var internalReport = handleGetInternalWeeklyReport_(body);
  var attention = handleGetProjectsNeedAttention_(body);
  return {
    ok: true,
    reportingPeriod: external.reportingPeriod,
    summary: { portfolio: dashboard.summary.portfolio, progress: dashboard.summary.progress, external: external.summary },
    manpower: dashboard.manpower,
    workload: dashboard.workload,
    dataQuality: dashboard.dataQuality,
    externalReportSummary: external.summary,
    internalReportSummary: { totalProjects: internalReport.projects.length, irregularJobs: internalReport.irregularJobs },
    attention: attention.projects.slice(0, 10)
  };
}
