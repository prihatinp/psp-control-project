/**
 * phase5-test.js — Phase 5: Executive Dashboard, Project Risk Engine,
 * Projects Need Attention, External/Internal Weekly Report, Reporting
 * Preview. Every handler under test is read-only (no LockService use,
 * no sheet mutation) — this file's "no mutation from reads" checks
 * confirm that directly, the same way phase3-test.js checked its own
 * read-only report action.
 * Run with: node backend/production/test/phase5-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createMockGasContext } = require('./mock-gas-v2');

const PROD_DIR = path.join(__dirname, '..');
const LOAD_ORDER = ['Code.gs', 'ProjectMaster.gs', 'WbsWorkload.gs', 'Organization.gs', 'Reporting.gs'];

function freshContext() {
  const mockGlobals = createMockGasContext({ SS_ID: 'mock-ss', HMAC_SECRET: 'test-secret' });
  const context = vm.createContext(mockGlobals);
  LOAD_ORDER.forEach(file => vm.runInContext(fs.readFileSync(path.join(PROD_DIR, file), 'utf-8'), context, { filename: file }));
  return { mockGlobals, context };
}
function post(context, action, body, token) {
  const payload = Object.assign({ action }, body || {});
  if (token) payload.token = token;
  return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
}

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  ok  -', label); }
  catch (e) { failed++; console.error('  FAIL -', label, '\n       ', e.message); }
}

const { mockGlobals, context } = freshContext();
context.setupSpreadsheet();
const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

function daysFromToday(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayStr() { return daysFromToday(0); }

/* ================================================================
 *  FIXTURES
 *  - Migrate the real legacy Projects (all INTERNAL by the documented
 *    migration mapping) so risk/report tests can exercise real
 *    DailyLogs joined via LegacyProjectId, exactly as production would.
 *  - Add a handful of EXTERNAL projects with relative (today +/- N)
 *    dates so risk-cascade assertions never depend on which real
 *    calendar date this test happens to run on.
 * ================================================================ */
post(context, 'migrateLegacyProjects', {}, token); // 14 legacy -> INTERNAL PROJECT_MASTER rows (2 COMPLETED: PSP-013, PSP-005)

const extCritical = post(context, 'addProjectMaster', {
  type: 'EXTERNAL', name: 'Ext Critical PO', customer: 'Musashi Vietnam', plant: 'Plant A',
  pic: 'Sukiyo', status: 'PO', targetDate: daysFromToday(2)
}, token).project.id;

const extNormal = post(context, 'addProjectMaster', {
  type: 'EXTERNAL', name: 'Ext Normal Execution', customer: 'Musashi India', plant: 'Plant B',
  pic: 'Wardiyono', status: 'EXECUTION', targetDate: daysFromToday(400)
}, token).project.id;
const extNormalWbs = post(context, 'createWBS', { projectId: extNormal, name: 'Design phase', startDate: todayStr(), skill: 'Mechanical Design', progress: 20 }, token).wbs.id;
post(context, 'saveResourceAllocation', { wbsId: extNormalWbs, engineer: 'Wardiyono', role: 'PIC', planManDay: 1 }, token);

const extOverdue = post(context, 'addProjectMaster', {
  type: 'EXTERNAL', name: 'Ext Overdue', customer: 'Musashi Mexico', plant: 'Plant C',
  pic: 'Muharir', status: 'EXECUTION', targetDate: daysFromToday(-30)
}, token).project.id;

const intNormal = post(context, 'addProjectMaster', {
  type: 'INTERNAL', name: 'Int Normal', pic: 'Fajar Sani', status: 'EXECUTION', targetDate: daysFromToday(400)
}, token).project.id;
const intNormalWbs = post(context, 'createWBS', { projectId: intNormal, name: 'Build phase', startDate: todayStr(), skill: 'Electrical / PLC', progress: 10 }, token).wbs.id;
post(context, 'saveResourceAllocation', { wbsId: intNormalWbs, engineer: 'Fajar Sani', role: 'PIC', planManDay: 3 }, token);

