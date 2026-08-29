/**
 * staging-smoke-test.js — Phase 5.5: exercises the 25 items this phase's
 * brief requires against a REAL deployed Google Apps Script staging Web
 * App. This is NOT a mock test — it makes real HTTP requests.
 *
 * The coding agent that wrote this file has no access to any real GAS
 * environment and has NOT run this script against a real endpoint. It
 * is a deliverable for a human operator to run.
 *
 * ────────────────────────────────────────────────────────────────────
 * USAGE (from a normal local machine with Node 18+, which has fetch()
 * built in — no npm install required):
 *
 *   STAGING_WEB_APP_URL="https://script.google.com/macros/s/XXXX/exec" \
 *     node backend/staging/staging-smoke-test.js
 *
 * The URL is read ONLY from the environment variable below. It is never
 * hardcoded here and must never be committed to this repository.
 *
 * Optional overrides (only needed once Config!LOGIN_PIN has been rotated
 * away from the legacy default, or if you want a different Team member):
 *
 *   STAGING_LOGIN_NAME   (default: "Sukiyo" — a real seeded Team name)
 *   STAGING_LOGIN_PIN    (default: "psp2026" — the legacy default PIN)
 *   STAGING_ALLOW_WRITE_TESTS=true   (opts into item 25, the ONE test in
 *                                     this file that writes a throwaway
 *                                     row into PROJECT_MASTER — see that
 *                                     test's own comment. Every other
 *                                     item in this file is read-only.)
 *
 * Every result is recorded as PASS, FAIL, or UNVERIFIED — never silently
 * collapsed into PASS. UNVERIFIED means "this script could not reach a
 * conclusion" (e.g. STAGING_WEB_APP_URL missing, a network error, or a
 * write test that was not opted into) — it is not a pass.
 * ────────────────────────────────────────────────────────────────────
 */

const STAGING_WEB_APP_URL = process.env.STAGING_WEB_APP_URL;
const LOGIN_NAME = process.env.STAGING_LOGIN_NAME || 'Sukiyo';
const LOGIN_PIN = process.env.STAGING_LOGIN_PIN || 'psp2026';
const ALLOW_WRITE_TESTS = process.env.STAGING_ALLOW_WRITE_TESTS === 'true';

const results = [];
function record(id, label, status, detail) {
  results.push({ id, label, status, detail: detail || '' });
  const pad = String(id).padStart(2, '0');
  console.log(`  [${status.padEnd(10)}] ${pad}. ${label}${detail ? '  — ' + detail : ''}`);
}

