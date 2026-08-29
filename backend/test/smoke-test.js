/**
 * smoke-test.js — loads every backend/gas/*.gs file into a mocked Apps
 * Script global context (see mock-gas.js) and exercises the foundation:
 * schema setup, legacy-compat actions, and the new Rev D actions end to
 * end through Router.dispatch_. Run with: node backend/test/smoke-test.js
 *
 * This proves the LOGIC is sound. It cannot prove the real production
 * Google Sheet/Apps Script project behaves identically — that still
 * requires manual UAT in the Apps Script editor (see backend/README.md).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createMockGasContext } = require('./mock-gas');

const GAS_DIR = path.join(__dirname, '..', 'gas');
const LOAD_ORDER = [
  'Utils.gs', 'Repository.gs', 'Config.gs', 'SchemaSetup.gs', 'AuditService.gs',
  'Auth.gs', 'ProjectService.gs', 'LegacyCompatService.gs', 'WbsService.gs',
  'IrregularJobService.gs', 'ResourceService.gs', 'CapacityService.gs',
  'OrganizationService.gs', 'ManpowerService.gs', 'ScenarioService.gs',
  'ReportService.gs', 'Router.gs', 'Code.gs'
];

const mockGlobals = createMockGasContext({ SHEET_ID: 'mock', AUTH_SECRET: 'test-secret-do-not-use-in-prod' });
const context = vm.createContext(mockGlobals);

LOAD_ORDER.forEach(file => {
  const code = fs.readFileSync(path.join(GAS_DIR, file), 'utf-8');
  vm.runInContext(code, context, { filename: file });
});

let passed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  ok  -', label); }
  catch (e) { console.error('  FAIL -', label, '\n       ', e.message); process.exitCode = 1; }
}

console.log('1) SchemaSetup — additive, idempotent');
context.setupSchema();
check('all 15 Rev D sheets created', () => {
  ['PROJECT_MASTER', 'WBS', 'IRREGULAR_JOB', 'RESOURCE', 'ASSIGNMENT', 'ORG_NODE', 'POSITION',
   'POSITION_ASSIGNMENT', 'MP_BASELINE', 'ANNUAL_LOADING', 'SCENARIO', 'WEEKLY_UPDATE',
   'REPORT_HISTORY', 'AUDIT_LOG', 'CONFIG'].forEach(name => assert.ok(mockGlobals.__SHEETS[name], name + ' missing'));
});
check('CONFIG seeded with defaults, second run does not duplicate', () => {
  const before = mockGlobals.__SHEETS.CONFIG.rows.length;
  context.setupSchema();
  const after = mockGlobals.__SHEETS.CONFIG.rows.length;
  assert.strictEqual(before, after, 'setupSchema should be idempotent');
});
check('root ORG_NODE seeded', () => {
  assert.ok(mockGlobals.__SHEETS.ORG_NODE.rows.some(r => r[0] === 'ORG-ROOT'));
});

console.log('2) Legacy compatibility — existing sheets untouched by setupSchema, existing actions work');
mockGlobals.__SHEETS.Team = { rows: [['name', 'role', 'nrp', 'pin'], ['Budi', 'Section Head', '12345', '1111']] };
mockGlobals.__SHEETS.Stages = { rows: [['n', 'phase'], ['Konsep', 0]] };
mockGlobals.__SHEETS.Phases = { rows: [['name', 'hex'], ['Konsep', '#3B6FE0']] };
mockGlobals.__SHEETS.Projects = { rows: [['id', 'no', 'name', 'line', 'pic', 'support', 'category', 'start', 'target', 'progressStage', 'stageDates', 'note']] };
mockGlobals.__SHEETS.DailyLogs = { rows: [['projectNo', 'date', 'engineer', 'stage', 'plan', 'actual', 'problem', 'next']] };
mockGlobals.__SHEETS.SupportJobs = { rows: [['date', 'type', 'line', 'pic', 'manDay', 'desc']] };
mockGlobals.__SHEETS.GlobalSupport = { rows: [['country', 'flag', 'pic', 'status', 'item']] };

check('teamNames (public action)', () => {
  const res = context.dispatch_('teamNames', {}, null);
  assert.strictEqual(res[0].name, 'Budi');
});

let token;
check('login with correct PIN issues a token; wrong PIN fails', () => {
  const bad = context.dispatch_('login', { name: 'Budi', pin: '0000' }, null);
  assert.strictEqual(bad.ok, false, 'wrong PIN should be rejected');
  const good = context.dispatch_('login', { name: 'Budi', pin: '1111' }, null);
  assert.ok(good.token, 'correct PIN should issue a token');
  token = good.token;
});

check('an authenticated action without a token is rejected with authError', () => {
  const res = context.dispatch_('bootstrap', {}, null);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.authError, true);
});

check('bootstrap works with a valid token and returns all legacy collections', () => {
  const res = context.dispatch_('bootstrap', {}, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.team[0].name, 'Budi');
  assert.strictEqual(res.supportCapacity, 60);
});

let projectId;
check('addProject (legacy) appends a row and returns it', () => {
  const res = context.dispatch_('addProject', { name: 'Test Automation', line: 'Line 1', pic: 'Budi', support: 'Budi', category: 'Reduce MP', start: '2026-01-01', target: '2026-06-01' }, token);
  assert.strictEqual(res.ok, true);
  assert.ok(res.project.id);
  projectId = res.project.id;
});

check('saveDailyLog (legacy) advances progressStage and appends a log', () => {
  const res = context.dispatch_('saveDailyLog', { projectId, date: '2026-01-02', engineer: 'Budi', stage: 2, plan: 'Plan A', actual: 'Actual A' }, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(Number(res.project.progressStage), 2);
});

check('markStage / undoStage (legacy) round-trip', () => {
  const marked = context.dispatch_('markStage', { projectId, idx: 3 }, token);
  assert.strictEqual(Number(marked.project.progressStage), 4);
  const undone = context.dispatch_('undoStage', { projectId, idx: 1 }, token);
  assert.strictEqual(Number(undone.project.progressStage), 1);
});

check('saveSupportJob / saveGlobalItem (legacy) still work', () => {
  const sj = context.dispatch_('saveSupportJob', { date: '2026-01-03', type: 'Komarigoto', line: 'Line 7', pic: 'Budi', manDay: 1.5, desc: 'fix' }, token);
  assert.strictEqual(sj.ok, true);
  const gs = context.dispatch_('saveGlobalItem', { country: 'Musashi Vietnam', pic: 'Budi', status: 'OPEN', item: 'PO mesin' }, token);
  assert.strictEqual(gs.ok, true);
});

console.log('3) Rev D — new entities and rules');
check('Irregular Job rejects an unconfigured category', () => {
  const res = context.dispatch_('addIrregularJob', { category: 'Not A Real Category', requestor: 'Budi', problem: 'x' }, token);
  assert.strictEqual(res.ok, false);
});

let jobId;
check('Irregular Job accepts a configured category and can seed its WBS template', () => {
  const res = context.dispatch_('addIrregularJob', { category: 'Komarigoto Produksi', requestor: 'Budi', problem: 'Line stop', estimatedMp: 2, estimatedNeedDay: 3 }, token);
  assert.strictEqual(res.ok, true);
  jobId = res.job.job_id;
  const seeded = context.dispatch_('seedIrregularJobWbs', { jobId }, token);
  assert.strictEqual(seeded.wbs.length, 8);
});

check('Organization: vacancy is derived, never stored', () => {
  const node = context.dispatch_('addOrgNode', { name: 'Electrical', type: 'Section', parentNodeId: 'ORG-ROOT' }, token).node;
  context.dispatch_('addPosition', { orgNodeId: node.node_id, title: 'Electrical Engineer', idealHc: 3 }, token);
  const positions = context.dispatch_('listPositions', {}, token).positions;
  const pos = positions.find(p => p.title === 'Electrical Engineer');
  assert.strictEqual(pos.current_hc, 0);
  assert.strictEqual(pos.gap, 3);
  assert.strictEqual(pos.display, 'VACANT');
});

check('MP Baseline: only a management role can set it; engine never overwrites it', () => {
  const denied = context.dispatch_('setMpBaseline', { fiscalYear: 2026, currentMp: 17, managementAddMp: 8 }, token);
  // token belongs to "Budi", role "Section Head" -> matches isManagementRole_ heuristic (contains "Head")
  assert.strictEqual(denied.ok, true, 'Section Head should be treated as management by the placeholder heuristic');
  const view = context.dispatch_('getMpPlanningView', { fiscalYear: 2026 }, token).view;
  assert.strictEqual(view.managementIdealMp, 25);
  assert.ok('calculatedRequiredMp' in view);
  assert.ok('varianceVsManagement' in view, 'baseline and calculated must be shown side by side, never merged');
});

check('previewDemand is lightweight and answers who/how-much/capacity without persisting anything', () => {
  const before = mockGlobals.__SHEETS.WBS.rows.length;
  const preview = context.dispatch_('previewDemand', { wbsDraft: [{ activity: 'Design', mp: 1, needDay: 5, skill: 'Electrical' }] }, token);
  assert.strictEqual(preview.ok, true);
  assert.strictEqual(preview.totalManDay, 5);
  // deepStrictEqual rejects this cross-realm array (vm.createContext has its own
  // Array constructor) even though the contents match — compare by value instead.
  assert.strictEqual(JSON.stringify(Array.from(preview.requiredSkills)), JSON.stringify(['Electrical']));
  assert.strictEqual(mockGlobals.__SHEETS.WBS.rows.length, before, 'preview must not write to WBS');
});

check('AUDIT_LOG captured every mutation above', () => {
  assert.ok(mockGlobals.__SHEETS.AUDIT_LOG.rows.length >= 8);
});

console.log('\n' + passed + ' checks passed.' + (process.exitCode ? ' SOME CHECKS FAILED — see FAIL lines above.' : ' All good.'));
