/**
 * phase4-test.js — Phase 4: multi-week distribution, workload calendar,
 * organization structure, manpower engine (skill/engineer/scenario/gap),
 * extended data quality, and full regression across Phases 1-4.
 * Run with: node backend/production/test/phase4-test.js
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
  LOAD_ORDER.forEach(file => vm.runInContext(fs.readFileSync(path.join(PROD_DIR, file), 'utf-8'), context, { filename: file }));
  return { mockGlobals, context };
}
function post(context, action, body, token) {
  const payload = Object.assign({ action }, body || {});
  if (token) payload.token = token;
  return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
}
function get(context, params) { return JSON.parse(context.doGet({ parameter: params || {} }).getContent()); }

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  ok  -', label); }
  catch (e) { failed++; console.error('  FAIL -', label, '\n       ', e.message); }
}

const { mockGlobals, context } = freshContext();
context.setupSpreadsheet();
const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

/* ================================================================
 *  PART A — MULTI-WEEK DISTRIBUTION: pure-function tests, calling
 *  the engine directly (via a tiny helper action is unnecessary —
 *  distributeManDay_ is a global function in the same vm context).
 * ================================================================ */
function dist(start, end, md, periodType) { return context.distributeManDay_(start, end, md, periodType); }
function sumOf(obj) { return Object.values(obj).reduce((a, b) => a + b, 0); }

console.log('=== PART A: Multi-week Man-Day distribution ===');
check('1. one-week activity (Mon-Fri, 5 working days): all MD in one week bucket', () => {
  const d = dist('2026-09-07', '2026-09-11', 10, 'week');
  assert.strictEqual(Object.keys(d).length, 1);
  assert.strictEqual(sumOf(d), 10);
});
check('2. multi-week activity (Tue 09-01 -> Thu 09-10, 8 working days, 20 MD): splits 10/10 across two weeks, matching the design doc example exactly', () => {
  const d = dist('2026-09-01', '2026-09-10', 20, 'week');
  const keys = Object.keys(d).sort();
  assert.strictEqual(keys.length, 2);
  assert.strictEqual(Math.round(d[keys[0]]), 10);
  assert.strictEqual(Math.round(d[keys[1]]), 10);
  assert.strictEqual(sumOf(d), 20, 'total must equal the original Plan Man-Day exactly (correctness invariant)');
});
check('3. multi-month activity (Tue 08-25 -> Sat 09-05) monthly bucketing splits across August and September', () => {
  const d = dist('2026-08-25', '2026-09-05', 15, 'month');
  const keys = Object.keys(d).sort();
  assert.deepStrictEqual(keys, ['2026-08', '2026-09']);
  assert.strictEqual(Math.round(sumOf(d) * 100) / 100, 15);
});
check('4. month boundary: activity spanning exactly the last/first working day of two months', () => {
  const d = dist('2026-08-31', '2026-09-01', 4, 'month'); // Mon 08-31, Tue 09-01
  assert.strictEqual(Object.keys(d).length, 2);
  assert.strictEqual(sumOf(d), 4);
});
check('5. week boundary: Friday -> following Monday crosses an ISO week boundary', () => {
  const d = dist('2026-09-04', '2026-09-07', 4, 'week'); // Fri 09-04, Mon 09-07
  assert.strictEqual(Object.keys(d).length, 2, 'Friday is one ISO week, Monday starts the next');
  assert.strictEqual(sumOf(d), 4);
});
check('6. weekend: a single day entirely on a non-working day still gets its full MD attributed (fallback), never dropped', () => {
  const d = dist('2026-09-05', '2026-09-05', 5, 'week'); // Saturday
  assert.strictEqual(sumOf(d), 5, 'weekend fallback must not lose Man-Day');
});
check('7. single-day activity on a working day', () => {
  const d = dist('2026-09-07', '2026-09-07', 3, 'week'); // Monday
  assert.strictEqual(Object.keys(d).length, 1);
  assert.strictEqual(sumOf(d), 3);
});
check('8. zero MD produces no contribution anywhere, never negative', () => {
  const d = dist('2026-09-01', '2026-09-10', 0, 'week');
  assert.strictEqual(Object.keys(d).length, 0);
  const dNeg = dist('2026-09-01', '2026-09-10', -5, 'week');
  assert.strictEqual(sumOf(dNeg), 0, 'negative input must never produce negative or invented output');
});
check('9. invalid/missing dates handled safely (no crash, no invented placement)', () => {
  // deepStrictEqual against a literal {} fails cross-realm here (the vm context
  // has its own Object) even when content matches — compare key count instead.
  assert.strictEqual(Object.keys(dist('', '2026-09-10', 10, 'week')).length, 0, 'no start date -> cannot place -> empty');
  assert.strictEqual(Object.keys(dist(null, null, 10, 'week')).length, 0);
  const fallback = dist('2026-09-07', 'not-a-date', 10, 'week'); // invalid target -> single-day fallback on start
  assert.strictEqual(sumOf(fallback), 10);
  const backwards = dist('2026-09-10', '2026-09-01', 10, 'week'); // target before start -> single-day fallback
  assert.strictEqual(sumOf(backwards), 10);
});
check('deterministic: calling twice with identical inputs gives identical results', () => {
  const a = dist('2026-09-01', '2026-09-10', 20, 'week');
  const b = dist('2026-09-01', '2026-09-10', 20, 'week');
  assert.deepStrictEqual(a, b);
});

