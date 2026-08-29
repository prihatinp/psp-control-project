# Rollback Plan — Phase 2 through Phase 5.1 Deployment

Every step here is non-destructive by design. Nothing in this plan
deletes real project data; it only reverts code, config, and (optionally)
the frontend's target URL.

## What files need restoring?

- The real Apps Script project's `Code.gs` → restore from the M1 backup
  (`DEPLOYMENT_RUNBOOK.md`) or from Apps Script's own built-in version
  history (File → See version history, available on every Apps Script
  project regardless of this repo).
- `ProjectMaster.gs`, `WbsWorkload.gs`, `Organization.gs`, `Reporting.gs`
  → simply delete these 4 files from the Apps Script project. They are
  new files with no legacy equivalent; removing them cannot corrupt
  anything `Code.gs` needs, **provided `Code.gs` is rolled back to its
  pre-deployment version first** (rolling back the files out of order —
  removing the new `.gs` files while the additive `Code.gs` still
  references their functions — would break `doPost`'s new `case`
  branches; harmless in practice since those branches would simply throw
  a "function not defined" error caught by `doPost`'s own try/catch and
  returned as a generic server error, not a security or data-loss issue,
  but restore `Code.gs` first anyway to avoid it).

## What deployment version needs restoring?

Apps Script Web App deployments are versioned. If M19 created a **new**
deployment version rather than overwriting an existing one (the
recommended approach in `DEPLOYMENT_RUNBOOK.md`), rollback is simply:
Deploy → Manage deployments → select the previous version → set it as
active again. The Web App URL for a "head" deployment can also be
repointed without creating a new version if the deployment type used
supports it. **This is the fastest, safest rollback path — prefer it over
editing code back by hand.**

## What Spreadsheet changes can be rolled back?

- **`Config`'s 17 new keys** (Phase 3–5.1): safe to delete manually if
  desired — every reader (`getConfigNum_`/`getConfigList_`) has an
  explicit in-code fallback default and does not throw if a key is
  missing. Deleting them does not break the legacy system at all (legacy
  code never reads them) and only affects Phase 2–5.1 features, which
  would be rolled back anyway.
- **`PROJECT_MASTER`/`WBS`/`RESOURCE_ALLOCATION`/`ORG_STRUCTURE` sheets**:
  if rollback happens before any real user data was entered into them,
  simply delete the sheets (or leave them — an unused sheet with only a
  header row is harmless and invisible to the legacy system). **If real
  user data was already entered** (a real External project, a real WBS
  breakdown, etc.) — see "How to preserve PROJECT_MASTER/WBS data during
  rollback" below. Do not delete these sheets once they hold real data
  without a deliberate, separate decision to do so.
- **`Team`/`Projects`/`DailyLogs`/`SupportJobs`/`GlobalSupport`**: never
  written to by Phase 2–5.1 code except the explicitly-scoped,
  additive-only `migrateLegacyProjects` action. Rolling back the code
  changes nothing here on its own.

## Which migration operations are irreversible?

**None, technically** — `migrateLegacyProjects` only ever writes new rows
to `PROJECT_MASTER`; it never modifies or deletes anything in the legacy
`Projects` sheet (verified byte-for-byte in this phase's tests). "Rolling
back" a migration means deleting the migrated `PROJECT_MASTER` rows
(identifiable by a non-empty `LegacyProjectId` column) — this is a
reversible **delete**, not an unwind of a destructive operation, because
the source data it was copied from was never touched.

The one thing that is **not** reversible by this system is: if a user
edited a migrated `PROJECT_MASTER` row after migration (e.g. filled in
`Customer`/`Country`, changed `Status`), deleting that row to "undo the
migration" would lose that manual edit too. This is a normal
data-management consideration, not a defect — decide per-row before
bulk-deleting migrated records.

## How to disable the new frontend without deleting backend data?

Two independent options, from least to most disruptive:
1. **Hide the new nav groups**: comment out or remove the "Project
   Control", "Resource & Capacity", "Manpower & Capacity", and
   "Executive & Reporting" `<div class="nav-group">` blocks in
   `index.html`. The backend keeps running and keeps its data; users
   simply can't navigate to the new pages. Fully reversible (just
   uncomment).
2. **Revert `index.html`/`js/app.js` to their pre-Phase-2 commit** for
   the live GitHub Pages site specifically, while leaving the Apps
   Script backend fully deployed. Since every Phase 2–5.1 backend action
   is purely additive, the legacy-only frontend continues to work against
   the upgraded backend without any compatibility issue (this is the same
   property that made every phase's own regression suite pass throughout
   this project).

## How to return frontend to legacy API?

If the **backend** itself needs to be rolled back (not just the
frontend): once `Code.gs` is restored to its pre-deployment version (see
above), the existing legacy-only frontend already calls only legacy
action names (`login`, `bootstrap`, `addProject`, `saveDailyLog`,
`markStage`, `undoStage`, `saveSupportJob`, `saveGlobalItem`,
`teamNames`) — no frontend change is required for it to keep working
against a rolled-back backend. Only revert `index.html`/`js/app.js` too
if the new pages should stop being *visible* (see previous section);
they will simply show "Aksi tidak dikenal" errors if left visible against
a rolled-back backend, which is safe (no crash, no data corruption — see
`PRODUCTION_READINESS_AUDIT.md` Part K) but confusing to a user, so doing
both together is recommended.

## How to preserve PROJECT_MASTER/WBS/etc. data during rollback?

If a rollback is needed **after** real Phase 2–5.1 data already exists
(real External/Internal projects, WBS breakdowns, org structure):
1. Make a full copy of the spreadsheet first (same as `DEPLOYMENT_RUNBOOK.md`
   M2) — this preserves everything regardless of what happens next.
2. Roll back `Code.gs` and remove the 4 new `.gs` files as described
   above. This stops any *new* writes through the new API actions but
   does not touch existing sheet data.
3. Leave `PROJECT_MASTER`/`WBS`/`RESOURCE_ALLOCATION`/`ORG_STRUCTURE`
   exactly as they are. They are inert to the legacy system (never read
   by legacy code) and hold real user data that should not be deleted
   just because the newer features are being paused.
4. When re-deploying the Phase 2–5.1 code later (a "roll-forward"), it
   will find its sheets already populated and pick up exactly where it
   left off — `setupSpreadsheet()` is additive/idempotent and will not
   duplicate or disturb the preserved data (verified this phase).

## No destructive rollback step exists in this plan

Every action above is either a pure code/config revert (Apps Script
version history, deleting unused files, deleting empty or clearly
migration-only rows) or an explicit, separately-decided data operation
that a human must choose to do — nothing here is an automatic `DELETE`
against real user-entered data.