async function post(action, body, token) {
  const payload = Object.assign({ action }, body || {});
  if (token) payload.token = token;
  const res = await fetch(STAGING_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // matches js/app.js exactly — avoids a CORS preflight Apps Script doesn't handle well
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  return JSON.parse(text);
}
async function get(action, params) {
  const url = new URL(STAGING_WEB_APP_URL);
  url.searchParams.set('action', action);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return JSON.parse(await res.text());
}

async function main() {
  console.log('================================================================');
  console.log(' STAGING API SMOKE TEST — Phase 5.5 (25 items, real endpoint)');
  console.log('================================================================\n');

  if (!STAGING_WEB_APP_URL) {
    console.error('STAGING_WEB_APP_URL is not set. Every item below is UNVERIFIED.');
    for (let i = 1; i <= 25; i++) record(i, '(not attempted)', 'UNVERIFIED', 'STAGING_WEB_APP_URL not set');
    printSummary();
    process.exitCode = 2;
    return;
  }

  let token = null;

  // 1. login
  try {
    const res = await post('login', { name: LOGIN_NAME, pin: LOGIN_PIN });
    if (res.ok && res.token) { token = res.token; record(1, 'login', 'PASS'); }
    else record(1, 'login', 'FAIL', JSON.stringify(res));
  } catch (e) { record(1, 'login', 'UNVERIFIED', e.message); }

  // 2. invalid login
  try {
    const res = await post('login', { name: LOGIN_NAME, pin: LOGIN_PIN + '-wrong' });
    if (res.ok === false) record(2, 'invalid login', 'PASS');
    else record(2, 'invalid login', 'FAIL', 'expected ok:false, got ' + JSON.stringify(res));
  } catch (e) { record(2, 'invalid login', 'UNVERIFIED', e.message); }

  // 3. bootstrap without token
  try {
    const res = await post('bootstrap', {});
    if (res.ok === false && res.authError === true) record(3, 'bootstrap without token', 'PASS');
    else record(3, 'bootstrap without token', 'FAIL', JSON.stringify(res));
  } catch (e) { record(3, 'bootstrap without token', 'UNVERIFIED', e.message); }

  if (!token) {
    console.error('\nNo valid token obtained from item 1 — every remaining authenticated item is UNVERIFIED.');
    for (let i = 4; i <= 25; i++) record(i, '(not attempted)', 'UNVERIFIED', 'login failed, no token to test with');
    printSummary();
    process.exitCode = 2;
    return;
  }

  // 4. bootstrap with valid token
  await simpleOkCheck(4, 'bootstrap with valid token', 'bootstrap', {}, token);
  // 5. projectMasterList
  await simpleOkCheck(5, 'projectMasterList', 'projectMasterList', {}, token);
  // 6. externalProjectList
  await simpleOkCheck(6, 'externalProjectList', 'externalProjectList', {}, token);
  // 7. getWBS — needs a real id; without one, expect a graceful ok:false, not a crash
  await gracefulNotFoundCheck(7, 'getWBS (graceful not-found on a placeholder id)', 'getWBS', { id: 'staging-smoke-test-placeholder' }, token);
  // 8. getWorkloadSummary
  await simpleOkCheck(8, 'getWorkloadSummary', 'getWorkloadSummary', { periodType: 'week' }, token);
  // 9. getCapacitySummary
  await simpleOkCheck(9, 'getCapacitySummary', 'getCapacitySummary', { periodType: 'week' }, token);
  // 10. getEngineerLoading
  await simpleOkCheck(10, 'getEngineerLoading', 'getEngineerLoading', { periodType: 'week' }, token);
  // 11. getSkillLoading
  await simpleOkCheck(11, 'getSkillLoading', 'getSkillLoading', { periodType: 'week' }, token);
  // 12. getManpowerAnalysis
  await simpleOkCheck(12, 'getManpowerAnalysis', 'getManpowerAnalysis', { periodType: 'week' }, token);
  // 13. getOrgStructure
  await simpleOkCheck(13, 'getOrgStructure', 'getOrgStructure', {}, token);
  // 14. getVacancySummary
  await simpleOkCheck(14, 'getVacancySummary', 'getVacancySummary', {}, token);
  // 15. getManpowerScenario
  await simpleOkCheck(15, 'getManpowerScenario', 'getManpowerScenario', { periodType: 'week' }, token);
  // 16. getExecutiveDashboard
  await simpleOkCheck(16, 'getExecutiveDashboard', 'getExecutiveDashboard', {}, token);
  // 17. getProjectRisks
  await simpleOkCheck(17, 'getProjectRisks', 'getProjectRisks', {}, token);
  // 18. getProjectsNeedAttention
  await simpleOkCheck(18, 'getProjectsNeedAttention', 'getProjectsNeedAttention', {}, token);
  // 19. getExternalWeeklyReport
  await simpleOkCheck(19, 'getExternalWeeklyReport', 'getExternalWeeklyReport', {}, token);
  // 20. getInternalWeeklyReport
  await simpleOkCheck(20, 'getInternalWeeklyReport', 'getInternalWeeklyReport', {}, token);
  // 21. getReportingPreview
  await simpleOkCheck(21, 'getReportingPreview', 'getReportingPreview', {}, token);
  // 22. getDataQualityReport
  await simpleOkCheck(22, 'getDataQualityReport', 'getDataQualityReport', {}, token);

  // 23. legacy API compatibility — a public, read-only, pre-Phase-2 action
  try {
    const res = await get('teamNames', {});
    if (Array.isArray(res)) record(23, 'legacy API compatibility (teamNames, public GET)', 'PASS');
    else record(23, 'legacy API compatibility (teamNames, public GET)', 'FAIL', 'expected an array, got ' + JSON.stringify(res));
  } catch (e) { record(23, 'legacy API compatibility (teamNames, public GET)', 'UNVERIFIED', e.message); }

  // 24. invalid token rejection
  try {
    const res = await post('bootstrap', {}, 'this-is-not-a-real-token');
    if (res.ok === false && res.authError === true) record(24, 'invalid token rejection', 'PASS');
    else record(24, 'invalid token rejection', 'FAIL', JSON.stringify(res));
  } catch (e) { record(24, 'invalid token rejection', 'UNVERIFIED', e.message); }

  // 25. formula-injection safety — the ONE write in this file, opt-in only.
  // Every other item above is read-only by design, so a smoke test can be
  // run repeatedly against a shared staging spreadsheet without leaving
  // garbage behind. This check genuinely requires a write (sanitization
  // only applies on write), so it is gated behind STAGING_ALLOW_WRITE_TESTS.
  if (!ALLOW_WRITE_TESTS) {
    record(25, 'formula-injection safety', 'UNVERIFIED', 'write tests disabled — set STAGING_ALLOW_WRITE_TESTS=true to enable (this is the only test in this file that writes data)');
  } else {
    try {
      const dangerousName = '=1+1';
      const created = await post('addProjectMaster', {
        type: 'INTERNAL', name: dangerousName, pic: LOGIN_NAME, targetDate: '2099-01-01',
        note: 'staging-smoke-test formula-injection probe — safe to delete'
      }, token);
      if (!created.ok) { record(25, 'formula-injection safety', 'FAIL', 'could not create the probe row: ' + JSON.stringify(created)); }
      else {
        const readBack = await post('getProjectMaster', { id: created.project.id }, token);
        // The exact stored form (whether Google Sheets keeps or strips the
        // sanitizer's leading apostrophe on an API-set value) is itself a
        // real-Sheets behavior this script cannot assume — that is exactly
        // the kind of thing only real GAS can answer. What this test can
        // check is the actual security property: the value must NOT have
        // been evaluated as a live formula (i.e. must not come back as the
        // number 2 or the string "2") — that would mean sanitizeStr_ did
        // not run or did not work.
        const name = readBack.project && readBack.project.name;
        const gotEvaluated = readBack.ok && (name === 2 || name === '2');
        const gotRecognizableText = readBack.ok && typeof name === 'string' && name.replace(/^'/, '') === dangerousName;
        if (gotRecognizableText && !gotEvaluated) {
          record(25, 'formula-injection safety', 'PASS', `stored/returned as text ("${name}"), not evaluated as a formula — probe row id ${created.project.id} should be deleted from PROJECT_MASTER manually`);
        } else {
          record(25, 'formula-injection safety', 'FAIL', 'expected literal text back (with or without a leading apostrophe), got: ' + JSON.stringify(readBack));
        }
      }
    } catch (e) { record(25, 'formula-injection safety', 'UNVERIFIED', e.message); }
  }

  printSummary();
}

async function simpleOkCheck(id, label, action, body, token) {
  try {
    const res = await post(action, body, token);
    if (res.ok === true) record(id, label, 'PASS');
    else record(id, label, 'FAIL', JSON.stringify(res).slice(0, 200));
  } catch (e) { record(id, label, 'UNVERIFIED', e.message); }
}
async function gracefulNotFoundCheck(id, label, action, body, token) {
  try {
    const res = await post(action, body, token);
    // A placeholder id should be rejected gracefully (ok:false, clear
    // message), never crash the server or return ok:true with fake data.
    if (res.ok === false && typeof res.message === 'string') record(id, label, 'PASS');
    else record(id, label, 'FAIL', 'expected a graceful ok:false, got: ' + JSON.stringify(res).slice(0, 200));
  } catch (e) { record(id, label, 'UNVERIFIED', e.message); }
}

function printSummary() {
  console.log('\n================================================================');
  const counts = { PASS: 0, FAIL: 0, UNVERIFIED: 0 };
  results.forEach(r => counts[r.status]++);
  console.log(` ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.UNVERIFIED} UNVERIFIED (of ${results.length})`);
  console.log('================================================================');
  if (counts.FAIL > 0) {
    console.log('\nFAIL items require investigation before staging sign-off:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log('  - ' + r.id + '. ' + r.label + ': ' + r.detail));
  }
  if (counts.UNVERIFIED > 0) {
    console.log('\nUNVERIFIED items were not concluded (not the same as passing):');
    results.filter(r => r.status === 'UNVERIFIED').forEach(r => console.log('  - ' + r.id + '. ' + r.label + ': ' + r.detail));
  }
  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch(e => { console.error('Smoke test crashed:', e); process.exitCode = 2; });