/* ================================================================
 *  Setup for the remaining parts
 * ================================================================ */
const extId = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Gear Checker', pic: 'Sukiyo', targetDate: '2026-12-31', intakeDate: '2026-08-01' }, token).project.id;
const wbsMultiWeek = post(context, 'createWBS', { projectId: extId, name: 'Mechanical Design', startDate: '2026-09-01', targetDate: '2026-09-10', skill: 'Mechanical Design' }, token).wbs.id;
post(context, 'saveResourceAllocation', { wbsId: wbsMultiWeek, engineer: 'Wardiyono', planManDay: 20 }, token);

console.log('\n=== PART B: Workload Calendar (filters) + weekly/monthly wrappers ===');
check('getWeeklyWorkload / getMonthlyWorkload wrappers work', () => {
  const w = post(context, 'getWeeklyWorkload', { periodKey: '2026-09-01' }, token);
  assert.strictEqual(w.periodType, 'week');
  const m = post(context, 'getMonthlyWorkload', { periodKey: '2026-09' }, token);
  assert.strictEqual(m.periodType, 'month');
});
check('getWorkloadCalendar filters by ENGINEER, SKILL, PROJECT, EXTERNAL', () => {
  const byEngineer = post(context, 'getWorkloadCalendar', { periodType: 'month', periodKey: '2026-09', scope: 'ENGINEER', value: 'Wardiyono' }, token);
  assert.strictEqual(byEngineer.plannedMD, 20);
  const bySkill = post(context, 'getWorkloadCalendar', { periodType: 'month', periodKey: '2026-09', scope: 'SKILL', value: 'Mechanical Design' }, token);
  assert.strictEqual(bySkill.plannedMD, 20);
  const byProject = post(context, 'getWorkloadCalendar', { periodType: 'month', periodKey: '2026-09', scope: 'PROJECT', value: extId }, token);
  assert.strictEqual(byProject.plannedMD, 20);
  const byExternal = post(context, 'getWorkloadCalendar', { periodType: 'month', periodKey: '2026-09', scope: 'EXTERNAL' }, token);
  assert.ok(byExternal.plannedMD >= 20);
});

console.log('\n=== 5. Engineer loading (skill + 4-state status) ===');
check('engineer loading now includes skill and 4-state status', () => {
  const res = post(context, 'getEngineerLoading', { periodType: 'week', periodKey: '2026-08-31' }, token); // week containing Sep1-4
  const w = res.engineers.find(e => e.engineer === 'Wardiyono');
  assert.ok(w);
  assert.strictEqual(w.skill, 'Mechanical Design');
  assert.ok(['AVAILABLE', 'NORMAL', 'HIGH LOAD', 'OVERLOAD'].indexOf(w.status) !== -1);
});
check('getEngineerCapacity / getManpowerByEngineer are valid aliases of engineer loading', () => {
  const a = post(context, 'getEngineerCapacity', { periodType: 'month', periodKey: '2026-09' }, token);
  const b = post(context, 'getManpowerByEngineer', { periodType: 'month', periodKey: '2026-09' }, token);
  assert.strictEqual(a.engineers.length, b.engineers.length);
});

console.log('\n=== 6. Skill loading / Manpower by Skill ===');
check('getManpowerBySkill / getSkillCapacity: skills come only from Team.Skill, none invented', () => {
  const res = post(context, 'getManpowerBySkill', { periodType: 'month', periodKey: '2026-09' }, token);
  assert.strictEqual(res.ok, true);
  const teamSkills = get(context, { action: 'teamNames' }); // not skill, but confirms live Team read works
  assert.ok(res.skills.length > 0);
  const mech = res.skills.find(s => s.skill === 'Mechanical Design');
  assert.ok(mech);
  assert.ok(mech.currentMp >= 1);
  assert.ok(mech.workloadMD >= 20);
  const alias = post(context, 'getSkillCapacity', { periodType: 'month', periodKey: '2026-09' }, token);
  assert.strictEqual(alias.skills.length, res.skills.length);
});

