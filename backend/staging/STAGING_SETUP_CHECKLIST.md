# Staging Setup Checklist — Real Google Apps Script Test Environment

This checklist is for a **human operator** to execute manually. Nothing
in this document is executed by the coding agent — it has no access to
Google Apps Script, Google Sheets, or any Google account (confirmed in
`PHASE5.4_REAL_GAS_VERIFICATION_REPORT.md`). Every step below requires a
real Google account and browser session.

**No secret, PIN, spreadsheet ID, or deployment URL should ever be
committed to this repository.** Where a step produces one, the
instruction says so explicitly — write it down somewhere outside git
(a password manager, a private note), not in a file that gets committed.

---

## A. Create a NEW Google Apps Script project

Go to [script.google.com](https://script.google.com) → New project. Name
it clearly, e.g. `PSP Project Control — STAGING`, so it can never be
confused with the real production project in a project list.

## B. Do NOT use the production project initially

**This entire checklist targets the new staging project from step A.**
Do not open, edit, or deploy from the real production Apps Script project
at any point in this checklist. Production is only touched after every
step below passes and a human has given explicit approval
(`DEPLOYMENT_RUNBOOK.md` Stage F).

## C. Upload/copy the 5 `.gs` files

In the staging project's editor, create (or replace the default
`Code.gs` with) these 5 files, copying content verbatim from
`backend/staging/` in this repository (already an exact, byte-identical
copy of `backend/production/*.gs` — verified by this repository's own
tooling before this checklist was written):

1. `Code.gs`
2. `ProjectMaster.gs`
3. `WbsWorkload.gs`
4. `Organization.gs`
5. `Reporting.gs`

Order does not matter to Apps Script's shared global scope (all files in
one project see each other's top-level functions/constants), but this
order matches how they were built and tested in this repository.

## D. Configure `appsscript.json`

In the staging project: Project Settings → check "Show `appsscript.json`
manifest file in editor" → open it → replace its contents with
`backend/staging/appsscript.json` from this repository verbatim:

```json
{
  "timeZone": "Asia/Jakarta",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "access": "ANYONE_ANONYMOUS",
    "executeAs": "USER_DEPLOYING"
  }
}
```

This matches the architecture the entire codebase assumes: an anonymous
frontend (no Google login required by end users — auth is the app's own
HMAC token system) executing as the script's deploying account (so it
can always reach the bound spreadsheet regardless of who is calling).
**Do not change `access`/`executeAs` unless you deliberately intend a
different security model** — this is a real, consequential setting, not
a cosmetic one.

## E. Run `setupSpreadsheet()`

Bind the staging project to a **brand-new, empty spreadsheet** (Apps
Script: Resources → or simply run any function once and it will prompt
to create/bind one, depending on how the project was created — a
container-bound script created from within a new Sheet is the simplest
path). In the editor, select the `setupSpreadsheet` function from the
function dropdown and click Run.

