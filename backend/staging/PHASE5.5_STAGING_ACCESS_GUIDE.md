# Phase 5.5 — Real GAS Access Bridge & Staging Verification Guide

This phase's objective was narrower than every prior "verification"
phase: not to verify anything against real Google Apps Script (Phase 5.4
already established this coding environment cannot reach one), but to
**prepare everything a human needs to do that verification themselves,
safely, without ever exposing a secret or touching production
prematurely.**

## What was built this phase

| File | Purpose |
|---|---|
| `backend/staging/Code.gs`, `ProjectMaster.gs`, `WbsWorkload.gs`, `Organization.gs`, `Reporting.gs` | Exact, byte-identical copies of `backend/production/*.gs` — the literal 5 files to paste into a new Apps Script project. Re-generate them from `backend/production/` if either ever drifts; they are not meant to be hand-edited independently. |
| `backend/staging/appsscript.json` | The manifest to paste into that project's `appsscript.json` (`timeZone: Asia/Jakarta`, `runtimeVersion: V8`, `webapp.access: ANYONE_ANONYMOUS`, `webapp.executeAs: USER_DEPLOYING`) — matches the anonymous-frontend/token-based auth model the entire codebase assumes. |
| `backend/staging/STAGING_SETUP_CHECKLIST.md` | Step A–O: create the project, copy files, configure the manifest, run `setupSpreadsheet()`, verify every sheet/Config/Team, deploy as a test Web App, record the deployment ID, then run the two scripts below and rehearse rollback. |
| `backend/staging/staging-smoke-test.js` | Executable Node script — the 25-item API check from this phase's brief, run against a real `STAGING_WEB_APP_URL` supplied via environment variable (never hardcoded, never committed). Reports PASS/FAIL/UNVERIFIED per item; self-tested this phase against a local HTTP wrapper of the existing mock harness to confirm the script's own logic is correct — that self-test proves nothing about real GAS, only that this script isn't buggy. |
| `backend/staging/concurrency-test.js` | Executable Node script that fires genuinely concurrent requests (`Promise.all`, real overlapping HTTP calls) at a real staging deployment — the one property (`LockService` mutual exclusion) no mock in this repository can ever prove, by the mock's own documented design. Also self-tested this phase for logic correctness only. |
| `backend/staging/SECURITY_VERIFICATION.md` | Manual checklist: Script Properties, `LOGIN_PIN` status, the full auth chain, sanitization, Web App/spreadsheet permissions. |
| `backend/production/DEPLOYMENT_RUNBOOK.md` (updated) | Restructured into explicit Stage 0 → I, referencing the new `backend/staging/` artifacts at each stage, with Stage F (Human Approval) as a hard, explicit gate before Stage G (Production Deployment). |
| `js/app.js` (one additive line changed) | `PSP_API_URL` now checks a `localStorage` override (`psp_staging_api_url`) before falling back to the committed production URL — lets a browser point at staging temporarily without committing any URL. Falls back to the exact prior behavior when the override is unset. |

## What the coding agent DID this phase

- Prepared the staging file package (generated, verified byte-identical
  to source).
- Prepared the staging manifest.
- Prepared two executable test scripts (smoke test, concurrency test),
  each self-tested for internal logic correctness against a local mock
  HTTP wrapper — **not** against any real GAS environment.
- Prepared a security checklist, a restructured deployment runbook, and
  this guide.
- Implemented the one small, additive, non-committing frontend
  configuration mechanism requested (a `localStorage` override).
- Validated the repository is still clean: 233/233 tests pass, the
  additive diff against `backend/legacy/Code.gs` is unchanged, and the 5
  staging files are byte-identical to their production source.

## What REQUIRES human / real GAS access (the coding agent cannot do these)

- Creating the actual staging Google Apps Script project.
- Copying the 5 files into that real project's editor.
- Executing `setupSpreadsheet()` against a real spreadsheet.
- Configuring Script Properties and confirming `HMAC_SECRET`/`SS_ID`
  exist correctly.
- Deploying the Web App and obtaining a real, callable URL.
- Reading the real `Config` sheet (including `LOGIN_PIN`'s actual current
  value).
- Running `staging-smoke-test.js` and `concurrency-test.js` against that
  real URL and observing real results.
- Rehearsing rollback against a real (or real-equivalent) project.
- Deciding whether/when to rotate `Config!LOGIN_PIN`.
- Giving the Stage F human-approval sign-off.
- Deploying to, or touching in any way, the real **production** Apps
  Script project or spreadsheet.

None of the above was attempted, simulated, or approximated as if it had
happened. Every deliverable this phase produced is a tool or document for
a human to use — not a substitute for using it.

## Stop condition

Per this phase's explicit instruction, this is where the coding agent
stops. No claim is made that staging verification occurred, and no claim
is made that production readiness improved beyond "the bridge to verify
it now exists and is ready to use."

---

PRODUCTION DEPLOYMENT:
**NOT DEPLOYED**

REAL GAS VERIFICATION:
**PENDING HUMAN/GAS ACCESS**

PHASE 5.5:
**READY FOR HUMAN STAGING SETUP**