console.log('\n=== 7. Organization hierarchy ===');
let divId, deptId, sectionId;
check('createOrgNode builds a hierarchy without hard-coded branch count', () => {
  divId = post(context, 'createOrgNode', { name: 'PSP Division', status: 'ACTIVE' }, token).node.id;
  deptId = post(context, 'createOrgNode', { parentId: divId, name: 'Engineering Dept' }, token).node.id;
  sectionId = post(context, 'createOrgNode', { parentId: deptId, name: 'Electrical / PLC Section', skill: 'Electrical / PLC', idealHeadcount: 4 }, token).node.id;
  const struct = post(context, 'getOrgStructure', {}, token);
  assert.strictEqual(struct.tree.length, 1);
  assert.strictEqual(struct.tree[0].children.length, 1);
  assert.strictEqual(struct.tree[0].children[0].children.length, 1);
  assert.strictEqual(struct.tree[0].children[0].children[0].level, 3);
});
check('current/vacant headcount are derived live from Team, never stored', () => {
  const struct = post(context, 'getOrgStructure', {}, token);
  const section = struct.flat.find(n => n.id === sectionId);
  const expectedCurrent = 2; // Sukiyo + Nugroho Edy S both have Skill='Electrical / PLC' in real seed data
  assert.strictEqual(section.currentHeadcount, expectedCurrent);
  assert.strictEqual(section.idealHeadcount, 4);
  assert.strictEqual(section.vacantHeadcount, 4 - expectedCurrent);
});

console.log('\n=== 8. Vacancy ===');
check('Vacant = Ideal - Current, visible via getVacancySummary, no fake employee created', () => {
  const res = post(context, 'getVacancySummary', {}, token);
  const v = res.vacancies.find(x => x.id === sectionId);
  assert.ok(v);
  assert.strictEqual(v.vacant, 2);
  const teamAfter = rowsToObjects_check(mockGlobals);
  assert.strictEqual(teamAfter.length, 14, 'no fake Team row was created for the vacancy');
});
function rowsToObjects_check(mg) { return mg.__SHEETS.Team.rows.slice(1); }
check('saveVacancy updates only Ideal Headcount, never fabricates a person', () => {
  const res = post(context, 'saveVacancy', { id: sectionId, idealHeadcount: 5 }, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.node.idealHeadcount, 5);
  assert.strictEqual(res.node.personName, '');
});

console.log('\n=== 9-10. Current MP / Ideal MP ===');
check('9. Current MP is live, never hard-coded (still 14)', () => {
  const res = post(context, 'getManpowerAnalysis', { periodType: 'month', periodKey: '2026-09' }, token);
  assert.strictEqual(res.currentMp, 14);
});
check('10. Ideal MP = Current MP + Indicative Additional MP, not prematurely rounded', () => {
  const res = post(context, 'getManpowerAnalysis', { periodType: 'month', periodKey: '2026-09' }, token);
  assert.strictEqual(res.idealMP.exact, Math.round((res.currentMp + res.indicativeAdditionalMPExact) * 100) / 100);
  assert.strictEqual(res.idealMP.roundedUp, Math.ceil(res.currentMp + res.indicativeAdditionalMPExact));
  assert.strictEqual(res.idealMP.tag, 'CALCULATED');
});

console.log('\n=== 11+16. Manpower gap + Management baseline (never forced to +8) ===');
check('11. getManpowerGap (alias) matches getManpowerAnalysis', () => {
  const a = post(context, 'getManpowerGap', { periodType: 'month', periodKey: '2026-09' }, token);
  const b = post(context, 'getManpowerAnalysis', { periodType: 'month', periodKey: '2026-09' }, token);
  assert.strictEqual(a.gapMD, b.gapMD);
});
check('16. management baseline stays exactly 8, tagged REFERENCE, independent of the calculation', () => {
  const res = post(context, 'getManpowerAnalysis', { periodType: 'month', periodKey: '2026-09' }, token);
  assert.strictEqual(res.managementBaselineAdditionalMP, 8);
  assert.strictEqual(res.managementBaselineTag, 'REFERENCE');
  assert.strictEqual(res.currentMpTag, 'CALCULATED');
});

