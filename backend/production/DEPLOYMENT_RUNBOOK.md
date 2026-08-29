# Deployment Runbook — Phase 2 through Phase 5.5 → Real Google Apps Script

**Status: nothing below has been executed. The real production Apps
Script backend has NOT been modified or deployed by this repository at
any point through Phase 5.5.** This is a literal, ordered checklist for a
human operator to execute manually — the coding agent that wrote this
document has no access to any real Google Apps Script project, Google
Sheets spreadsheet, or deployed Web App (confirmed in
`PHASE5.4_REAL_GAS_VERIFICATION_REPORT.md`; re-confirmed in
`backend/staging/PHASE5.5_STAGING_ACCESS_GUIDE.md`).

Nine explicit stages, in order:

| Stage | Name | Touches Google? | Reversible? |
|---|---|---|---|
| 0 | Repository Verification | No | n/a |
| A | GAS Staging Project | Yes — a throwaway project + spreadsheet | Freely — delete and redo |
| B | API Smoke Test | Yes — staging only | Read-mostly; one opt-in write, documented |
| C | Concurrency Test | Yes — staging only | Writes labeled throwaway rows, documented |
| D | Frontend Staging | Yes — staging only, via a non-committing browser override | Fully — clears with one `localStorage` call |
| E | Security Verification | Yes — staging only | n/a (verification, not mutation) |
| F | Human Approval | No | n/a — this is a decision gate |
| G | Production Deployment | **Yes — the real project** | See `ROLLBACK_PLAN.md` |
| H | Production Smoke Test | **Yes — the real project**, disposable test data only | n/a |
| I | Rollback (if required) | **Yes — the real project**, only if invoked | By definition |

**Do not skip Stage 0 or Stage A. Do not reach Stage G without an
explicit, separate human approval at Stage F — no earlier step implies
that approval.**

## Before you start

Read `PRODUCTION_READINESS_AUDIT.md`, `PHASE5.3_PRE_PRODUCTION_REPORT.md`,
`PHASE5.4_REAL_GAS_VERIFICATION_REPORT.md`, and
`backend/staging/PHASE5.5_STAGING_ACCESS_GUIDE.md` in full. If the most
recent release gate is 🔴 NO-GO, stop here.

---

## STAGE 0 — Repository Verification

Entirely offline — no Google account, no GAS project, no spreadsheet
involved. Confirms the release candidate itself before anyone touches
Google.

- `git status` shows a clean working tree on the branch being released.
- `diff backend/legacy/Code.gs backend/production/Code.gs` shows only the
  documented additive hunks (one mechanical comma on the `CONFIG` line,
  pure `case`/setup-call insertions) — no other line differs.
- Run every test suite in `backend/production/test/` plus
  `backend/test/smoke-test.js`. Expected baseline at time of writing:
  **233/233 passed, 0 failed**.
- Confirm `backend/staging/` exists and its 5 `.gs` files are
  byte-identical to `backend/production/`'s (they are generated directly
  from it — re-diff if in doubt).

Only proceed to Stage A once Stage 0 is clean.

---

## STAGE A — GAS Staging Project

Full step-by-step detail lives in `backend/staging/STAGING_SETUP_CHECKLIST.md`
(steps A–K there). Summary:

1. Create a **new** Google Apps Script project — never the real
   production one (`backend/staging/STAGING_SETUP_CHECKLIST.md` A–B).
2. Copy the 5 files from `backend/staging/` into it verbatim (C).
3. Configure `appsscript.json` from `backend/staging/appsscript.json` (D).
4. Bind a **brand-new, empty** spreadsheet and run `setupSpreadsheet()`
   once (E). Expected effect (idempotent, additive-only, verified against
   a mock repeatedly in Phase 5.2/5.3, never yet against a real
   spreadsheet): creates all 12 sheets, seeds the legacy ones, appends 17
   `Config` keys, generates `HMAC_SECRET`.
5. Verify the spreadsheet, `Config`, `Team`, and the four new sheets
   against `backend/production/SCHEMA_AUDIT.md` (F–I).
6. Deploy as a **TEST** Web App and record the deployment ID/version
   somewhere outside this repository (J–K).

**Never commit the resulting Web App URL, deployment ID, or spreadsheet
ID to this repository.**

---

## STAGE B — API Smoke Test

Run `backend/staging/staging-smoke-test.js` against the Stage A URL:

```
STAGING_WEB_APP_URL="https://script.google.com/macros/s/XXXX/exec" \
  node backend/staging/staging-smoke-test.js
```

Exercises all 25 items from the Phase 5.5 brief (login, invalid login,
bootstrap with/without a token, every read-only reporting/manpower/
organization action, legacy compatibility, invalid-token rejection, and
an opt-in formula-injection check) against the **real deployed
endpoint**. Every result is PASS, FAIL, or UNVERIFIED — never collapsed
into PASS. Do not proceed to Stage C with any FAIL unresolved.

