# Deployment Runbook — Phase 2 through Phase 5.3 → Real Google Apps Script

**Status: nothing below has been executed. The real production Apps
Script backend has NOT been modified or deployed by this repository at
any point through Phase 5.3.** This is a literal, ordered checklist for a
human operator to execute manually, in four clearly separated stages:

- **A. Local / repository verification** — nothing here touches Google at all.
- **B. GAS test-environment deployment** — a throwaway copy of the project and spreadsheet.
- **C. Production deployment** — the real Apps Script project and spreadsheet.
- **D. Rollback** — see `ROLLBACK_PLAN.md` (kept as its own document since it applies to both B and C).

Do not skip stage A or B.

## Before you start

Read `PRODUCTION_READINESS_AUDIT.md` and `PHASE5.3_PRE_PRODUCTION_REPORT.md`
in full. If the release gate in the latter is not 🟢 GO or 🟡 GO WITH
CONDITIONS, stop here.

---

## A. LOCAL / REPOSITORY VERIFICATION

Entirely offline — no Google account, no GAS project, no spreadsheet
involved. Confirms the release candidate itself before anyone touches
Google.

### A1. Confirm a clean, reviewed release candidate

- `git status` shows a clean working tree on the branch being released.
- `diff backend/legacy/Code.gs backend/production/Code.gs` shows only the
  documented additive hunks (one mechanical comma on the `CONFIG` line,
  pure `case`/setup-call insertions) — no other line differs.
- Run every test suite in `backend/production/test/` plus
  `backend/test/smoke-test.js`. Expected baseline at time of writing:
  **233/233 passed, 0 failed** (see `PHASE5.3_PRE_PRODUCTION_REPORT.md`
  for the exact per-suite counts current as of this branch).

Only proceed to stage B once A1 is clean.

---

## B. GAS TEST-ENVIRONMENT DEPLOYMENT

### M1. Backup current GAS project

In the real Apps Script editor: File → Make a copy (or use `clasp` if the
project is already source-controlled that way). Keep the copy's URL —
this is your restore point for `Code.gs` and any other live `.gs` files.

### M2. Backup current production Spreadsheet

In Google Sheets: File → Make a copy, or File → Download → keep an
offline copy. This is your restore point for `Team`, `Projects`,
`DailyLogs`, `SupportJobs`, `GlobalSupport`, `Config`, and any data
already in `PROJECT_MASTER`/`WBS`/etc. if a partial rollout already
happened.

### M3. Create a test/copy Spreadsheet

Use the copy from M2, or make a fresh copy of the real spreadsheet
specifically for testing. **Never point the test GAS project at the real
production spreadsheet.**

### M4. Create a test GAS deployment

Either use the backup project from M1 directly, or create a brand-new
Apps Script project bound to the test spreadsheet from M3.

### M5. Add production `.gs` files (test project only)