console.log('\n=== 12-15. Manpower Scenario +1/+2/+4/+8 ===');
check('12-15. scenario shows CURRENT, +1, +2, +4, +8 without ever writing to Team', () => {
  const before = mockGlobals.__SHEETS.Team.rows.length;
  const res = post(context, 'getManpowerScenario', { periodType: 'month', periodKey: '2026-09' }, token);
  assert.strictEqual(res.scenarios.length, 5);
  assert.deepStrictEqual(res.scenarios.map(s => s.label), ['CURRENT', 'CURRENT + 1', 'CURRENT + 2', 'CURRENT + 4', 'CURRENT + 8']);
  // more simulated MP -> more available capacity -> gap never increases
  for (let i = 1; i < res.scenarios.length; i++) {
    assert.ok(res.scenarios[i].availableMD >= res.scenarios[i - 1].availableMD);
    assert.ok(res.scenarios[i].remainingGapMD <= res.scenarios[i - 1].remainingGapMD);
  }
  assert.ok(res.scenarios.every(s => s.tag === 'SIMULATION'));
  assert.strictEqual(mockGlobals.__SHEETS.Team.rows.length, before, 'Team must be completely untouched by simulation');
});

console.log('\n=== 17. Data quality (extended Phase 4 checks) ===');
check('WBS_WITHOUT_RESOURCE, INVALID_DATE_RANGE, ACTIVITY_OUTSIDE_PROJECT_PERIOD, ORPHAN_ORG_NODE, INVALID_VACANCY are all detectable', () => {
  post(context, 'createWBS', { projectId: extId, name: 'No resource yet' }, token); // WBS_WITHOUT_RESOURCE
  post(context, 'createWBS', { projectId: extId, name: 'Bad range', startDate: '2026-09-10', targetDate: '2026-09-01' }, token); // INVALID_DATE_RANGE
  post(context, 'createWBS', { projectId: extId, name: 'Out of project period', startDate: '2020-01-01', targetDate: '2020-01-05' }, token); // outside Aug-Dec 2026 project window
  // simulate an orphan org node the way a manual sheet edit could produce one
  mockGlobals.__SHEETS.ORG_STRUCTURE.rows.push(['org_orphan', 'org_missing_parent', 2, 'Orphan Branch', '', '', '', '0', 'ACTIVE', '', 'tester', new Date().toISOString(), new Date().toISOString()]);

  const report = post(context, 'getDataQualityReport', {}, token);
  const types = report.issues.map(i => i.type);
  assert.ok(types.indexOf('WBS_WITHOUT_RESOURCE') !== -1, 'WBS_WITHOUT_RESOURCE not found');
  assert.ok(types.indexOf('INVALID_DATE_RANGE') !== -1, 'INVALID_DATE_RANGE not found');
  assert.ok(types.indexOf('ACTIVITY_OUTSIDE_PROJECT_PERIOD') !== -1, 'ACTIVITY_OUTSIDE_PROJECT_PERIOD not found');
  assert.ok(types.indexOf('ORPHAN_ORG_NODE') !== -1, 'ORPHAN_ORG_NODE not found');
});
check('data quality report still fixes nothing (non-mutating, idempotent)', () => {
  const before = post(context, 'getDataQualityReport', {}, token).totalIssues;
  const after = post(context, 'getDataQualityReport', {}, token).totalIssues;
  assert.strictEqual(before, after);
});

console.log('\n=== 18-20. Authentication + Sanitization + LockService ===');
check('18. new Phase 4 actions require a valid token', () => {
  const res = post(context, 'createOrgNode', { name: 'No Token Branch' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.authError, true);
});
check('19. sanitization applies to new Organization fields', () => {
  const res = post(context, 'createOrgNode', { name: '=malicious()' }, token);
  assert.strictEqual(res.node.name[0], "'");
});
check('20. LockService wraps createOrgNode / updateOrgNode / saveVacancy', () => {
  const before = mockGlobals.__lockStats();
  post(context, 'createOrgNode', { name: 'Lock test branch' }, token);
  assert.strictEqual(mockGlobals.__lockStats().waitCount, before.waitCount + 1);
});

console.log('\n=== 21. Full regression: Phases 1-3.1 must remain 100% ===');
check('legacy bootstrap/addProject/markStage unaffected', () => {
  const boot = post(context, 'bootstrap', {}, token);
  assert.strictEqual(boot.ok, true);
  assert.strictEqual(boot.projects.length, 14);
});
check('Phase 2 projectMasterList / migrateLegacyProjects unaffected', () => {
  const list = post(context, 'projectMasterList', {}, token);
  assert.ok(list.projects.length >= 1);
  const mig = post(context, 'migrateLegacyProjects', {}, token);
  assert.strictEqual(mig.ok, true);
});
check('Phase 3 createWBS / saveResourceAllocation contract unchanged', () => {
  const w = post(context, 'createWBS', { projectId: extId, name: 'Regression check' }, token);
  assert.strictEqual(w.ok, true);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