Also run the migration dry-run here: call `migrateLegacyProjects` once
(via the smoke test's own `post()` pattern or a REST client) and confirm
`migrated` equals the staging spreadsheet's real legacy `Projects` row
count with `skipped: 0`; call it again and confirm `migrated: 0`,
`skipped` = the same count as before.

---

## STAGE C — Concurrency Test

Run `backend/staging/concurrency-test.js` against the same staging URL:

```
STAGING_WEB_APP_URL="https://script.google.com/macros/s/XXXX/exec" \
  node backend/staging/concurrency-test.js
```

This is the one property no mock test in this repository can ever prove
(`mock-gas-v2.js`'s `LockService` is a documented no-op). It fires
genuinely concurrent `createWBS` calls and two concurrent
`migrateLegacyProjects` calls at the real endpoint, and checks for
duplicate IDs, lost writes, partial records, and corrupted JSON
automatically — plus one manual step (checking the real `PROJECT_MASTER`
sheet's `LegacyProjectId` column for duplicates, since that field is
intentionally not exposed through the API). Do not mark LockService
concurrency verified until that manual step is also done.

---

## STAGE D — Frontend Staging

No file in this repository needs editing to point the frontend at
staging — `js/app.js`'s `PSP_API_URL` already checks a `localStorage`
override first (Phase 5.5 addition), falling back to the committed
production URL when unset. In a browser on the site:

```js
localStorage.setItem('psp_staging_api_url', 'PASTE_YOUR_STAGING_URL_HERE');
location.reload();
```

Click through every nav item — legacy pages (Dashboard, Projects, Daily
Update, Team) and every Phase 2–5.1 page (Project Control, Resource &
Capacity, Manpower & Capacity, Executive & Reporting). Confirm each loads
without a console error and without an "Aksi tidak dikenal" response.
From the staging-pointed frontend: add a test External project, add a
WBS row, allocate an engineer, add an org node — confirm each appears
immediately in the corresponding page and in the staging spreadsheet.

To revert this browser to production behavior:

```js
localStorage.removeItem('psp_staging_api_url');
location.reload();
```

This never touches any committed file and is per-browser only.

---

## STAGE E — Security Verification

Work through `backend/staging/SECURITY_VERIFICATION.md` in full against
the staging project: Script Properties, `Config!LOGIN_PIN` status, the
full authentication chain (login, brute-force, rate limit, expired/forged
token rejection), sanitization, and Web App/spreadsheet permission
settings. Record `Config!LOGIN_PIN`'s status as
`LEGACY DEFAULT ACTIVE — ROTATION REQUIRED` if it is still `psp2026` —
do not rotate it as part of this stage, and never commit its value.

---

## STAGE F — Human Approval

**A hard gate, not a formality.** Do not proceed to Stage G until a human
has reviewed:
- Stage 0's clean repository state,
- Stage B/C's smoke-test and concurrency-test output (no unresolved
  FAIL),
- Stage E's security checklist (with `LOGIN_PIN` rotation explicitly
  decided, not merely noted),

and has explicitly said to proceed with production deployment. No
automated process, script, or prior stage passing implies this approval.

---

## STAGE G — Production Deployment

Only after Stage F's explicit approval. In the **real** Apps Script
project (never the staging one):
1. Add/replace the 5 `.gs` files, using `backend/staging/`'s copies
   (byte-identical to `backend/production/`) — or copy directly from
   `backend/production/` again, since `backend/staging/` is generated
   from it and carries nothing different.
2. Configure `appsscript.json` per Stage A step 3, applied to the real
   project.
3. Create a **new** Web App deployment version (avoid overwriting an
   existing version in place — versioned deployments make Stage I trivial).
4. Run `setupSpreadsheet()` once against the **real** spreadsheet (same
   idempotency guarantee exercised in Stage A, now for real).
5. Tag the exact commit deployed (e.g. `git tag production-2026-XX-XX`)
   so the deployed state is always traceable to a specific, reviewed
   commit.

---

## STAGE H — Production Smoke Test

Repeat Stage B's `staging-smoke-test.js` against the new **production**
Web App URL (set `STAGING_WEB_APP_URL` to the production URL for this
one run only — the script itself has no notion of "staging" vs.
"production," it just calls whatever URL it's given). Use a real but
clearly-labeled disposable project (not real PSP project data) for any
write-path/opt-in checks. Do **not** run `concurrency-test.js` against
production as a matter of course — its writes, while labeled and
findable, are not something to do against live data without a specific
reason; Stage C's staging result plus Stage E's manual `LegacyProjectId`
check are what stand in for it here.

Update `js/app.js`'s committed `PSP_API_URL` only after Stage H passes,
and only if the production Web App URL actually changed (redeploying an
existing deployment version keeps the same URL).

---

## STAGE I — Rollback (if required)

See `ROLLBACK_PLAN.md` for the full, non-destructive procedure. Rehearse
it against the **staging** project/spreadsheet as part of Stage A/E
(restore a `.gs` file from Apps Script's own version history, reactivate
a prior Web App deployment version) before it is ever needed against
production. If invoked against production, follow `ROLLBACK_PLAN.md`
exactly — every step there is non-destructive by design (see its "No
destructive rollback step exists in this plan" section).

---

## Summary: what changes where

| Stage | What gets touched | Reversible? |
|---|---|---|
| 0 | nothing (read-only, local) | n/a |
| A–E | a throwaway copy of the GAS project + a throwaway spreadsheet | Yes, freely — delete and redo |
| G–H | real `Code.gs` + 4 new `.gs` files, real `Config` sheet (+17 keys), real `PROJECT_MASTER`/`WBS`/`RESOURCE_ALLOCATION`/`ORG_STRUCTURE` (new, empty until used), real GitHub Pages `PSP_API_URL` (only if the URL changed) | See `ROLLBACK_PLAN.md` — code/config is fully reversible; any real project data entered *after* go-live is not something a code rollback should delete |

Migration (`migrateLegacyProjects` against real data, Stage G/H) is the
one step in this runbook that writes real historical data, and while it
is technically re-runnable/idempotent, it should still get the same
deliberate second-pair-of-eyes treatment as the rest of Stage F, even
though it can be re-run safely.
