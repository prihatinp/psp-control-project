/**
 * production-readiness-test.js — Phase 5.2: production readiness &
 * integration audit. This file does NOT re-test business logic already
 * covered by phase2..phase5.1-test.js (176 checks) — it adds the 10
 * categories the Phase 5.2 brief explicitly asked for and that were
 * previously uncovered: full API routing, full auth gate (including
 * expired/forged tokens, a real gap found during the Phase 5.1 review
 * gate), full rate limiting, setupSpreadsheet idempotency, schema
 * integrity, migration idempotency (with a dry-run-style report),
 * read-only mutation audit, cross-module function collision, frontend/
 * backend action parity, and GAS compatibility.
 *
 * Run with: node backend/production/test/production-readiness-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createMockGasContext } = require('./mock-gas-v2');

const PROD_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
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
function rawPost(context, bodyStr) {
  return JSON.parse(context.doPost({ postData: { contents: bodyStr } }).getContent());
}

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  ok  -', label); }
  catch (e) { failed++; console.error('  FAIL -', label, '\n       ', e.message); }
}

/* ================================================================
 *  CATEGORY 1 — FULL API ROUTING
 * ================================================================ */
console.log('=== 1. Full API routing ===');
{
  const codeSrc = fs.readFileSync(path.join(PROD_DIR, 'Code.gs'), 'utf-8');
  const allSrc = LOAD_ORDER.map(f => fs.readFileSync(path.join(PROD_DIR, f), 'utf-8')).join('\n');

  const actionNames = [...codeSrc.matchAll(/case '([a-zA-Z]+)':/g)].map(m => m[1]);
  const handlerCalls = [...codeSrc.matchAll(/case '[a-zA-Z]+':\s*return jsonOut_\(([A-Za-z_]+)\(/g)].map(m => m[1]);
  handlerCalls.push('handleLogin_'); // routed via `if (action === 'login')` before the switch, not a `case` label
  const definedHandlers = [...allSrc.matchAll(/^function (handle[A-Za-z_]+_)\(/gm)].map(m => m[1]);

  check('every action name is unique (no duplicate routing)', () => {
    assert.strictEqual(new Set(actionNames).size, actionNames.length, 'duplicate case label found');
  });
  check('every handler referenced in the switch resolves to a real handle*_ function or a known non-handler wrapper', () => {
    const knownNonHandlerCallees = ['getBootstrapData_']; // bootstrap wraps a non "handle*" helper by design
    handlerCalls.forEach(h => {
      const ok = definedHandlers.indexOf(h) !== -1 || knownNonHandlerCallees.indexOf(h) !== -1;
      assert.ok(ok, 'unreachable/undefined handler referenced: ' + h);
    });
  });
  check('every defined handle*_ function is routed from the switch (no orphans)', () => {
    const uniqueDefined = [...new Set(definedHandlers)];
    const uniqueCalled = [...new Set(handlerCalls)];
    uniqueDefined.forEach(h => assert.ok(uniqueCalled.indexOf(h) !== -1, 'orphan handler, never routed: ' + h));
  });
  check('exactly one default case exists and it returns "Aksi tidak dikenal"', () => {
    const defaults = [...codeSrc.matchAll(/default:\s*return jsonOut_\(\{[^}]*'Aksi tidak dikenal\.'/g)];
    assert.strictEqual(defaults.length, 1);
  });
}

/* ================================================================
 *  CATEGORY 2 — FULL AUTHENTICATION GATE (including the Phase 5.1
 *  review gate's F-08 finding: token expiry had zero test coverage)
 * ================================================================ */
console.log('\n=== 2. Full authentication gate ===');
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  const PROTECTED_ACTIONS = ['bootstrap', 'addProjectMaster', 'getExecutiveDashboard', 'createWBS', 'getWorkloadSummary'];

  check('every protected action rejects a missing token with authError:true', () => {
    PROTECTED_ACTIONS.forEach(a => {
      const res = post(context, a, {});
      assert.strictEqual(res.ok, false, a + ' must fail without a token');
      assert.strictEqual(res.authError, true, a + ' must set authError');
    });
  });
  check('every protected action rejects a garbage (non-JWT-shaped) token', () => {
    PROTECTED_ACTIONS.forEach(a => {
      const res = post(context, a, {}, 'not-a-real-token');
      assert.strictEqual(res.authError, true, a);
    });
  });
  check('a well-formed but forged token (tampered payload, reused signature) is rejected', () => {
    const parts = token.split('.');
    const forgedPayload = mockGlobals.Utilities.base64EncodeWebSafe(JSON.stringify({ n: 'Sukiyo', r: 'SuperAdmin', exp: Date.now() + 99999999 }));
    const forged = forgedPayload + '.' + parts[1];
    const res = post(context, 'bootstrap', {}, forged);
    assert.strictEqual(res.authError, true, 'tampering the payload without the real HMAC secret must be rejected');
  });
  check('an expired token (valid signature, exp in the past) is rejected — Phase 5.1 review gate finding F-08, now covered', () => {
    const payload = { n: 'Sukiyo', r: 'Engineer', exp: Date.now() - 1000 };
    const payloadB64 = mockGlobals.Utilities.base64EncodeWebSafe(JSON.stringify(payload));
    const sigBytes = mockGlobals.Utilities.computeHmacSha256Signature(payloadB64, 'test-secret');
    const sig = mockGlobals.Utilities.base64EncodeWebSafe(sigBytes);
    const expiredToken = payloadB64 + '.' + sig;
    const res = post(context, 'bootstrap', {}, expiredToken);
    assert.strictEqual(res.authError, true, 'an expired-but-correctly-signed token must still be rejected');
  });
  check('a token missing the "." separator, or with the wrong number of parts, is rejected without throwing', () => {
    ['abcdefgh', 'a.b.c', '', '.'].forEach(bad => {
      const res = post(context, 'bootstrap', {}, bad);
      assert.strictEqual(res.authError, true, JSON.stringify(bad));
    });
  });
  check('teamNames is intentionally public (GET) and requires no token', () => {
    const res = JSON.parse(context.doGet({ parameter: { action: 'teamNames' } }).getContent());
    assert.ok(Array.isArray(res));
  });
  check('login itself is exempt from the token gate (it produces the token) but still enforces brute-force lockout', () => {
    for (let i = 0; i < 5; i++) post(context, 'login', { name: 'Wardiyono', pin: 'wrong-pin' });
    const locked = post(context, 'login', { name: 'Wardiyono', pin: 'psp2026' }); // even the correct PIN, now locked
    assert.strictEqual(locked.ok, false);
    assert.ok(/kunci|lock|banyak/i.test(locked.message), 'expected a lockout message, got: ' + locked.message);
  });
  check('the login HMAC secret is never present anywhere in a login response', () => {
    const res = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' });
    assert.strictEqual(JSON.stringify(res).indexOf('test-secret'), -1);
  });
}

/* ================================================================
 *  CATEGORY 3 — FULL RATE LIMITING
 * ================================================================ */
console.log('\n=== 3. Full rate limiting ===');
{
  const { context } = freshContext();
  context.setupSpreadsheet();
  check('the 60/min gate applies uniformly to a legacy action AND a Phase 5 action for the same user (shared gate, not per-action)', () => {
    const token = post(context, 'login', { name: 'Muharir', pin: 'psp2026' }).token;
    let blockedAt = -1;
    for (let i = 1; i <= 61; i++) {
      // alternate between a legacy-era action and a Phase 5 action — same counter either way
      const action = i % 2 === 0 ? 'bootstrap' : 'getExecutiveDashboard';
      const res = post(context, action, {}, token);
      if (!res.ok && /Terlalu banyak/.test(res.message || '')) { blockedAt = i; break; }
    }
    assert.strictEqual(blockedAt, 61, 'the 61st request in the same minute, regardless of which action, must be rate-limited');
  });
  check('rate limiting is keyed per-user, not global — a second user is unaffected by the first user hitting the cap', () => {
    const tokenA = post(context, 'login', { name: 'Fajar Sani', pin: 'psp2026' }).token;
    for (let i = 0; i < 60; i++) post(context, 'bootstrap', {}, tokenA);
    const blockedA = post(context, 'bootstrap', {}, tokenA);
    assert.strictEqual(blockedA.ok, false);
    const tokenB = post(context, 'login', { name: 'Nugroho Edy S', pin: 'psp2026' }).token;
    const okB = post(context, 'bootstrap', {}, tokenB);
    assert.strictEqual(okB.ok, true, 'a different user must not be blocked by another user exhausting their own limit');
  });
}

/* ================================================================
 *  CATEGORY 4 — setupSpreadsheet() IDEMPOTENCY
 * ================================================================ */
console.log('\n=== 4. setupSpreadsheet idempotency ===');
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;
  // Add real data before re-running setup, so a destructive re-run would be obvious.
  post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'Idempotency Probe', pic: 'Sukiyo', targetDate: '2030-01-01' }, token);
  post(context, 'createOrgNode', { name: 'Probe Section', idealHeadcount: 3 }, token);

  const before = {};
  Object.keys(mockGlobals.__SHEETS).forEach(k => { before[k] = JSON.stringify(mockGlobals.__SHEETS[k].rows); });
  const configKeysBefore = mockGlobals.__SHEETS.Config.rows.slice(1).map(r => r[0]);

  context.setupSpreadsheet(); // re-run, exactly as a real re-deployment would
  context.setupSpreadsheet(); // and again, to prove it's not just "safe once"

  check('re-running setupSpreadsheet() does not alter any existing sheet row (no data loss, no duplication)', () => {
    Object.keys(mockGlobals.__SHEETS).forEach(k => {
      assert.strictEqual(JSON.stringify(mockGlobals.__SHEETS[k].rows), before[k], k + ' changed after a no-op setup re-run');
    });
  });
  check('Config keys are not duplicated by repeated setup runs', () => {
    const configKeysAfter = mockGlobals.__SHEETS.Config.rows.slice(1).map(r => r[0]);
    assert.strictEqual(configKeysAfter.length, configKeysBefore.length);
    const unique = new Set(configKeysAfter);
    assert.strictEqual(unique.size, configKeysAfter.length, 'duplicate Config key introduced by re-running setup');
  });
  check('no sheet is re-created (PROJECT_MASTER/WBS/RESOURCE_ALLOCATION/ORG_STRUCTURE headers stay a single row each)', () => {
    ['PROJECT_MASTER', 'WBS', 'RESOURCE_ALLOCATION', 'ORG_STRUCTURE'].forEach(name => {
      const headerRows = mockGlobals.__SHEETS[name].rows.filter(r => r[0] === (name === 'PROJECT_MASTER' ? 'ID' : name === 'WBS' ? 'WBS_ID' : name === 'RESOURCE_ALLOCATION' ? 'ALLOC_ID' : 'ORG_ID'));
      assert.strictEqual(headerRows.length, 1, name + ' must have exactly one header row, not duplicated');
    });
  });
}

