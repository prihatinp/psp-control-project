/**
 * phase3-test.js — loads Code.gs + ProjectMaster.gs + WbsWorkload.gs into
 * the mocked Apps Script runtime and exercises the Phase 3 WBS/Man-Day/
 * Workload/Capacity foundation, plus a full regression pass over Phase 1/2.
 * Run with: node backend/production/test/phase3-test.js
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
  LOAD_ORDER.forEach(file => {
    const code = fs.readFileSync(path.join(PROD_DIR, file), 'utf-8');
    vm.runInContext(code, context, { filename: file });
  });
  return { mockGlobals, context };
}

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  ok  -', label); }
  catch (e) { failed++; console.error('  FAIL -', label, '\n       ', e.message); }
}

function post(context, action, body, token) {
  const payload = Object.assign({ action }, body || {});
  if (token) payload.token = token;
  return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
}
function get(context, params) {
  return JSON.parse(context.doGet({ parameter: params || {} }).getContent());
}

console.log('=== Setup ===');
const { mockGlobals, context } = freshContext();
context.setupSpreadsheet();
const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

check('setup created WBS + RESOURCE_ALLOCATION sheets and Phase 3 Config keys', () => {
  assert.ok(mockGlobals.__SHEETS.WBS);
  assert.ok(mockGlobals.__SHEETS.RESOURCE_ALLOCATION);
  const cfgKeys = mockGlobals.__SHEETS.Config.rows.slice(1).map(r => r[0]);
  ['WBS_STATUS_LIST', 'WORKING_DAYS_PER_WEEK', 'UTILIZATION_FACTOR', 'MANAGEMENT_BASELINE_ADDITIONAL_MP'].forEach(k =>
    assert.ok(cfgKeys.indexOf(k) !== -1, k + ' missing'));
});

// Use a fixed "this week" project so dates land predictably regardless of when the test runs.
const today = new Date();
const monday = new Date(today);
monday.setDate(today.getDate() - ((today.getDay() || 7) - 1));
const thisWeekStr = monday.toISOString().slice(0, 10);
const thisMonthKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');

let extProjectId, intProjectId;
check('Phase 2 regression: create External + Internal projects still works', () => {
  extProjectId = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Gear Checker', pic: 'Sukiyo', targetDate: '2026-12-31' }, token).project.id;
  intProjectId = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'Reduce MP Line 9', pic: 'Muharir', targetDate: '2026-09-30' }, token).project.id;
  assert.ok(extProjectId && intProjectId);
});

console.log('\n=== 1-2. WBS creation + hierarchy ===');
let phaseId, activityId, taskId;
check('1. createWBS — top-level Phase under External project', () => {
  const res = post(context, 'createWBS', { projectId: extProjectId, name: 'Engineering', type: 'Phase', level: 1, startDate: thisWeekStr }, token);
  assert.strictEqual(res.ok, true);
  phaseId = res.wbs.id;
  assert.strictEqual(res.wbs.parentId, '');
});
check('2. WBS hierarchy — Activity under Phase, Task under Activity', () => {
  const act = post(context, 'createActivity', { projectId: extProjectId, parentId: phaseId, name: 'Electrical design', type: 'Activity', level: 2, startDate: thisWeekStr, skill: 'Electrical / PLC' }, token);
  assert.strictEqual(act.ok, true);
  activityId = act.wbs.id;
  assert.strictEqual(act.wbs.parentId, phaseId);
  const task = post(context, 'createActivity', { projectId: extProjectId, parentId: activityId, name: 'Wiring diagram', level: 3, startDate: thisWeekStr }, token);
  taskId = task.wbs.id;
  assert.strictEqual(task.wbs.level, 3);
});
check('rejects an unknown WBS status', () => {
  const res = post(context, 'createWBS', { projectId: extProjectId, name: 'x', status: 'MAYBE' }, token);
  assert.strictEqual(res.ok, false);
});

console.log('\n=== 3-4. Activity update ===');
check('3+4. updateActivity changes status and progress', () => {
  const res = post(context, 'updateActivity', { id: activityId, status: 'ON PROGRESS', progress: 40 }, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.wbs.status, 'ON PROGRESS');
  assert.strictEqual(res.wbs.progress, 40);
});
check('getActivities / getWBS / listWbsForProject', () => {
  const list = post(context, 'getActivities', { projectId: extProjectId }, token);
  assert.strictEqual(list.wbs.length, 3);
  const one = post(context, 'getWBS', { id: activityId }, token);
  assert.strictEqual(one.wbs.name, 'Electrical design');
});
check('deleteWBS is non-destructive (status -> CANCELLED, row remains)', () => {
  const before = mockGlobals.__SHEETS.WBS.rows.length;
  const res = post(context, 'deleteWBS', { id: taskId }, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.wbs.status, 'CANCELLED');
  assert.strictEqual(mockGlobals.__SHEETS.WBS.rows.length, before, 'row count must not change');
});

console.log('\n=== 5-6. Multiple engineers + Man-Day aggregation ===');
check('5. multiple engineers on one activity, each with their own Man-Day', () => {
  const r1 = post(context, 'saveResourceAllocation', { wbsId: activityId, engineer: 'Sukiyo', role: 'PIC', planManDay: 4 }, token);
  const r2 = post(context, 'saveResourceAllocation', { wbsId: activityId, engineer: 'Nugroho Edy S', role: 'SUPPORT', planManDay: 2 }, token);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r2.ok, true);
});
check('6. Man-Day totals aggregate correctly (4 + 2 = 6 MD)', () => {
  const res = post(context, 'getResourceAllocation', { wbsId: activityId }, token);
  assert.strictEqual(res.allocations.length, 2);
  assert.strictEqual(res.totalPlanManDay, 6);
});

console.log('\n=== 7-8. Weekly + Monthly aggregation ===');
check('7. weekly workload summary includes the 6 MD just allocated', () => {
  const res = post(context, 'getWorkloadSummary', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.strictEqual(res.ok, true);
  assert.ok(res.totalPlannedMD >= 6, 'expected at least the 6 MD just added, got ' + res.totalPlannedMD);
  assert.ok(res.byType.EXTERNAL.plannedMD >= 6);
});
check('8. monthly workload summary also includes it (same week falls in this month)', () => {
  const res = post(context, 'getWorkloadSummary', { periodType: 'month', periodKey: thisMonthKey }, token);
  assert.ok(res.totalPlannedMD >= 6);
});

console.log('\n=== 9-10. Skill aggregation + Engineer loading ===');
check('9. skill loading attributes MD by the engineer\'s own Team skill', () => {
  const res = post(context, 'getSkillLoading', { periodType: 'week', periodKey: thisWeekStr }, token);
  const electrical = res.skills.find(s => s.skill === 'Electrical / PLC'); // Sukiyo's Team.Skill column (not his Role)
  assert.ok(electrical, 'expected Sukiyo\'s real Team.Skill to appear: ' + JSON.stringify(res.skills));
  assert.ok(electrical.plannedMD >= 4);
});
check('10. engineer loading shows Sukiyo\'s 4 MD this week', () => {
  const res = post(context, 'getEngineerLoading', { periodType: 'week', periodKey: thisWeekStr }, token);
  const sukiyo = res.engineers.find(e => e.engineer === 'Sukiyo');
  assert.ok(sukiyo);
  assert.ok(sukiyo.plannedMD >= 4);
});

console.log('\n=== 11. Overload detection ===');
check('11. an engineer over their personal weekly capacity is flagged OVERLOAD', () => {
  // personal weekly capacity = 5 days * 0.75 = 3.75 MD; push Sukiyo well over it
  post(context, 'saveResourceAllocation', { wbsId: activityId, engineer: 'Sukiyo', role: 'PIC', planManDay: 20 }, token);
  const res = post(context, 'getEngineerLoading', { periodType: 'week', periodKey: thisWeekStr }, token);
  const sukiyo = res.engineers.find(e => e.engineer === 'Sukiyo');
  assert.strictEqual(sukiyo.status, 'OVERLOAD');
  assert.ok(sukiyo.overloadMD > 0);
  assert.strictEqual(sukiyo.overloadMD, Math.round((sukiyo.plannedMD - sukiyo.availableMD) * 100) / 100);
});

console.log('\n=== 12-14. Internal / External / Irregular workload separation ===');
let intActivityId;
check('12. internal workload is tracked separately from external', () => {
  const act = post(context, 'createActivity', { projectId: intProjectId, name: 'Mechanical rework', level: 1, startDate: thisWeekStr }, token);
  intActivityId = act.wbs.id;
  post(context, 'saveResourceAllocation', { wbsId: intActivityId, engineer: 'Muharir', role: 'PIC', planManDay: 3 }, token);
  const res = post(context, 'getWorkloadSummary', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.ok(res.byType.INTERNAL.plannedMD >= 3);
});
check('13. external workload total reflects only EXTERNAL-typed projects', () => {
  const res = post(context, 'getWorkloadSummary', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.ok(res.byType.EXTERNAL.plannedMD >= 24, 'expected the 4+20 MD from the External activity');
});
check('14. irregular job workload (legacy SupportJobs) is included and separated', () => {
  // legacy seed data has 4 SupportJobs rows from "daysAgo(1..4)" — at least one falls in this week
  const res = post(context, 'getWorkloadSummary', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.ok('IRREGULAR' in res.byType);
});

console.log('\n=== 15-17. Capacity + Manpower gap + Management baseline ===');
check('15. capacity calculation: gross vs net', () => {
  const res = post(context, 'getCapacitySummary', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.strictEqual(res.currentMp, 14, 'real Team seed has 14 rows (Dadang Sandi not present — see CAPACITY_MODEL.md)');
  assert.strictEqual(res.grossCapacityMD, 14 * 5);
  assert.strictEqual(res.netCapacityMD, 14 * 5 * 0.75);
});
check('16. manpower gap: required vs available', () => {
  const res = post(context, 'getManpowerAnalysis', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.gapMD, res.requiredMD - res.availableMD);
});
check('17. management baseline is a separate, un-overwritten reference', () => {
  const res = post(context, 'getManpowerAnalysis', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.strictEqual(res.managementBaselineAdditionalMP, 8);
  assert.strictEqual(res.managementBaselineLabel, 'Management Baseline — Reference Only');
  assert.ok('indicativeAdditionalMP' in res);
  assert.strictEqual(res.differenceVsBaseline, Math.round((res.indicativeAdditionalMP - 8) * 10) / 10);
});

console.log('\n=== 18-20. Authentication + Sanitization + LockService ===');
check('18. a Phase 3 action without a token is rejected', () => {
  const res = post(context, 'createWBS', { projectId: extProjectId, name: 'x' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.authError, true);
});
check('19. formula-injection sanitization applies to new WBS fields', () => {
  const res = post(context, 'createWBS', { projectId: extProjectId, name: '=cmd|evil', pic: 'Sukiyo' }, token);
  assert.strictEqual(res.wbs.name[0], "'");
});
check('20. LockService wraps createWBS / saveResourceAllocation', () => {
  const before = mockGlobals.__lockStats();
  post(context, 'createWBS', { projectId: extProjectId, name: 'Lock test' }, token);
  const afterWbs = mockGlobals.__lockStats();
  assert.strictEqual(afterWbs.waitCount, before.waitCount + 1);
  post(context, 'saveResourceAllocation', { wbsId: activityId, engineer: 'Sukiyo', planManDay: 1 }, token);
  const afterAlloc = mockGlobals.__lockStats();
  assert.strictEqual(afterAlloc.waitCount, afterWbs.waitCount + 1);
});

console.log('\n=== 21. Existing API regression (Phase 1/2 untouched) ===');
check('21a. legacy bootstrap/addProject/markStage still work', () => {
  const boot = post(context, 'bootstrap', {}, token);
  assert.strictEqual(boot.ok, true);
  assert.strictEqual(boot.projects.length, 14);
  const proj = post(context, 'addProject', { name: 'Legacy check', line: 'L1', start: '2026-01-01', target: '2026-02-01' }, token);
  assert.strictEqual(proj.ok, true);
  const marked = post(context, 'markStage', { projectId: proj.project.id, idx: 0 }, token);
  assert.strictEqual(marked.project.progressStage, 1);
});
check('21b. Phase 2 projectMasterList / migrateLegacyProjects still work', () => {
  const list = post(context, 'projectMasterList', {}, token);
  assert.ok(list.projects.length >= 2);
  const mig = post(context, 'migrateLegacyProjects', {}, token);
  assert.strictEqual(mig.ok, true);
});
check('21c. teamNames (public GET) still works', () => {
  const res = get(context, { action: 'teamNames' });
  assert.strictEqual(res.length, 14);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