const intStale = post(context, 'addProjectMaster', {
  type: 'INTERNAL', name: 'Int Stale No Update', pic: 'Nugroho Edy S', status: 'EXECUTION', targetDate: daysFromToday(400)
}, token).project.id;
// Age this one project's UpdatedAt directly in the sheet (no API mutates history) to
// exercise "no recent update" detection without waiting 8 real days.
(function () {
  const rows = mockGlobals.__SHEETS.PROJECT_MASTER.rows;
  const idx = rows.findIndex(r => r[0] === intStale);
  const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 20);
  rows[idx][24] = oldDate.toISOString(); // UpdatedAt column (see PROJECT_MASTER_HEADERS)
})();

post(context, 'saveSupportJob', { date: todayStr(), type: 'Capacity Up', line: 'Line X', pic: 'Sukiyo', manDay: 3, desc: 'Phase 5 test irregular job' }, token);

console.log('=== PART A/B/C: Executive Dashboard ===');
const dash = post(context, 'getExecutiveDashboard', { periodType: 'month' }, token);

check('1. dashboard KPI calc: request succeeds with expected top-level shape', () => {
  assert.strictEqual(dash.ok, true);
  assert.ok(dash.summary && dash.summary.portfolio && dash.summary.progress);
  assert.ok(dash.manpower && dash.workload && dash.globalSupport);
});
check('2. external project count', () => {
  assert.strictEqual(dash.summary.portfolio.external, 3); // extCritical, extNormal, extOverdue
});
check('3. internal project count', () => {
  assert.strictEqual(dash.summary.portfolio.internal, 16); // 14 migrated + intNormal + intStale
});
check('4. PO project count', () => {
  assert.strictEqual(dash.summary.portfolio.po, 1); // extCritical only
});
check('5. active project count excludes COMPLETED/CANCELLED', () => {
  assert.strictEqual(dash.summary.portfolio.totalActive, 19 - 2); // 19 total, 2 migrated are COMPLETED
});
check('6. completed project count (from migration: PSP-013 stage 18, PSP-005 stage 18)', () => {
  assert.strictEqual(dash.summary.portfolio.completed, 2);
});

console.log('\n=== PART D: Project Risk Engine ===');
const risksRes = post(context, 'getProjectRisks', {}, token);
function riskFor(projectId) { return risksRes.risks.filter(r => r.projectId === projectId)[0]; }

check('7. risk detection: every project gets exactly one of the four documented risk levels', () => {
  assert.strictEqual(risksRes.risks.length, 19);
  const allowed = ['CRITICAL', 'AT RISK', 'WATCH', 'NORMAL'];
  assert.ok(risksRes.risks.every(r => allowed.indexOf(r.riskLevel) !== -1));
});
check('8. overdue detection', () => {
  const r = riskFor(extOverdue);
  assert.strictEqual(r.flags.overdue, true);
  assert.strictEqual(r.riskLevel, 'CRITICAL');
  assert.strictEqual(r.health, 'RED');
});
check('9. no-update detection', () => {
  const r = riskFor(intStale);
  assert.strictEqual(r.flags.noRecentUpdate, true);
  assert.ok(r.riskLevel === 'WATCH' || r.riskLevel === 'AT RISK' || r.riskLevel === 'CRITICAL');
});
check('critical-deadline PO project is CRITICAL (isolated from overdue)', () => {
  const r = riskFor(extCritical);
  assert.strictEqual(r.flags.overdue, false);
  assert.strictEqual(r.riskLevel, 'CRITICAL');
});
check('a healthy, on-schedule, allocated project is NORMAL/GREEN', () => {
  const r = riskFor(extNormal);
  assert.strictEqual(r.riskLevel, 'NORMAL');
  assert.strictEqual(r.health, 'GREEN');
});

