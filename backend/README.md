# PSP Project Control — Backend

## Folder status (read this first)

| Folder | Status | Use it for |
|---|---|---|
| `backend/legacy/` | **Authoritative reference.** A pristine, unmodified copy of the real production `Code.gs`, as supplied directly by the project owner. Never edit this file — it exists so every later change can be diffed against real ground truth. | Confirming what the live system actually does. |
| `backend/production/` | **Current Phase 2 deployable extension.** `Code.gs` here = the file above + 3 additive edits (documented inline with `Phase 2 addition` comments); `ProjectMaster.gs` is new. This is what should eventually be pasted into the real Apps Script project, replacing its `Code.gs` and adding `ProjectMaster.gs` as a new file — **not yet done**, pending your review. | The next real deployment. |
| `backend/gas/` | **Superseded scaffold from Phase 1.** Written *before* the real legacy source was available, on assumptions later proven wrong (see the Phase 1.5 audit) — different PIN model, no `LockService`, wrong ID format, wrong Script Property names. Kept only for history; do not deploy it, do not treat it as a basis for new work. | Nothing — historical record only. |

Nothing under `index.html`, `css/`, `js/`, or `img/` at the repo root was
touched by Phase 1; Phase 2 makes small, additive, documented edits to
`index.html` and `js/app.js` (new nav items/pages/functions only — every
existing element, function, and API call is unchanged). The frontend
keeps calling whatever Apps Script Web App URL is already configured in
`js/app.js`'s `PSP_API_URL`.

---

# Phase 1 Foundation — original notes below (superseded by the above table for anything about `backend/gas/`)

## What this is

A modular Google Apps Script backend, reconstructed from two sources:

1. **PRD Rev D** (Rev D architecture reconciliation, approved) — the new
   entities and rules (Irregular Job, Organization, MP Baseline, etc.).
2. **The existing frontend's own contract** (`js/app.js`) — the exact
   request/response shape for `teamNames`, `bootstrap`, `login`,
   `addProject`, `saveDailyLog`, `saveSupportJob`, `saveGlobalItem`,
   `markStage`, `undoStage`. This is a reconstruction from what the
   client sends and expects back, **not** a copy of the real production
   `Code.gs`, which was not recoverable in this session (no Google
   account access here — see "Phase 1A" below).

**Do not point this at the production spreadsheet or swap it into the
live Web App deployment.** It needs the manual verification in Phase 1A
first.

## Phase 1A — what you need to retrieve manually

I could not access your Google account or the live Apps Script project
in this session, so the following must be retrieved and verified by
someone with access, before any cutover:

1. Open the Apps Script project behind the URL in `js/app.js`
   (`PSP_API_URL`, currently ending in `.../exec`) at script.google.com.
2. Export/copy the full source of every `.gs` file there, and `appsscript.json`.
3. Note the **Deployment** settings: deployment ID(s), execute-as /
   access settings.
4. Find the **Google Sheet ID** the script reads/writes (usually via
   `SpreadsheetApp.openById('...')` or a bound sheet).
5. For every tab in that Sheet, record the **exact name and column
   order** — this backend assumes tabs named `Team`, `Stages`, `Phases`,
   `Projects`, `DailyLogs`, `SupportJobs`, `GlobalSupport` with columns
   matching the JSON field names already visible in `js/app.js`
   (e.g. `id`, `no`, `name`, `line`, `pic`, `support`, `category`,
   `start`, `target`, `progressStage`, `stageDates`, `note` for
   Projects). **Verify this against the real sheet before relying on it.**
6. Find where the **PIN** is stored and how it's checked (plaintext
   column? hashed?) and how the **auth token** is generated/verified
   (HMAC? what secret, where stored, what expiry?). `backend/gas/Auth.gs`
   in this folder currently assumes a plaintext `pin` column on `Team`
   and issues its own HMAC token — **this must be reconciled with the
   real mechanism**, not silently replaced, or existing users' PINs may
   stop working.
7. List any **Script Properties** already in use (secrets, thresholds).
8. List any other **triggers, quotas, or external calls** configured on
   the project.

None of this should ever be pasted into a GitHub commit. Keep the actual
secret values only in Apps Script's Script Properties.

## Setup (once Phase 1A is verified, or for a fresh test copy)

1. Create a **new** Apps Script project (or use a **copy** of the
   production spreadsheet + a **new** script project for the first test
   — do not touch production yet).
2. Copy the files in `backend/gas/*.gs` and `backend/appsscript.json`
   into that project.
3. In **Project Settings → Script Properties**, set:
   - `SHEET_ID` — the ID of the spreadsheet this backend should use.
   - `AUTH_SECRET` — any long random string (used to sign login tokens).
4. In the Apps Script editor, select `setupSchema` from the function
   dropdown and click **Run** once. This creates the 15 Rev D sheets
   (see `backend/SCHEMA.md`) with header rows and seeds `CONFIG` +
   a root `ORG_NODE` row. It is additive and idempotent — it never
   touches a sheet that already exists, and running it again is a no-op.
5. Deploy as a Web App (or run through the Apps Script "Test deployments"
   flow) **pointed at the test spreadsheet**, and confirm the actions in
   `backend/gas/Router.gs` behave as expected before considering any
   change to the production deployment.

## Local testing (no Google account needed)

`backend/test/` mocks just enough of the Apps Script runtime
(`SpreadsheetApp`, `PropertiesService`, `Utilities`, `ContentService`) to
run the actual `.gs` source in plain Node and exercise the logic:

```
node backend/test/smoke-test.js
```

This proves the routing, auth, schema, and business-rule logic is
internally consistent (all 17 checks currently pass). It does **not**
prove the real Google Sheet/Apps Script project will behave identically
— run the manual UAT checklist below in the actual Apps Script editor
before ever pointing production traffic at this code.

## Manual UAT checklist (run in the real Apps Script editor/test deployment)

- [ ] `setupSchema()` run against a **copy** of the production sheet — confirm no existing tab was renamed, reordered, or had rows altered.
- [ ] `teamNames` / `login` / `bootstrap` return the same shape the existing frontend already expects (compare against a live production response if you can capture one).
- [ ] `addProject`, `saveDailyLog`, `markStage`, `undoStage`, `saveSupportJob`, `saveGlobalItem` each still work against the real `Team`/`Projects`/`DailyLogs`/etc. sheets once the column-name assumptions above are confirmed or corrected.
- [ ] A wrong PIN is rejected; a correct PIN returns a token that `bootstrap` accepts.
- [ ] `addIrregularJob` rejects a category not listed in `CONFIG.IRREGULAR_JOB_CATEGORIES`.
- [ ] `setMpBaseline` is rejected for a non-management role and succeeds for one; `getMpPlanningView` never shows the baseline changed by anything other than an explicit `setMpBaseline` call.
- [ ] Every write above produces a row in `AUDIT_LOG`.

## Why this structure

Router-only `Code.gs`, one service file per domain, one shared
`Repository.gs` for all Sheet I/O — see the PRD Rev D architecture
reconciliation for the full rationale. `AuditService.gs` is called from
every mutating action per the locked decision that `AUDIT_LOG` is a core
foundation entity, not an afterthought.
