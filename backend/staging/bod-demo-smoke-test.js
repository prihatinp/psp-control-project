/**
 * bod-demo-smoke-test.js — minimal, fast smoke test for the BOD-demo
 * critical path: health, teamNames, login, bootstrap, projectMasterList,
 * externalProjectList, getExecutiveDashboard. Run this ONE script instead
 * of clicking through the app by hand.
 *
 * This makes REAL HTTP requests to whatever /exec URL you give it — it
 * has not been run against your live deployment by the coding agent (no
 * Google/GAS access exists in that environment). You run it, you see the
 * real result.
 *
 * USAGE (Node 18+, no install needed):
 *   PSP_API_URL="https://script.google.com/macros/s/XXXX/exec" \
 *     node backend/staging/bod-demo-smoke-test.js
 *
 * Optional:
 *   PSP_LOGIN_NAME  (default: "Sukiyo" — a real seeded Team name)
 *   PSP_LOGIN_PIN   (default: "psp2026" — override once rotated)
 *
 * The URL/credentials are read ONLY from environment variables — never
 * hardcode or commit them. Every result is PASS/FAIL/UNVERIFIED, never
 * silently upgraded to PASS.
 */
const PSP_API_URL = process.env.PSP_API_URL || process.env.STAGING_WEB_APP_URL;
const LOGIN_NAME = process.env.PSP_LOGIN_NAME || 'Sukiyo';
const LOGIN_PIN = process.env.PSP_LOGIN_PIN || 'psp2026';

const results = [];
function record(n, label, status, detail) {
  results.push({ n, label, status, detail: detail || '' });
  console.log(`  [${status.padEnd(10)}] ${n}. ${label}${detail ? '  — ' + detail : ''}`);
}

async function post(action, body, token) {
  const payload = Object.assign({ action }, body || {});
  if (token) payload.token = token;
  const res = await fetch(PSP_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // matches js/app.js exactly
    body: JSON.stringify(payload)
  });
  return JSON.parse(await res.text());
}
async function get(action, params) {
  const url = new URL(PSP_API_URL);
  if (action) url.searchParams.set('action', action);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return JSON.parse(await res.text());
}

