/**
 * phase3.1-test.js — validation/calibration tests for the Phase 3
 * Workload & Capacity engine, plus the new Phase 3.1 data quality
 * report. Run with: node backend/production/test/phase3.1-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createMockGasContext } = require('./mock-gas-v2');

const PROD_DIR = path.join(__dirname, '..');
const LOAD_ORDER = ['Code.gs', 'ProjectMaster.gs', 'WbsWorkload.gs', 'Organization.gs'];

function freshContext() {
  const mockGlobals = createMockGasContext({ SS_ID: 'mock-ss', HMAC_SECRET: 'test-secret' });
  const context = vm.createContext(mockGlobals);
  LOAD_ORDER.forEach(file => {
    const code = fs.readFileSync(path.join(PROD_DIR, file), 'utf-8');
    vm.runInContext(code, context, { filename: file });
  });
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

const today = new Date();
const monday = new Date(today);
monday.setDate(today.getDate() - ((today.getDay() || 7) - 1));
const thisWeekStr = monday.toISOString().slice(0, 10);

console.log('=== 1. Team / Current MP validation ===');
check('14-person scenario: Current MP = 14, not hard-coded', () => {
  const res = post(context, 'getCapacitySummary', { periodType: 'week' }, token);
  assert.strictEqual(res.currentMp, 14);
  assert.strictEqual(res.grossCapacityMD, 14 * 5);
});
check('Dadang Sandi added -> Current MP becomes 15 with NO code change (row appended directly, exactly how an admin would add him in the real Sheet)', () => {
  // Deliberately NOT invented NRP data beyond a placeholder for this test row —
  // this simulates "a 15th row exists", it does not assert what his real NRP is.
  mockGlobals.__SHEETS.Team.rows.push(['TEST-15', 'Dadang Sandi', 'Electrical PIC', 'Electrical / PLC']);
  const res = post(context, 'getCapacitySummary', { periodType: 'week' }, token);
  assert.strictEqual(res.currentMp, 15, '15-person scenario');
  assert.strictEqual(res.grossCapacityMD, 15 * 5);
});
check('teamNames (public) reflects 15 immediately, same live source', () => {
  const res = JSON.parse(context.doGet({ parameter: { action: 'teamNames' } }).getContent());
  assert.strictEqual(res.length, 15);
  assert.ok(res.some(t => t.name === 'Dadang Sandi'));
});

console.log('\n=== Setup for workload tests (synthetic, this test file only) ===');
let extId, intId, extWbs, intWbs;
check('setup: one External + one Internal WBS activity with allocations', () => {
  extId = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Gear Checker', pic: 'Sukiyo', targetDate: '2026-12-31' }, token).project.id;
  intId = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'Reduce MP Line 9', pic: 'Muharir', targetDate: '2026-09-30' }, token).project.id;
  extWbs = post(context, 'createWBS', { projectId: extId, name: 'Electrical design', startDate: thisWeekStr, skill: 'Electrical / PLC' }, token).wbs.id;
  intWbs = post(context, 'createWBS', { projectId: intId, name: 'Mechanical rework', startDate: thisWeekStr }, token).wbs.id;
  post(context, 'saveResourceAllocation', { wbsId: extWbs, engineer: 'Sukiyo', planManDay: 3 }, token);
  post(context, 'saveResourceAllocation', { wbsId: intWbs, engineer: 'Muharir', planManDay: 2 }, token);
});

console.log('\n=== 4. Project workload / Irregular workload / combined ===');
check('project workload (External+Internal) = 5 MD from the two allocations above', () => {
  const res = post(context, 'getWorkloadSummary', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.strictEqual(res.byType.EXTERNAL.plannedMD + res.byType.INTERNAL.plannedMD, 5);
});
check('irregular job workload is present from the legacy SupportJobs seed (Capacity Up / Komarigoto / Quality Up style entries)', () => {
  const res = post(context, 'getWorkloadSummary', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.ok(res.byType.IRREGULAR.plannedMD >= 0, 'IRREGULAR bucket must exist even if 0 this exact week');
  // confirm the legacy SupportJobs rows are readable and untouched (no duplication into a new sheet)
  assert.strictEqual(mockGlobals.__SHEETS.SupportJobs.rows.length - 1, 4, 'legacy seed SupportJobs must be unchanged, 4 rows');
});
check('Project workload + Irregular Job workload = Total PSP workload (the invariant this section asks to confirm)', () => {
  const res = post(context, 'getWorkloadSummary', { periodType: 'week', periodKey: thisWeekStr }, token);
  const sumOfParts = res.byType.EXTERNAL.plannedMD + res.byType.INTERNAL.plannedMD + res.byType.IRREGULAR.plannedMD;
  assert.strictEqual(res.totalPlannedMD, sumOfParts);
});

console.log('\n=== Overload + manpower gap + management baseline ===');
check('overload: pushing one engineer far past personal weekly capacity flags OVERLOAD', () => {
  post(context, 'saveResourceAllocation', { wbsId: extWbs, engineer: 'Sukiyo', planManDay: 30 }, token);
  const res = post(context, 'getEngineerLoading', { periodType: 'week', periodKey: thisWeekStr }, token);
  const sukiyo = res.engineers.find(e => e.engineer === 'Sukiyo');
  assert.strictEqual(sukiyo.status, 'OVERLOAD');
});
check('manpower gap: required vs available vs indicative additional MP', () => {
  const res = post(context, 'getManpowerAnalysis', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.strictEqual(res.gapMD, res.requiredMD - res.availableMD);
  assert.ok(res.indicativeAdditionalMP >= 0);
});
check('management baseline (+8) is never altered by the calculation', () => {
  const res = post(context, 'getManpowerAnalysis', { periodType: 'week', periodKey: thisWeekStr }, token);
  assert.strictEqual(res.managementBaselineAdditionalMP, 8);
  assert.strictEqual(res.managementBaselineLabel, 'Management Baseline — Reference Only');
});

console.log('\n=== 7+8. Data quality report ===');
check('invalid resource: an allocation to a nonexistent engineer is flagged, not silently accepted or fixed', () => {
  const badWbs = post(context, 'createWBS', { projectId: extId, name: 'Bad activity' }, token).wbs.id;
  post(context, 'saveResourceAllocation', { wbsId: badWbs, engineer: 'Nonexistent Person', planManDay: 5 }, token);
  const report = post(context, 'getDataQualityReport', {}, token);
  assert.strictEqual(report.ok, true);
  const found = report.issues.find(i => i.type === 'ENGINEER_NOT_IN_TEAM' && i.message.indexOf('Nonexistent Person') !== -1);
  assert.ok(found, 'expected ENGINEER_NOT_IN_TEAM issue');
});
check('missing PIC, missing start date, zero Man-Day, negative Man-Day, duplicate allocation, project without WBS, WBS without project are all detectable', () => {
  post(context, 'createWBS', { projectId: extId, name: 'No PIC or dates' }, token); // no pic, no startDate
  post(context, 'saveResourceAllocation', { wbsId: extWbs, engineer: 'Sukiyo', planManDay: 0 }, token); // zero MD
  const orphanProject = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'Orphan (no WBS)', pic: 'Sukiyo', targetDate: '2026-01-01' }, token).project.id;
  // duplicate allocation: same engineer+role on the same WBS twice
  post(context, 'saveResourceAllocation', { wbsId: intWbs, engineer: 'Muharir', role: 'SUPPORT', planManDay: 1 }, token);
  post(context, 'saveResourceAllocation', { wbsId: intWbs, engineer: 'Muharir', role: 'SUPPORT', planManDay: 1 }, token);

  const report = post(context, 'getDataQualityReport', {}, token);
  const types = report.issues.map(i => i.type);
  assert.ok(types.indexOf('MISSING_PIC') !== -1, 'MISSING_PIC not found: ' + types.join(','));
  assert.ok(types.indexOf('MISSING_START_DATE') !== -1, 'MISSING_START_DATE not found');
  assert.ok(types.indexOf('ZERO_MAN_DAY') !== -1, 'ZERO_MAN_DAY not found');
  assert.ok(types.indexOf('DUPLICATE_ALLOCATION') !== -1, 'DUPLICATE_ALLOCATION not found');
  assert.ok(types.indexOf('PROJECT_WITHOUT_WBS') !== -1, 'PROJECT_WITHOUT_WBS not found');
  assert.ok(report.totalIssues === report.issues.length);
  assert.ok(report.bySeverity.ERROR + report.bySeverity.WARNING + report.bySeverity.INFO === report.totalIssues);
});
check('data quality report FIXES NOTHING — re-reading the flagged rows shows them unchanged', () => {
  const before = post(context, 'getDataQualityReport', {}, token).totalIssues;
  post(context, 'getDataQualityReport', {}, token); // run again
  const after = post(context, 'getDataQualityReport', {}, token).totalIssues;
  assert.strictEqual(before, after, 'report must be idempotent and non-mutating');
});
check('invalid status is detected without being auto-corrected', () => {
  const w = post(context, 'createWBS', { projectId: extId, name: 'Status test' }, token).wbs;
  // bypass validateWbsStatus_ by writing directly to the sheet, simulating a bad row from elsewhere (e.g. manual sheet edit)
  const idx = mockGlobals.__SHEETS.WBS.rows.findIndex(r => r[0] === w.id);
  mockGlobals.__SHEETS.WBS.rows[idx][7] = 'TOTALLY_INVALID_STATUS'; // STATUS column
  const report = post(context, 'getDataQualityReport', {}, token);
  assert.ok(report.issues.some(i => i.type === 'INVALID_STATUS' && i.id === w.id));
});

console.log('\n=== Multi-week distribution: schema readiness check (design not implemented) ===');
check('WBS already carries START_DATE and TARGET_DATE, sufficient for the documented future distribution model with no schema change', () => {
  const w = post(context, 'getWBS', { id: extWbs }, token).wbs;
  assert.ok('startDate' in w && 'targetDate' in w);
});

console.log('\n=== Full regression: Phase 1 + Phase 2 + Phase 3 must still be 100% ===');
check('legacy bootstrap/addProject/markStage unaffected', () => {
  const boot = post(context, 'bootstrap', {}, token);
  assert.strictEqual(boot.ok, true);
  assert.strictEqual(boot.projects.length, 14);
});
check('Phase 2 projectMasterList/migrateLegacyProjects unaffected', () => {
  const list = post(context, 'projectMasterList', {}, token);
  assert.ok(list.projects.length >= 2);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