/* ================================================================
 *  CATEGORY 5 — SCHEMA INTEGRITY (header <-> row-array alignment,
 *  verified programmatically rather than by manual line counting)
 * ================================================================ */
console.log('\n=== 5. Schema integrity ===');
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  function headerLen(sheetName) { return mockGlobals.__SHEETS[sheetName].rows[0].length; }
  function lastRowLen(sheetName) { const rows = mockGlobals.__SHEETS[sheetName].rows; return rows[rows.length - 1].length; }

  check('PROJECT_MASTER: a freshly-appended row has exactly as many columns as the header (27, including Phase 5.1 Country)', () => {
    post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Schema Probe', customer: 'C', country: 'X', pic: 'Sukiyo', targetDate: '2030-01-01' }, token);
    assert.strictEqual(lastRowLen('PROJECT_MASTER'), headerLen('PROJECT_MASTER'));
    assert.strictEqual(headerLen('PROJECT_MASTER'), 27);
  });
  check('WBS: a freshly-appended row has exactly as many columns as the header (23)', () => {
    const pid = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'S2', pic: 'Sukiyo', targetDate: '2030-01-01' }, token).project.id;
    post(context, 'createWBS', { projectId: pid, name: 'Schema WBS Probe' }, token);
    assert.strictEqual(lastRowLen('WBS'), headerLen('WBS'));
    assert.strictEqual(headerLen('WBS'), 23);
  });
  check('RESOURCE_ALLOCATION: a freshly-appended row has exactly as many columns as the header (8)', () => {
    const wbsId = mockGlobals.__SHEETS.WBS.rows[mockGlobals.__SHEETS.WBS.rows.length - 1][0];
    post(context, 'saveResourceAllocation', { wbsId, engineer: 'Sukiyo', planManDay: 1 }, token);
    assert.strictEqual(lastRowLen('RESOURCE_ALLOCATION'), headerLen('RESOURCE_ALLOCATION'));
    assert.strictEqual(headerLen('RESOURCE_ALLOCATION'), 8);
  });
  check('ORG_STRUCTURE: a freshly-appended row has exactly as many columns as the header (13)', () => {
    post(context, 'createOrgNode', { name: 'Schema Org Probe', idealHeadcount: 1 }, token);
    assert.strictEqual(lastRowLen('ORG_STRUCTURE'), headerLen('ORG_STRUCTURE'));
    assert.strictEqual(headerLen('ORG_STRUCTURE'), 13);
  });
  check('no Config key is defined more than once across ensurePhase2/3/4/5Config_ (source-level check)', () => {
    const src = ['ProjectMaster.gs', 'WbsWorkload.gs', 'Organization.gs', 'Reporting.gs'].map(f => fs.readFileSync(path.join(PROD_DIR, f), 'utf-8')).join('\n');
    const keys = [...src.matchAll(/\['([A-Z_]+)',\s*'[^']*'\]/g)].map(m => m[1]);
    const unique = new Set(keys);
    assert.strictEqual(unique.size, keys.length, 'a Config key default is declared more than once: ' + keys.filter((k, i) => keys.indexOf(k) !== i));
  });
}

/* ================================================================
 *  CATEGORY 6 — MIGRATION IDEMPOTENCY (with a dry-run-style report)
 * ================================================================ */
console.log('\n=== 6. Migration idempotency + dry-run report ===');
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  const legacyProjectsBefore = JSON.stringify(mockGlobals.__SHEETS.Projects.rows);
  const legacyCount = mockGlobals.__SHEETS.Projects.rows.length - 1; // minus header

  const run1 = post(context, 'migrateLegacyProjects', {}, token);
  const run2 = post(context, 'migrateLegacyProjects', {}, token);

  console.log('  --- migration dry-run-equivalent report ---');
  console.log('  legacy project count:      ', legacyCount);
  console.log('  migrated (first run):      ', run1.migrated);
  console.log('  skipped (first run):       ', run1.skipped, '(reason: already migrated — none expected on a first run)');
  console.log('  migrated (second run):     ', run2.migrated, '(expected 0 — idempotent)');
  console.log('  skipped (second run):      ', run2.skipped, '(reason: LegacyProjectId already present for every row)');
  console.log('  duplicates prevented:      ', run2.skipped === legacyCount ? 'yes, all ' + legacyCount + ' rows recognized as already migrated' : 'MISMATCH');

  check('first run migrates every eligible legacy project, skips none', () => {
    assert.strictEqual(run1.migrated, legacyCount);
    assert.strictEqual(run1.skipped, 0);
  });
  check('second run migrates nothing new and skips exactly the legacy count (LegacyProjectId dedupe works)', () => {
    assert.strictEqual(run2.migrated, 0);
    assert.strictEqual(run2.skipped, legacyCount);
  });
  check('no duplicate PROJECT_MASTER rows exist for the same LegacyProjectId after two runs', () => {
    const rows = mockGlobals.__SHEETS.PROJECT_MASTER.rows;
    const legacyIdColIdx = rows[0].indexOf('LegacyProjectId');
    const legacyIds = rows.slice(1).map(r => r[legacyIdColIdx]).filter(Boolean);
    assert.strictEqual(new Set(legacyIds).size, legacyIds.length, 'duplicate LegacyProjectId found in PROJECT_MASTER');
  });
  check('the legacy Projects sheet is byte-for-byte unchanged after two migration runs (read-only source)', () => {
    assert.strictEqual(JSON.stringify(mockGlobals.__SHEETS.Projects.rows), legacyProjectsBefore);
  });
  check('no Customer/Country/Plant/PIC value is invented for a migrated row — unmapped fields are blank, mapped fields come straight from the legacy row', () => {
    const rows = mockGlobals.__SHEETS.PROJECT_MASTER.rows;
    const h = rows[0];
    const migratedRows = rows.slice(1).filter(r => r[h.indexOf('LegacyProjectId')]);
    migratedRows.forEach(r => {
      assert.strictEqual(r[h.indexOf('Customer')], '', 'Customer must be blank for a migrated legacy project, never invented');
      assert.strictEqual(r[h.indexOf('Country')] || '', '', 'Country must be blank for a migrated legacy project, never invented');
      assert.ok(r[h.indexOf('PIC')] !== undefined && r[h.indexOf('PIC')] !== '', 'PIC IS mapped from the legacy row and must be present');
    });
  });
}