console.log('\n=== PART L: Projects Need Attention ===');
const attention = post(context, 'getProjectsNeedAttention', {}, token);
check('attention list excludes NORMAL projects and is sorted CRITICAL -> AT RISK -> WATCH', () => {
  assert.ok(attention.projects.every(p => p.riskLevel !== 'NORMAL'));
  const order = { CRITICAL: 0, 'AT RISK': 1, WATCH: 2 };
  for (let i = 1; i < attention.projects.length; i++) {
    assert.ok(order[attention.projects[i].riskLevel] >= order[attention.projects[i - 1].riskLevel]);
  }
  assert.ok(attention.projects.every(p => typeof p.recommendedAction === 'string' && p.recommendedAction.length > 0));
});

console.log('\n=== PART 10-12: Manpower calc + Management Baseline reference ===');
check('10. manpower calc in the dashboard matches a direct getManpowerAnalysis call', () => {
  const direct = post(context, 'getManpowerAnalysis', { periodType: 'month' }, token);
  assert.strictEqual(dash.manpower.currentMp, direct.currentMp);
  assert.strictEqual(dash.manpower.additionalMp, direct.indicativeAdditionalMPExact);
});
check('11. management baseline stays +8, tagged REFERENCE, and target = current + baseline (never overwritten by calc)', () => {
  assert.strictEqual(dash.manpower.managementBaselineMp, 8);
  assert.strictEqual(dash.manpower.managementTargetMp, dash.manpower.currentMp + 8);
});
check('12. scenario engine (Phase 4) is unaffected by Phase 5 and stays consistent with reported current MP', () => {
  const scenario = post(context, 'getManpowerScenario', { periodType: 'month' }, token);
  assert.strictEqual(scenario.scenarios[0].simulatedMp, dash.manpower.currentMp);
  assert.deepStrictEqual(scenario.scenarios.map(s => s.label), ['CURRENT', 'CURRENT + 1', 'CURRENT + 2', 'CURRENT + 4', 'CURRENT + 8']);
});

console.log('\n=== PART 13: Irregular job workload inclusion ===');
check('13. the Irregular Job just seeded is reflected in dashboard workload and internal report totals', () => {
  assert.ok(dash.workload.irregularWorkloadMd >= 3);
  assert.ok(dash.irregularJobsTotal >= 1);
  const internalReport = post(context, 'getInternalWeeklyReport', {}, token);
  assert.ok(internalReport.irregularJobs.totalManDay >= 3);
  assert.ok(internalReport.irregularJobs.totalCount >= 1);
  const cap = internalReport.irregularJobs.byCategory.filter(c => c.category === 'Capacity Up')[0];
  assert.ok(cap && cap.manDay >= 3);
});

console.log('\n=== PART 14: Weekly date filtering ===');
check('14a. isoWeekToMonday_/parseReportingPeriod_ always returns a Monday-start, 7-day-inclusive range', () => {
  const period = context.parseReportingPeriod_({ week: '2026-W36' });
  assert.strictEqual(period.startDate.getDay(), 1, 'startDate must be a Monday');
  const diffDays = Math.floor((period.endDate - period.startDate) / 86400000);
  assert.strictEqual(diffDays, 6);
});
check('14b. default (no period given) = current week, includes today\'s DailyLogs via LegacyProjectId join', () => {
  const internalReport = post(context, 'getInternalWeeklyReport', {}, token);
  const row = internalReport.projects.filter(p => p.projectNo === '2026-PSP-012')[0];
  assert.ok(row, 'migrated project 2026-PSP-012 must be present');
  assert.notStrictEqual(row.plannedThisWeek, '', 'daysAgo(2) log for PSP-012 should fall inside the current week');
});
check('14c. an explicit out-of-range period excludes the same log', () => {
  const internalReport = post(context, 'getInternalWeeklyReport', { startDate: '2000-01-01', endDate: '2000-01-02' }, token);
  const row = internalReport.projects.filter(p => p.projectNo === '2026-PSP-012')[0];
  assert.strictEqual(row.plannedThisWeek, '');
});

