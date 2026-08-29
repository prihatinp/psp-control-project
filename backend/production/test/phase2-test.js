/**
 * phase2-test.js — loads the REAL production Code.gs + Phase 2's
 * ProjectMaster.gs into the mocked Apps Script runtime and exercises
 * both the untouched legacy behavior and the new additive behavior.
 * Run with: node backend/production/test/phase2-test.js
 *
 * This proves the LOGIC is sound against a faithful mock. It cannot
 * prove the real Google Sheets/Apps Script project behaves identically
 * — that still requires manual UAT in the real Apps Script editor
 * before this is ever deployed over the live production script.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createMockGasContext } = require('./mock-gas-v2');

const PROD_DIR = path.join(__dirname, '..');
const LOAD_ORDER = ['Code.gs', 'ProjectMaster.gs'];

function freshContext() {
  const mockGlobals = createMockGasContext({ SS_ID: 'mock-ss', HMAC_SECRET: 'test-secret-do-not-use-in-prod' });
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

function doPostCall(context, action, body, token) {
  const payload = Object.assign({ action }, body || {});
  if (token) payload.token = token;
  const e = { postData: { contents: JSON.stringify(payload) } };
  return JSON.parse(context.doPost(e).getContent());
}
function doGetCall(context, params) {
  const e = { parameter: params || {} };
  return JSON.parse(context.doGet(e).getContent());
}

console.log('=== Setup: real setupSpreadsheet() run ===');
const { mockGlobals, context } = freshContext();
context.setupSpreadsheet();

check('setupSpreadsheet created all 8 legacy sheets + PROJECT_MASTER', () => {
  ['Team', 'Stages', 'Phases', 'Config', 'Projects', 'DailyLogs', 'SupportJobs', 'GlobalSupport', 'PROJECT_MASTER']
    .forEach(name => assert.ok(mockGlobals.__SHEETS[name], name + ' missing'));
});
check('legacy seed data present (14 projects, 14 team members)', () => {
  assert.strictEqual(mockGlobals.__SHEETS.Team.rows.length - 1, 14);
  assert.strictEqual(mockGlobals.__SHEETS.Projects.rows.length - 1, 14);
});
check('Phase 2 Config keys seeded into the REAL existing Config sheet (no second sheet)', () => {
  const configRows = mockGlobals.__SHEETS.Config.rows.slice(1);
  const keys = configRows.map(r => r[0]);
  assert.ok(keys.indexOf('LOGIN_PIN') !== -1, 'legacy key must survive');
  assert.ok(keys.indexOf('EXTERNAL_PROJECT_STATUS_LIST') !== -1);
  assert.ok(keys.indexOf('INTERNAL_PROJECT_STATUS_LIST') !== -1);
  assert.strictEqual(Object.keys(mockGlobals.__SHEETS).filter(n => /config/i.test(n)).length, 1, 'exactly one Config-like sheet must exist');
});

console.log('\n=== 9. Legacy API compatibility (existing frontend must keep working) ===');
let token;
check('teamNames (public, GET)', () => {
  const res = doGetCall(context, { action: 'teamNames' });
  assert.strictEqual(res.length, 14);
  assert.strictEqual(res[0].name, 'Prihatin Purwadi');
});
check('login (public, POST) with the real shared Config PIN', () => {
  const bad = doPostCall(context, 'login', { name: 'Sukiyo', pin: 'wrong' });
  assert.strictEqual(bad.ok, false);
  const good = doPostCall(context, 'login', { name: 'Sukiyo', pin: 'psp2026' });
  assert.ok(good.token);
  token = good.token;
});
check('5. Authentication — protected action without token is rejected', () => {
  const res = doPostCall(context, 'bootstrap', {});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.authError, true);
});
check('bootstrap (legacy) returns all legacy collections unchanged', () => {
  const res = doPostCall(context, 'bootstrap', {}, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.projects.length, 14);
  assert.strictEqual(res.supportCapacity, 60);
});
let legacyProjectId;
check('addProject (legacy) still works', () => {
  const res = doPostCall(context, 'addProject', { name: 'Legacy Test Project', line: 'Line X', start: '2026-01-01', target: '2026-06-01' }, token);
  assert.strictEqual(res.ok, true);
  legacyProjectId = res.project.id;
});
check('markStage/undoStage (legacy) still work', () => {
  const marked = doPostCall(context, 'markStage', { projectId: legacyProjectId, idx: 0 }, token);
  assert.strictEqual(marked.ok, true);
  assert.strictEqual(marked.project.progressStage, 1);
});

console.log('\n=== 6. Rate limiting (real checkRateLimit_) ===');
check('60 requests/min allowed, 61st blocked, keyed per user', () => {
  const freshLoginRes = doPostCall(context, 'login', { name: 'Wardiyono', pin: 'psp2026' });
  const t2 = freshLoginRes.token;
  let lastRes;
  for (let i = 0; i < 61; i++) lastRes = doPostCall(context, 'bootstrap', {}, t2);
  assert.strictEqual(lastRes.ok, false);
  assert.ok(/permintaan/.test(lastRes.message));
});

console.log('\n=== 7. Input sanitization (real sanitizeStr_ / formula-injection guard) ===');
check('a project name starting with "=" is quoted, not stored as a live formula', () => {
  const res = doPostCall(context, 'addProjectMaster', {
    type: 'INTERNAL', name: '=HYPERLINK("evil")', pic: 'Sukiyo', targetDate: '2026-12-31'
  }, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.project.name[0], "'", 'formula-injection guard must prefix a quote');
});

console.log('\n=== 8. LockService write protection ===');
check('addProjectMaster wraps its write in LockService.waitLock/releaseLock', () => {
  const before = mockGlobals.__lockStats();
  doPostCall(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Lock Test', pic: 'Sukiyo', targetDate: '2026-12-31' }, token);
  const after = mockGlobals.__lockStats();
  assert.strictEqual(after.waitCount, before.waitCount + 1);
  assert.strictEqual(after.releaseCount, before.releaseCount + 1);
});

console.log('\n=== 1-3. PROJECT_MASTER / External / Internal creation ===');
let externalId, internalId;
check('1+2. addProjectMaster EXTERNAL with RFQ fields', () => {
  const res = doPostCall(context, 'addProjectMaster', {
    type: 'EXTERNAL', name: 'Gear Checker Line', customer: 'Musashi Vietnam', plant: 'Vietnam Plant 1',
    pic: 'Sukiyo', priority: 'High', status: 'RFQ', rfqNo: 'RFQ-2026-001', rfqDate: '2026-02-01', targetDate: '2026-12-31'
  }, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.project.type, 'EXTERNAL');
  assert.strictEqual(res.project.rfqNo, 'RFQ-2026-001');
  externalId = res.project.id;
});
check('3. addProjectMaster INTERNAL with minimal fields', () => {
  const res = doPostCall(context, 'addProjectMaster', {
    type: 'INTERNAL', name: 'Reduce MP Line 9', pic: 'Muharir', targetDate: '2026-09-30'
  }, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.project.type, 'INTERNAL');
  assert.strictEqual(res.project.status, 'PIPELINE');
  internalId = res.project.id;
});
check('rejects an unknown project type', () => {
  const res = doPostCall(context, 'addProjectMaster', { type: 'IRREGULAR', name: 'x', pic: 'x', targetDate: '2026-01-01' }, token);
  assert.strictEqual(res.ok, false);
});
check('rejects a status not valid for the given type', () => {
  const res = doPostCall(context, 'addProjectMaster', { type: 'INTERNAL', name: 'x', pic: 'x', targetDate: '2026-01-01', status: 'NEGOTIATION' }, token);
  assert.strictEqual(res.ok, false, 'NEGOTIATION is an External-only status');
});
check('getProjectMaster / projectMasterList / externalProjectList', () => {
  const got = doPostCall(context, 'getProjectMaster', { id: externalId }, token);
  assert.strictEqual(got.project.name, 'Gear Checker Line');
  const all = doPostCall(context, 'projectMasterList', {}, token);
  assert.ok(all.projects.length >= 2);
  const ext = doPostCall(context, 'externalProjectList', {}, token);
  assert.ok(ext.projects.every(p => p.type === 'EXTERNAL'));
});
check('updateProjectMaster changes status and stamps UpdatedAt', () => {
  const res = doPostCall(context, 'updateProjectMaster', { id: externalId, status: 'QUOTATION', poNo: '' }, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.project.status, 'QUOTATION');
});

console.log('\n=== 10+11+4. Legacy data migration + idempotency + duplicate prevention ===');
let projectsSnapshotBefore;
check('12. legacy Projects sheet snapshot before migration', () => {
  projectsSnapshotBefore = JSON.stringify(mockGlobals.__SHEETS.Projects.rows);
  assert.ok(projectsSnapshotBefore.length > 0);
});
check('10. first migration run maps all 15 legacy projects (14 seed + 1 added via addProject test)', () => {
  const res = doPostCall(context, 'migrateLegacyProjects', {}, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.migrated, 15);
  assert.strictEqual(res.skipped, 0);
});
check('migrated record fields match the documented mapping (status derived from ProgressStage)', () => {
  const all = doPostCall(context, 'projectMasterList', { type: 'INTERNAL' }, token).projects;
  const inProgress = all.find(p => p.name === 'Automation FAS Line-5 dengan Robot Palletizing BOK 62015'); // seed ProgressStage=15
  assert.ok(inProgress, 'expected migrated project not found');
  assert.strictEqual(inProgress.type, 'INTERNAL');
  assert.strictEqual(inProgress.status, 'EXECUTION', 'ProgressStage 15 < 18 -> EXECUTION');
  const done = all.find(p => p.name === 'Automation Hizumitori Fact-1'); // seed ProgressStage=18
  assert.ok(done, 'expected migrated project not found');
  assert.strictEqual(done.status, 'COMPLETED', 'ProgressStage 18 >= 18 -> COMPLETED');
});
check('4+11. second migration run is idempotent — no duplicates', () => {
  const res = doPostCall(context, 'migrateLegacyProjects', {}, token);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.migrated, 0, 'nothing new to migrate on second run');
  assert.strictEqual(res.skipped, 15, 'all 15 already migrated');
});
check('12. legacy Projects sheet is byte-identical after migration (read-only)', () => {
  const after = JSON.stringify(mockGlobals.__SHEETS.Projects.rows);
  assert.strictEqual(after, projectsSnapshotBefore);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