Copy into the test Apps Script project, in this order (order does not
technically matter to GAS's shared global scope, but this order matches
how they were built and tested):
1. `backend/production/Code.gs` (replaces the test project's `Code.gs`)
2. `backend/production/ProjectMaster.gs` (new file)
3. `backend/production/WbsWorkload.gs` (new file)
4. `backend/production/Organization.gs` (new file)
5. `backend/production/Reporting.gs` (new file)

### M6. Verify `appsscript.json`

**There is no `appsscript.json` tracked for `backend/production/`** in
this repository (only `backend/appsscript.json`, which belongs to the
superseded Phase 1 scaffold — do not use it). Open the test project's own
manifest (Project Settings → "Show appsscript.json manifest file" if not
already visible) and confirm:
- `webapp.access` is set to the value the real project already uses
  (this system assumes an anonymous-frontend, token-based model — do not
  change access control here)
- `webapp.executeAs` matches the real project
- `timeZone` is `Asia/Jakarta` (assumed throughout the code, e.g.
  `Utilities.formatDate(..., 'Asia/Jakarta', ...)`)
- `runtimeVersion` is `"V8"` (required — the code uses `const`/`let`/
  template literals in `Code.gs` and was verified against V8 syntax only)

### M7. Run `setupSpreadsheet()` — TEST ONLY, first

In the test Apps Script editor, run `setupSpreadsheet()` manually once.
Expected effect (idempotent, additive-only, verified this phase by
running it twice against seeded data): creates `PROJECT_MASTER`, `WBS`,
`RESOURCE_ALLOCATION`, `ORG_STRUCTURE` if absent; appends 17 Config keys
if absent; does not touch any existing sheet or row.

### M8. Verify every sheet

Open the test spreadsheet and confirm: `Team`/`Projects`/`DailyLogs`/
`SupportJobs`/`GlobalSupport` are unchanged from the backup (M2);
`PROJECT_MASTER`/`WBS`/`RESOURCE_ALLOCATION`/`ORG_STRUCTURE` now exist
with the correct headers (27/23/8/13 columns respectively — see
`SCHEMA_AUDIT.md`).

### M9. Verify Config

Open the `Config` sheet. Confirm all 17 new keys are present (see
`SCHEMA_AUDIT.md` for the full list) with their documented defaults, and
that `MANAGEMENT_BASELINE_ADDITIONAL_MP` (pre-existing, Phase 3) is
**unchanged** from whatever value it already held.

### M10. Run an authentication smoke test

Deploy the test project as a Web App (new deployment, test URL). From a
REST client (or `curl`), confirm:
- `login` with a real `Team` name + correct PIN returns a token
- the same call with a wrong PIN, 5 times, then locks the account
- a call to any protected action (e.g. `bootstrap`) without a token
  returns `authError:true`
- the same call with a garbage token also returns `authError:true`

### M11. Run an API smoke test

Against the test deployment URL, exercise at minimum: `bootstrap`,
`addProjectMaster` (create a throwaway test project), `createWBS`,
`saveResourceAllocation`, `getWorkloadSummary`, `getExecutiveDashboard`,
`getExternalWeeklyReport`. Confirm every response has `ok:true` and a
shape matching `API_CONTRACT_MATRIX.md`. For the full 25-item checklist
(with expected results and evidence fields to fill in), use
`PHASE5.3_PRE_PRODUCTION_REPORT.md`'s "Deployment Smoke-Test Checklist"
section — this is the minimum subset, that is the complete one.

### M12. Run a migration dry-run

Call `migrateLegacyProjects` **against the test spreadsheet only**.
Confirm the counts match `PRODUCTION_READINESS_AUDIT.md`'s Part E
dry-run report shape: `migrated` = the test spreadsheet's real legacy
`Projects` row count, `skipped` = 0 on the first run. Call it a second
time and confirm `migrated: 0`, `skipped` = the same count as before.

### M13. Run migration only after explicit approval

Do not migrate the **real production spreadsheet** until a human has
reviewed the test-environment dry-run result from M12 and explicitly
approved proceeding. Migration is additive and idempotent (verified this
phase), but it is still the first write to real historical data — treat
it as a one-way door worth a second pair of eyes, even though it can be
re-run safely.

### M14. Connect a GitHub Pages frontend to the test GAS URL

Take a separate checkout of `index.html`/`js/app.js`, change
`PSP_API_URL` in `js/app.js` to the test deployment's `/exec` URL, and
serve it locally or from a throwaway GitHub Pages branch. **Do not point
the real, live GitHub Pages site at the test URL.**

### M15. Verify all pages

Click through every nav item — legacy pages (Dashboard, Projects, Daily
Update, Team) and every Phase 2–5.1 page (Project Control, Resource &
Capacity, Manpower & Capacity, Executive & Reporting). Confirm each loads
without a console error and without an "Aksi tidak dikenal" response.

### M16. Verify read/write operations

From the test frontend: add a test External project, add a WBS row,
allocate an engineer, add an org node — confirm each appears immediately
in the corresponding page and in the test spreadsheet.

### M17. Verify rate limiting

From the test frontend or a script, fire ~65 requests in under a minute
as one logged-in user; confirm the requests beyond 60 return the
"Terlalu banyak permintaan" message, and that a second user is
unaffected.

### M18. Verify rollback procedure

Before touching production, **rehearse** `ROLLBACK_PLAN.md`'s steps
against the test project/spreadsheet — restore `Code.gs` from the M1
backup, confirm the test frontend (pointed at legacy-only actions) still
works. This proves the rollback plan is real, not theoretical.

---

## C. PRODUCTION DEPLOYMENT

Only proceed past this line once every step in stage B has passed in the
test environment and a human has explicitly approved production
deployment.

### M19. Deploy production Web App

In the **real** Apps Script project (not the test copy): repeat M5
(add/replace the 5 `.gs` files) and M6 (verify `appsscript.json`) against
the real project. Create a new Web App deployment version (do not
overwrite an existing version in place if avoidable — versioned
deployments make M-N rollback trivial). Run `setupSpreadsheet()` once
against the **real** spreadsheet (same idempotency guarantee verified in
M7, now exercised for real).

### M20. Verify production endpoint

Repeat M10/M11 (auth smoke test, API smoke test) against the new
production Web App URL, using a real but disposable test project (not
real PSP project data) for the write-path checks.

### M21. Freeze release commit/tag

Tag the exact commit deployed (e.g. `git tag production-2026-XX-XX`) so
the deployed state is always traceable back to a specific, reviewed
commit. Update `js/app.js`'s `PSP_API_URL` on the **real** GitHub Pages
site only after M19/M20 pass, and only if the Web App URL actually
changed (redeploying an existing deployment version keeps the same URL).

---

## D. ROLLBACK

See `ROLLBACK_PLAN.md` for the full, non-destructive rollback procedure —
kept as its own document because it applies to unwinding either stage B
(the test environment, freely) or stage C (production, deliberately).
Rehearsing it against the test environment is stage B's own M18, above.

---

## Summary: what changes where

| Environment | What gets touched | Reversible? |
|---|---|---|
| TEST | a copy of the GAS project + a copy of the spreadsheet | Yes, freely — delete and redo |
| PRODUCTION | real `Code.gs` + 4 new `.gs` files, real `Config` sheet (+17 keys), real `PROJECT_MASTER`/`WBS`/`RESOURCE_ALLOCATION`/`ORG_STRUCTURE` (new, empty until used), real GitHub Pages `PSP_API_URL` (only if the URL changed) | See `ROLLBACK_PLAN.md` — code/config is fully reversible; any real project data entered *after* go-live is not something a code rollback should delete |

Migration (`migrateLegacyProjects` against real data) is the one step in
this runbook that writes real historical data, and while it is
technically re-runnable/idempotent, it is called out separately in M13
specifically so it gets a deliberate approval step, not because it is
destructive.
