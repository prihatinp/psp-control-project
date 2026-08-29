/**
 * concurrency-test.js — Phase 5.5: issues GENUINELY concurrent requests
 * against a real deployed staging Web App to test whether LockService
 * actually serializes conflicting writes in the real Google Apps Script
 * runtime.
 *
 * WHY THIS FILE HAS TO EXIST AND CANNOT BE REPLACED BY A MOCK TEST:
 * every mock test in this repository (mock-gas-v2.js) implements
 * LockService as a call-counting no-op — it does NOT provide real mutual
 * exclusion, because Node's mock harness runs single-threaded. No amount
 * of mock testing can ever prove that `LockService.getScriptLock()`
 * genuinely prevents two real, simultaneous Apps Script executions from
 * corrupting the same sheet. This is the one property this repository
 * has flagged as UNVERIFIED in every prior phase's report — this script
 * is how a human closes that gap for real.
 *
 * The coding agent that wrote this file has NOT run it against a real
 * endpoint. It is a deliverable for a human operator to run.
 *
 * ────────────────────────────────────────────────────────────────────
 * USAGE:
 *   STAGING_WEB_APP_URL="https://script.google.com/macros/s/XXXX/exec" \
 *     node backend/staging/concurrency-test.js
 *
 * Optional: STAGING_LOGIN_NAME / STAGING_LOGIN_PIN (see
 * staging-smoke-test.js for defaults and rotation notes).
 *
 * NEVER run this against a production URL. It writes real rows (clearly
 * labeled, safe to delete afterward) into the staging spreadsheet's
 * PROJECT_MASTER and WBS sheets, and calls migrateLegacyProjects twice.
 * ────────────────────────────────────────────────────────────────────
 */

const STAGING_WEB_APP_URL = process.env.STAGING_WEB_APP_URL;
const LOGIN_NAME = process.env.STAGING_LOGIN_NAME || 'Sukiyo';
const LOGIN_PIN = process.env.STAGING_LOGIN_PIN || 'psp2026';
const CONCURRENCY = Number(process.env.STAGING_CONCURRENCY || 10);