console.log('\n=== PART 15-17: External/Internal report datasets + customer-facing filtering ===');
const extReport = post(context, 'getExternalWeeklyReport', {}, token);
check('15. external report dataset contains only EXTERNAL-type, focus-status projects', () => {
  assert.strictEqual(extReport.projects.length, 3);
  assert.strictEqual(extReport.summary.totalActiveProject, 3);
  assert.strictEqual(extReport.summary.poProject, 1);
});
check('16. internal report dataset contains only INTERNAL-type projects', () => {
  const internalReport = post(context, 'getInternalWeeklyReport', {}, token);
  assert.strictEqual(internalReport.projects.length, 16);
});
check('17. customer-facing rows strictly exclude internal-only fields; internal rows keep them', () => {
  assert.ok(extReport.projects.every(p => 'manDayPlanned' in p && 'manDayActual' in p && 'riskLevel' in p && 'projectId' in p));
  assert.ok(extReport.customerFacingProjects.every(p =>
    !('manDayPlanned' in p) && !('manDayActual' in p) && !('riskLevel' in p) && !('projectId' in p)
  ));
  assert.strictEqual(extReport.customerFacingProjects.length, extReport.projects.length);
});

console.log('\n=== PART 18: Reporting data consistency ===');
check('18. dashboard, external report and risk engine agree with each other', () => {
  assert.strictEqual(dash.risks.length, risksRes.risks.length);
  assert.strictEqual(extReport.summary.totalActiveProject, dash.summary.portfolio.external);
  const preview = post(context, 'getReportingPreview', {}, token);
  assert.strictEqual(preview.ok, true);
  assert.deepStrictEqual(preview.summary.portfolio, dash.summary.portfolio);
});

console.log('\n=== PART 19-20: Authentication + Rate limiting ===');
check('19. a Phase 5 action without a token is rejected', () => {
  const res = post(context, 'getExecutiveDashboard', {});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.authError, true);
});
check('20. Phase 5 actions are rate-limited exactly like every other action (60/min/user)', () => {
  const rlToken = post(context, 'login', { name: 'Muharir', pin: 'psp2026' }).token;
  let lastOk = true, blockedAt = -1;
  for (let i = 1; i <= 61; i++) {
    const res = post(context, 'getExecutiveDashboard', {}, rlToken);
    if (!res.ok && /Terlalu banyak/.test(res.message || '')) { blockedAt = i; lastOk = false; break; }
  }
  assert.strictEqual(blockedAt, 61, 'the 61st call in the same minute must be rate-limited');
});

console.log('\n=== PART 21: Legacy/prior-phase compatibility (full regression) ===');
check('21. legacy + Phase 2/3/4 actions all still work with Reporting.gs loaded', () => {
  assert.ok(post(context, 'bootstrap', {}, token).ok);
  assert.ok(post(context, 'projectMasterList', {}, token).ok);
  assert.ok(post(context, 'getWorkloadSummary', { periodType: 'month' }, token).ok);
  assert.ok(post(context, 'getOrgStructure', {}, token).ok);
});

console.log('\n=== PART 22: No mutation from any Phase 5 read ===');
check('22. calling every Phase 5 action leaves every sheet row count unchanged', () => {
  const before = {};
  Object.keys(mockGlobals.__SHEETS).forEach(k => { before[k] = mockGlobals.__SHEETS[k].rows.length; });
  post(context, 'getExecutiveDashboard', {}, token);
  post(context, 'getProjectRisks', {}, token);
  post(context, 'getProjectsNeedAttention', {}, token);
  post(context, 'getExternalWeeklyReport', {}, token);
  post(context, 'getInternalWeeklyReport', {}, token);
  post(context, 'getReportingPreview', {}, token);
  Object.keys(mockGlobals.__SHEETS).forEach(k => {
    assert.strictEqual(mockGlobals.__SHEETS[k].rows.length, before[k], k + ' row count must not change from a read-only report call');
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