Expected effect (verified additive/idempotent against a mock this
repository's own test suite, but never yet against a real spreadsheet):
creates `Team`, `Stages`, `Phases`, `Config`, `Projects`, `DailyLogs`,
`SupportJobs`, `GlobalSupport` (legacy sheets, with their original seed
data), then `PROJECT_MASTER`, `WBS`, `RESOURCE_ALLOCATION`,
`ORG_STRUCTURE` (Phase 2–4 sheets), appends 17 `Config` keys, and
generates an `HMAC_SECRET` in Script Properties if one doesn't exist yet.

The first run will prompt for authorization (this script needs
permission to access the spreadsheet, Script Properties, and
CacheService/LockService) — review and accept as the deploying account.

## F. Verify the generated spreadsheet

Open the bound spreadsheet. Confirm exactly these 12 sheet tabs exist,
no more, no fewer: `Team`, `Stages`, `Phases`, `Projects`, `DailyLogs`,
`SupportJobs`, `GlobalSupport`, `Config`, `PROJECT_MASTER`, `WBS`,
`RESOURCE_ALLOCATION`, `ORG_STRUCTURE`. Confirm the legacy sheets
(`Team` through `GlobalSupport`) contain their seed data — see
`backend/production/SCHEMA_AUDIT.md` for what each sheet should contain.

## G. Verify `Config`

Open the `Config` sheet. Cross-check its `Key` column against
`backend/production/SCHEMA_AUDIT.md`'s `Config` entry — all 17 keys
(`EXTERNAL_PROJECT_STATUS_LIST` through `OVERLOAD_THRESHOLD_PCT`) should
be present, each exactly once, alongside the two pre-existing legacy keys
(`LOGIN_PIN`, `SUPPORT_CAPACITY_MANDAY_PER_WEEK`).

**Check `Config!LOGIN_PIN` specifically.** If its value is `psp2026`
(the legacy default seeded by `backend/legacy/Code.gs` itself), this is
expected on a **freshly created staging spreadsheet** — record it as:

> LEGACY DEFAULT ACTIVE — ROTATION REQUIRED (before any production use)

Do not rotate it automatically or as part of this checklist unless you
are deliberately testing the rotation procedure itself. Do not write
this value (default or rotated) into any file in this repository.

## H. Verify `Team`

Confirm the `Team` sheet has `Name`/`Role`/`Skill` columns and the
expected seed rows (per `backend/production/SCHEMA_AUDIT.md`). This
sheet drives every "Current MP" calculation in the system — an empty or
wrong `Team` sheet will make every capacity/manpower page show 0 or
nonsensical figures, which is expected and correct behavior for an
empty staging sheet, not a bug.

## I. Verify all new sheets

Open `PROJECT_MASTER` (expect exactly 27 header columns, ending in
`...,LegacyProjectId,Country`), `WBS` (23 columns), `RESOURCE_ALLOCATION`
(8 columns), `ORG_STRUCTURE` (13 columns). Compare header names,
left-to-right, against `backend/production/SCHEMA_AUDIT.md`'s exact
column lists for each sheet. All four should have a header row only —
zero data rows — on a fresh staging spreadsheet.

## J. Deploy as a TEST Web App

Deploy → New deployment → type "Web app" → description e.g. "staging
v1" → Execute as: matches `appsscript.json`'s `executeAs` → Who has
access: matches `appsscript.json`'s `access`. Click Deploy, authorize if
prompted, and copy the resulting Web App URL (`.../exec`).

**Do not commit this URL to the repository.** See `backend/staging/staging-smoke-test.js`'s own instructions for how to supply it locally via an environment variable instead.

## K. Record deployment ID/version

Deployments → Manage deployments shows the deployment ID and version
number for what you just created. Write these down somewhere outside
this repository (they are not secret, but they're staging-environment
housekeeping, not repository content) — you'll need them again for
`DEPLOYMENT_RUNBOOK.md` Stage A/B and for any later rollback.

## L. Test the API

Run `backend/staging/staging-smoke-test.js` from a normal local Node
environment (see that file's own header comment for exact invocation),
supplying the URL from step J via the `STAGING_WEB_APP_URL` environment
variable. It exercises the 25 items listed in this phase's brief against
the real deployed endpoint and reports PASS/FAIL/UNVERIFIED for each —
never collapsing an inconclusive result into PASS.

## M. Test the frontend against staging

See `backend/staging/PHASE5.5_STAGING_ACCESS_GUIDE.md` and the "Frontend
Staging Configuration" note below for the exact, non-committing procedure
(a browser `localStorage` override, not a code or URL change committed to
this repository). Click through every page and confirm no console error
and no "Aksi tidak dikenal" response.

## N. Test concurrent writes

Run `backend/staging/concurrency-test.js` against the same staging
deployment (never production). This is the one property no mock in this
repository can ever prove — see that file's own comments for exactly
what it does and why it matters.

## O. Test rollback

Rehearse `backend/production/ROLLBACK_PLAN.md` against this staging
project and spreadsheet specifically — delete/replace a `.gs` file,
confirm Apps Script's own version history can restore it; confirm a
prior Web App deployment version can be reactivated via Manage
deployments. This proves the rollback plan is executable, not just
documented, before it is ever needed for real.

---

## Frontend Staging Configuration (non-committing)

`js/app.js`'s `PSP_API_URL` constant checks a browser `localStorage` key
before falling back to its committed production URL — this is the "safe
configuration mechanism" from this phase's brief. To point your browser
at staging, open the site, open the browser console, and run:

```js
localStorage.setItem('psp_staging_api_url', 'PASTE_YOUR_STAGING_URL_HERE');
location.reload();
```

To go back to production behavior in that browser:

```js
localStorage.removeItem('psp_staging_api_url');
location.reload();
```

This never touches any committed file — it is per-browser, per-device,
and leaves the repository's default (production) URL completely
untouched for everyone else.