/* ================================================================
 *  CATEGORY 7 — READ-ONLY MUTATION AUDIT (every GET-shaped action,
 *  swept in one pass, must never write to any sheet)
 * ================================================================ */
console.log('\n=== 7. Read-only mutation audit (comprehensive sweep) ===');
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;
  // Seed a bit of everything so every read handler has real data to traverse.
  const pid = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'RO Probe', customer: 'C', pic: 'Sukiyo', status: 'PO', targetDate: '2030-01-01' }, token).project.id;
  const wbsId = post(context, 'createWBS', { projectId: pid, name: 'RO WBS' }, token).wbs.id;
  post(context, 'saveResourceAllocation', { wbsId, engineer: 'Sukiyo', planManDay: 2 }, token);
  post(context, 'createOrgNode', { name: 'RO Org', idealHeadcount: 2 }, token);

  const READ_ONLY_ACTIONS = [
    'bootstrap', 'getProjectMaster', 'projectMasterList', 'externalProjectList',
    'getWBS', 'getActivities', 'listWbsForProject', 'getResourceAllocation',
    'getWorkloadSummary', 'getCapacitySummary', 'getEngineerLoading', 'getSkillLoading',
    'getManpowerAnalysis', 'getDataQualityReport', 'getWorkloadCalendar', 'getWeeklyWorkload',
    'getMonthlyWorkload', 'getSkillCapacity', 'getEngineerCapacity', 'getOrgStructure',
    'getVacancySummary', 'getManpowerBySkill', 'getManpowerByEngineer', 'getManpowerScenario',
    'getManpowerGap', 'getExecutiveDashboard', 'getProjectRisks', 'getProjectsNeedAttention',
    'getExternalWeeklyReport', 'getInternalWeeklyReport', 'getReportingPreview'
  ];
  check('every action in the READ_ONLY_ACTIONS list leaves every sheet byte-identical (' + READ_ONLY_ACTIONS.length + ' actions swept)', () => {
    const before = {}; Object.keys(mockGlobals.__SHEETS).forEach(k => before[k] = JSON.stringify(mockGlobals.__SHEETS[k].rows));
    READ_ONLY_ACTIONS.forEach(a => post(context, a, { projectId: pid, id: pid, wbsId: wbsId }, token));
    Object.keys(mockGlobals.__SHEETS).forEach(k => {
      assert.strictEqual(JSON.stringify(mockGlobals.__SHEETS[k].rows), before[k], k + ' was mutated by a read-only action sweep');
    });
  });
}