async function main() {
  console.log('================================================================');
  console.log(' BOD DEMO SMOKE TEST — 7-item critical path');
  console.log('================================================================\n');

  if (!PSP_API_URL) {
    console.error('PSP_API_URL (or STAGING_WEB_APP_URL) is not set. Nothing was attempted.');
    for (let i = 1; i <= 7; i++) record(i, '(not attempted)', 'UNVERIFIED', 'PSP_API_URL not set');
    finish(false);
    return;
  }
  console.log('Target: ' + PSP_API_URL.replace(/\/macros\/s\/[^/]+/, '/macros/s/***') + '\n');

  // 1. health — plain GET, no action
  let healthOk = false;
  try {
    const res = await get(null, {});
    if (res && res.ok === true && typeof res.message === 'string') { record(1, 'health (GET, no action)', 'PASS'); healthOk = true; }
    else record(1, 'health (GET, no action)', 'FAIL', JSON.stringify(res));
  } catch (e) { record(1, 'health (GET, no action)', 'UNVERIFIED', e.message); }

  // 2. teamNames
  let teamNamesOk = false;
  try {
    const res = await get('teamNames', {});
    if (Array.isArray(res) && res.length > 0) { record(2, 'teamNames', 'PASS', res.length + ' names'); teamNamesOk = true; }
    else if (Array.isArray(res)) { record(2, 'teamNames', 'FAIL', 'returned an empty array — Team sheet has no rows, or teamNames is broken'); }
    else record(2, 'teamNames', 'FAIL', 'expected an array, got: ' + JSON.stringify(res));
  } catch (e) { record(2, 'teamNames', 'UNVERIFIED', e.message); }

  // 3. login
  let token = null;
  try {
    const res = await post('login', { name: LOGIN_NAME, pin: LOGIN_PIN });
    if (res.ok && res.token) { token = res.token; record(3, 'login', 'PASS', 'token received'); }
    else record(3, 'login', 'FAIL', JSON.stringify(res));
  } catch (e) { record(3, 'login', 'UNVERIFIED', e.message); }

  if (!token) {
    console.error('\nNo token — items 4-7 all require authentication and cannot proceed.');
    for (let i = 4; i <= 7; i++) record(i, '(not attempted)', 'UNVERIFIED', 'login failed, no token');
    finish(healthOk && teamNamesOk);
    return;
  }

  // 4. bootstrap
  try {
    const res = await post('bootstrap', {}, token);
    const arrayFields = ['team', 'stages', 'phases', 'projects', 'dailyLogs', 'supportJobs', 'globalSupport'];
    const missing = arrayFields.filter(f => !Array.isArray(res[f]));
    if (res.ok && missing.length === 0) record(4, 'bootstrap', 'PASS', arrayFields.map(f => f + ':' + res[f].length).join(', '));
    else record(4, 'bootstrap', 'FAIL', missing.length ? 'missing/non-array field(s): ' + missing.join(',') : JSON.stringify(res).slice(0, 200));
  } catch (e) { record(4, 'bootstrap', 'UNVERIFIED', e.message); }

  // 5. projectMasterList
  try {
    const res = await post('projectMasterList', {}, token);
    if (res.ok && Array.isArray(res.projects)) record(5, 'projectMasterList', 'PASS', res.projects.length + ' project(s)');
    else record(5, 'projectMasterList', 'FAIL', JSON.stringify(res).slice(0, 200));
  } catch (e) { record(5, 'projectMasterList', 'UNVERIFIED', e.message); }

  // 6. externalProjectList
  try {
    const res = await post('externalProjectList', {}, token);
    if (res.ok && Array.isArray(res.projects)) record(6, 'externalProjectList', 'PASS', res.projects.length + ' project(s)');
    else record(6, 'externalProjectList', 'FAIL', JSON.stringify(res).slice(0, 200));
  } catch (e) { record(6, 'externalProjectList', 'UNVERIFIED', e.message); }

  // 7. getExecutiveDashboard — must return structured KPI data even with empty sheets
  try {
    const res = await post('getExecutiveDashboard', {}, token);
    const okShape = res.ok
      && res.summary && res.summary.portfolio && res.summary.progress
      && res.manpower && typeof res.manpower.currentMp === 'number'
      && res.workload && res.dataQuality;
    if (okShape) {
      record(7, 'getExecutiveDashboard', 'PASS',
        `totalActive=${res.summary.portfolio.totalActive}, currentMp=${res.manpower.currentMp}, ` +
        `requiredMp=${res.manpower.requiredMp}, baselineMp=${res.manpower.managementBaselineMp}, ` +
        `dataQuality=${res.dataQuality.status}`);
    } else {
      record(7, 'getExecutiveDashboard', 'FAIL', 'response is missing expected KPI structure: ' + JSON.stringify(res).slice(0, 300));
    }
  } catch (e) { record(7, 'getExecutiveDashboard', 'UNVERIFIED', e.message); }

  finish(true);
}

function finish(reachedAuth) {
  console.log('\n================================================================');
  const counts = { PASS: 0, FAIL: 0, UNVERIFIED: 0 };
  results.forEach(r => counts[r.status]++);
  console.log(` ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.UNVERIFIED} UNVERIFIED (of ${results.length})`);
  console.log('================================================================');
  if (counts.FAIL > 0 || counts.UNVERIFIED > 0) {
    console.log('\nItems needing attention:');
    results.filter(r => r.status !== 'PASS').forEach(r => console.log(`  - ${r.n}. ${r.label} [${r.status}]: ${r.detail}`));
  }
  console.log(counts.PASS === 7
    ? '\n✅ All 7 critical-path checks PASS on the real endpoint. Demo path is live.'
    : '\n❌ Not all 7 checks passed — do not treat the demo path as verified until they do.');
  process.exitCode = (counts.FAIL > 0 || counts.UNVERIFIED > 0) ? 1 : 0;
}

main().catch(e => { console.error('Smoke test crashed:', e); process.exitCode = 2; });