async function post(action, body, token) {
  const payload = Object.assign({ action }, body || {});
  if (token) payload.token = token;
  const res = await fetch(STAGING_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { return { __parseError: true, raw: text, error: e.message }; }
}

function reportJsonIntegrity(label, responses) {
  const corrupted = responses.filter(r => r.__parseError);
  if (corrupted.length) {
    console.log(`  FAIL  - ${label}: ${corrupted.length}/${responses.length} responses were not valid JSON (corrupted)`);
    corrupted.forEach(c => console.log('          raw: ' + c.raw.slice(0, 200)));
    return false;
  }
  console.log(`  ok    - ${label}: all ${responses.length} responses parsed as valid JSON`);
  return true;
}

async function main() {
  console.log('================================================================');
  console.log(' REAL CONCURRENCY TEST — Phase 5.5 (genuinely simultaneous requests)');
  console.log('================================================================\n');

  if (!STAGING_WEB_APP_URL) {
    console.error('STAGING_WEB_APP_URL is not set. This test cannot run — UNVERIFIED.');
    console.error('Set it to your staging deployment\'s .../exec URL and re-run.');
    process.exitCode = 2;
    return;
  }

  const login = await post('login', { name: LOGIN_NAME, pin: LOGIN_PIN });
  if (!login.ok || !login.token) {
    console.error('Could not log in — UNVERIFIED. Response:', JSON.stringify(login));
    process.exitCode = 2;
    return;
  }
  const token = login.token;
  let overallOk = true;

  /* ============================================================
   * SCENARIO A — N genuinely concurrent createWBS calls under one
   * project. Tests the classic Apps Script pitfall: concurrent
   * appendRow()/getLastRow()+1 without a real lock can make one
   * write silently overwrite another's row instead of appending a
   * new one. Every row here is uniquely labeled so loss/corruption
   * is directly detectable by counting and diffing labels afterward.
   * ============================================================ */
  console.log(`--- Scenario A: ${CONCURRENCY} concurrent createWBS calls under one project ---`);
  const project = await post('addProjectMaster', {
    type: 'INTERNAL', name: 'Concurrency Test Project (safe to delete)', pic: LOGIN_NAME, targetDate: '2099-01-01',
    note: 'created by concurrency-test.js — safe to delete along with its WBS rows'
  }, token);
  if (!project.ok) {
    console.error('  Could not create the test project — UNVERIFIED. Response:', JSON.stringify(project));
    overallOk = false;
  } else {
    const projectId = project.project.id;
    const labels = Array.from({ length: CONCURRENCY }, (_, i) => `concurrency-probe-${i}-${Date.now()}`);

    // Promise.all fires all requests essentially simultaneously — Node
    // does not wait for one to finish before starting the next. This is
    // the "genuinely concurrent" requirement: real overlapping HTTP
    // requests hitting the real Apps Script Web App at (as close to)
    // the same instant as this machine's network stack allows.
    const createResponses = await Promise.all(labels.map(label => post('createWBS', { projectId, name: label }, token)));

    const jsonOk = reportJsonIntegrity('Scenario A response JSON', createResponses);
    overallOk = overallOk && jsonOk;

    const failed = createResponses.filter(r => !r.ok);
    if (failed.length) {
      console.log(`  FAIL  - ${failed.length}/${CONCURRENCY} createWBS calls returned ok:false (lost writes): ${JSON.stringify(failed.slice(0, 3))}`);
      overallOk = false;
    } else {
      console.log(`  ok    - all ${CONCURRENCY} createWBS calls returned ok:true`);
    }

    const ids = createResponses.filter(r => r.ok).map(r => r.wbs.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      console.log(`  FAIL  - duplicate WBS_ID generated: ${ids.length} responses, only ${uniqueIds.size} unique ids`);
      overallOk = false;
    } else {
      console.log(`  ok    - all ${ids.length} generated WBS_IDs are unique (no duplicate IDs)`);
    }

    // Read back from the server's own perspective (not just trusting the
    // write responses) — this is what actually proves no row was lost or
    // overwritten by a racing sibling request.
    const listing = await post('listWbsForProject', { projectId }, token);
    if (!listing.ok) {
      console.log('  FAIL  - could not read back the WBS list — UNVERIFIED for row-loss/corruption check:', JSON.stringify(listing));
      overallOk = false;
    } else {
      const namesOnServer = new Set(listing.wbs.map(a => a.name));
      const missing = labels.filter(l => !namesOnServer.has(l));
      if (missing.length) {
        console.log(`  FAIL  - ${missing.length}/${CONCURRENCY} probe rows are missing from the server's own listing (lost or overwritten writes): ${JSON.stringify(missing)}`);
        overallOk = false;
      } else {
        console.log(`  ok    - all ${CONCURRENCY} probe rows are present and distinguishable in the server's own listing (no lost or overwritten writes)`);
      }
      const partial = listing.wbs.filter(a => labels.includes(a.name) && (!a.id || !a.projectId || a.projectId !== projectId));
      if (partial.length) {
        console.log(`  FAIL  - ${partial.length} probe row(s) have missing/wrong required fields (partial records): ${JSON.stringify(partial)}`);
        overallOk = false;
      } else {
        console.log('  ok    - no partial records among the probe rows (id + projectId present and correct on every one)');
      }
    }
  }

  /* ============================================================
   * SCENARIO B — 2 genuinely concurrent migrateLegacyProjects calls.
   * Explicitly required by this phase's brief: "no duplicate
   * migration occurs" is exactly the race this checks — two
   * simultaneous migration runs must not both see "not yet migrated"
   * for the same legacy row and both write a PROJECT_MASTER copy of it.
   * ============================================================ */
  console.log('\n--- Scenario B: 2 concurrent migrateLegacyProjects calls ---');
  const [migA, migB] = await Promise.all([post('migrateLegacyProjects', {}, token), post('migrateLegacyProjects', {}, token)]);
  const migJsonOk = reportJsonIntegrity('Scenario B response JSON', [migA, migB]);
  overallOk = overallOk && migJsonOk;
  if (!migA.ok || !migB.ok) {
    console.log('  FAIL  - one or both concurrent migration calls returned ok:false:', JSON.stringify({ migA, migB }));
    overallOk = false;
  } else {
    console.log(`  info  - call A: migrated=${migA.migrated} skipped=${migA.skipped}; call B: migrated=${migB.migrated} skipped=${migB.skipped}`);
    // Whichever call "wins" the lock migrates the real rows; the other
    // must see them as already-migrated and skip — never both migrating
    // the same row. We can't know in advance which call wins, so check
    // the combined outcome instead of either call individually.
    const finalList = await post('projectMasterList', { type: 'INTERNAL' }, token);
    if (!finalList.ok) {
      console.log('  FAIL  - could not read back projectMasterList to check for duplicates — UNVERIFIED:', JSON.stringify(finalList));
      overallOk = false;
    } else {
      const legacyLinked = finalList.projects.filter(p => p.legacyProjectId); // note: legacyProjectId is intentionally omitted from the API response by design (see PROJECT_MASTER.gs) — see the printed count below instead
      console.log(`  info  - projectMasterList does not expose legacyProjectId (by design — internal migration key only), so duplicate-migration detection must be done by a human directly in the PROJECT_MASTER sheet: filter the LegacyProjectId column and confirm every legacy project id appears in it EXACTLY ONCE.`);
      console.log('  ACTION REQUIRED (human): open PROJECT_MASTER in the staging spreadsheet, and confirm no LegacyProjectId value repeats.');
    }
  }

  console.log('\n================================================================');
  console.log(overallOk
    ? ' No corruption/loss/duplication detected in what this script CAN check automatically.'
    : ' ISSUES FOUND — see FAIL lines above. Do not treat LockService as verified.');
  console.log(' Scenario B\'s duplicate-migration check requires one manual look at the');
  console.log(' real PROJECT_MASTER sheet (LegacyProjectId column) — this script cannot');
  console.log(' see that column through the API by design. Do not mark LockService');
  console.log(' concurrency fully verified until that manual check is also done.');
  console.log('================================================================');
  if (!overallOk) process.exitCode = 1;
}

main().catch(e => { console.error('Concurrency test crashed:', e); process.exitCode = 2; });