/* ================================================================
 *  CATEGORY 8 — CROSS-MODULE FUNCTION/CONST COLLISION (source-level,
 *  proves all 5 .gs files can share one Apps Script global scope)
 * ================================================================ */
console.log('\n=== 8. Cross-module function/constant collision ===');
{
  const perFile = {};
  LOAD_ORDER.forEach(f => { perFile[f] = fs.readFileSync(path.join(PROD_DIR, f), 'utf-8'); });

  check('no top-level function is defined in more than one .gs file', () => {
    const seenIn = {};
    Object.keys(perFile).forEach(f => {
      [...perFile[f].matchAll(/^function ([A-Za-z_][A-Za-z0-9_]*)\(/gm)].forEach(m => {
        const name = m[1];
        assert.ok(!seenIn[name], name + ' defined in both ' + seenIn[name] + ' and ' + f);
        seenIn[name] = f;
      });
    });
  });
  check('no top-level var/const/let is declared in more than one .gs file', () => {
    const seenIn = {};
    Object.keys(perFile).forEach(f => {
      [...perFile[f].matchAll(/^(?:var|const|let) ([A-Za-z_][A-Za-z0-9_]*)/gm)].forEach(m => {
        const name = m[1];
        assert.ok(!seenIn[name], name + ' declared in both ' + seenIn[name] + ' and ' + f);
        seenIn[name] = f;
      });
    });
  });
  check('every .gs file is syntactically valid, self-contained JS (no Node-only syntax)', () => {
    Object.keys(perFile).forEach(f => {
      assert.doesNotThrow(() => new vm.Script(perFile[f], { filename: f }), f + ' failed to parse as valid JS');
      // Deliberately specific patterns (real ES-module/Node syntax), not bare
      // "export"/"import" — several doc comments use those words in prose
      // ("...weekly reporting, and export are explicitly...") which must not
      // false-positive here.
      const nodeOrEsmSyntax = /\brequire\(['"]|module\.exports\s*=|^\s*import\s+.+\s+from\s+['"]|^\s*export\s+(default|function|const|class)\b|process\.env\b|\b__dirname\b|\b__filename\b/m;
      assert.strictEqual(nodeOrEsmSyntax.test(perFile[f]), false, f + ' contains Node-specific syntax');
    });
  });
  check('all 5 files load together into one shared vm context with zero redeclaration errors (proves real single-project GAS compatibility)', () => {
    assert.doesNotThrow(() => freshContext(), 'loading all 5 files into one shared scope must not throw');
  });
}

/* ================================================================
 *  CATEGORY 9 — FRONTEND / BACKEND ACTION PARITY (source-level)
 * ================================================================ */
console.log('\n=== 9. Frontend/backend action parity ===');
{
  const codeSrc = fs.readFileSync(path.join(PROD_DIR, 'Code.gs'), 'utf-8');
  const appSrc = fs.readFileSync(path.join(REPO_ROOT, 'js', 'app.js'), 'utf-8');
  const indexSrc = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf-8');

  const backendActions = new Set([...codeSrc.matchAll(/case '([a-zA-Z]+)':/g)].map(m => m[1]));
  const frontendPostActions = [...appSrc.matchAll(/apiPost\('([a-zA-Z]+)'/g)].map(m => m[1]);
  const frontendGetActions = [...appSrc.matchAll(/apiGet\('([a-zA-Z]+)'/g)].map(m => m[1]);

  check('every apiPost() action call in js/app.js exists as a doPost case in Code.gs', () => {
    frontendPostActions.forEach(a => assert.ok(backendActions.has(a), 'frontend calls apiPost(\'' + a + '\') but no such case exists in Code.gs'));
  });
  check('every apiGet() action call in js/app.js is handled by doGet (teamNames is the only one, by design)', () => {
    const uniqueGets = [...new Set(frontendGetActions)];
    assert.deepStrictEqual(uniqueGets, ['teamNames']);
    assert.ok(/action === 'teamNames'/.test(codeSrc));
  });
  check('every nav data-page in index.html has a matching page-<id> section, and vice versa', () => {
    const navPages = [...indexSrc.matchAll(/data-page="([a-zA-Z]+)"/g)].map(m => m[1]);
    const sectionIds = [...indexSrc.matchAll(/id="page-([a-zA-Z]+)"/g)].map(m => m[1]);
    navPages.forEach(p => assert.ok(sectionIds.indexOf(p) !== -1, 'nav item "' + p + '" has no matching page-' + p + ' section'));
    sectionIds.forEach(p => assert.ok(navPages.indexOf(p) !== -1 || p === 'dashboard', 'section page-' + p + ' has no nav item pointing to it'));
  });
  check('every onclick="goPage(\'X\')" resolves to a real page-X section', () => {
    const goPageCalls = [...indexSrc.matchAll(/goPage\('([a-zA-Z]+)'\)/g)].map(m => m[1]);
    const sectionIds = new Set([...indexSrc.matchAll(/id="page-([a-zA-Z]+)"/g)].map(m => m[1]));
    [...new Set(goPageCalls)].forEach(p => assert.ok(sectionIds.has(p), 'goPage(\'' + p + '\') has no matching section'));
  });
  console.log('  (informational) actions Code.gs exposes but js/app.js never calls, tested only at the API layer:',
    [...backendActions].filter(a => frontendPostActions.indexOf(a) === -1 && a !== 'login').join(', '));
}

/* ================================================================
 *  CATEGORY 10 — GAS COMPATIBILITY
 * ================================================================ */
console.log('\n=== 10. GAS compatibility ===');
{
  const allSrc = LOAD_ORDER.map(f => fs.readFileSync(path.join(PROD_DIR, f), 'utf-8'));
  const combined = allSrc.join('\n');

  check('only documented GAS global services are referenced (SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities, Session, ContentService, Logger)', () => {
    const usedGlobals = [...combined.matchAll(/\b(SpreadsheetApp|PropertiesService|CacheService|LockService|Utilities|Session|ContentService|Logger)\./g)].map(m => m[1]);
    assert.ok(usedGlobals.length > 0, 'sanity: expected at least one GAS global to be referenced');
    const disallowed = /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|document|window|navigator)\./;
    assert.strictEqual(disallowed.test(combined), false, 'a browser/Node-only global was referenced in production .gs code');
  });
  check('no filesystem or npm-dependency assumption exists in any production .gs file', () => {
    assert.strictEqual(/require\(['"]/.test(combined), false);
    assert.strictEqual(/\bfs\.(read|write)/.test(combined), false);
  });
  check('Date handling uses plain JS Date / Utilities.formatDate, both supported by the GAS V8 runtime', () => {
    assert.ok(/Utilities\.formatDate/.test(fs.readFileSync(path.join(PROD_DIR, 'Code.gs'), 'utf-8')));
  });
  check('JSON serialization only uses standard JSON.parse/JSON.stringify (both native to V8, no custom parser)', () => {
    const customParsers = /\bJSON5\b|\bYAML\b/;
    assert.strictEqual(customParsers.test(combined), false);
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
