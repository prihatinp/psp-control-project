# Phase 5.1 — Reporting Calibration & Hardening: Final Report

Scope: validate and harden the Phase 5 reporting foundation (Executive
Dashboard, Project Risk Engine, Weekly Reports) before it becomes the basis
for the Weekly Management Report, Global Customer Weekly Report, Excel
export, and PowerPoint export. No redesign, no new production deployment,
no invented data. This report covers all 13 parts of the brief.

## 1. Weekly Report Data Gap

Analyzed whether `DailyLogs` alone is sufficient for customer-facing weekly
reporting. **Finding: it is not, and the gap is structural and growing** —
`DailyLogs` only ever joins to `PROJECT_MASTER` via `LegacyProjectId`, which
is empty for every project created since Phase 2. Full comparison of
Option A (DailyLogs only) / B (new `WEEKLY_UPDATE` sheet) / C (hybrid) is in
`WEEKLY_UPDATE_DESIGN_REVIEW.md`. **Recommendation: Option C (Hybrid)** is
the correct target architecture, but **not implemented in this phase** —
building it belongs to whichever future phase implements the Weekly
Management Report / Global Customer Weekly Report, since those are the
features that actually need it. A related, smaller bug found during this
audit — the DailyLogs "latest entry" join picked by sheet insertion order,
not by date — **was fixed** (`latestLogInPeriod_`), independent of the
WEEKLY_UPDATE question.

## 2. Customer / Country / Plant Data Model

**Real bug found and fixed.** `PROJECT_MASTER` had `Customer` and `Plant`
columns but no `Country` column at all, and the External "Add New" form
only ever collected one free-text field ("Customer / Plant", e.g. "Musashi
Vietnam") into `Customer`. `Reporting.gs`'s `groupedBy.country` then grouped
by that same `Customer` value — "country" in every report was really
"customer" in disguise.

Fix (additive, no data invented):
- Added a genuine `Country` column to `PROJECT_MASTER` (appended last, same
  pattern as `LegacyProjectId`), with `ensureProjectMasterCountryColumn_()`
  to add it to an already-provisioned real sheet without touching existing
  data (`ensureHeader_` alone cannot add a column to a non-empty sheet).
- `addProjectMaster`/`updateProjectMaster`/`projectMasterRowToObj_` now
  read/write/expose `country` as its own field, sanitized like every other
  string field.
- `groupedBy` in the External Weekly Report now has genuinely separate
  `customer` and `country` buckets; `Executive Dashboard`'s `globalSupport`
  now reports `byCustomer` and `byCountry` separately.
- Added an optional "Country" input to the External Add New form (existing
  "Customer / Plant" field left untouched — additive, not a redesign).
- Existing rows get a blank `Country` — **never guessed** from
  Customer/Plant, per the "do not invent data" constraint.
- 7 regression tests in `phase5.1-test.js` Part 1/2, plus the
  `ensureProjectMasterCountryColumn_` migration itself tested against a
  simulated pre-existing 26-column sheet.

The legacy `GlobalSupport` sheet's own `Country` column (which historically
stores plant-level values like `"Musashi Vietnam"`, the same conflation)
was **left untouched** — it is real, already-collected production data in
a sheet outside this phase's scope, not something to silently rename.
Documented as a known, separate legacy quirk (see Known Limitations).

## 3. Project Health Calibration

Verified GREEN/YELLOW/ORANGE/RED/GRAY are deterministic and that every
result has a clear, code-matching reason — one fixture per color in
`phase5.1-test.js` Part 3, each asserting the exact `primaryReasonKey` and
`primaryReason` text. No numeric threshold was changed. `PROJECT_HEALTH_MODEL.md`
rewritten to document the new `primaryReasonKey`/`primaryReason`/
`primarySource` fields and the corrected "closed project" exemption list
(see item 4). Confirmed no "AI"/"prediction" wording anywhere in risk
output — it is a deterministic, rule-based control indicator only.

## 4. Risk Engine Audit

Audited `getProjectRisks`/`getProjectsNeedAttention` rule by rule (overdue,
stale update, ON HOLD, missing WBS, missing Man-Day, engineer overload, PO
approaching target, missing critical data) — one isolated test per rule in
`phase5.1-test.js` Part 4. Two real bugs found and fixed:

1. **`recommendedAction` mismatch (the main finding).** The action shown
   was looked up from `reasonKeys[0]` — the first flag evaluated in source
   order — not the flag that actually determined the assigned `riskLevel`.
   A project that was both `noRecentUpdate` (WATCH-tier) and
   `overloadedEngineer` (the AT-RISK-tier flag that actually won the
   cascade) would show the WATCH-tier action ("ask PIC for an update")
   for a project that was AT RISK because an engineer is overloaded.
   Fixed with `primaryReasonKey`, chosen via a priority list that mirrors
   the cascade's own conditions per level. Regression test proves the fix.
2. **Closed projects could stay WATCH forever.** `noWbs`,
   `wbsWithoutAllocation`, and the new `missingManDay` flag did not check
   `isClosed`, unlike every other "active work" flag (`overdue`,
   `progressBehind`, `poApproaching`, etc.). A COMPLETED project with no
   Phase 3/4 WBS ever created for it (true of most legacy-migrated
   projects, since WBS is newer than they are) would show WATCH/YELLOW
   permanently and never leave the attention list. Fixed by exempting all
   three for closed projects, matching the treatment already given to the
   other "active work" flags.

New rule added: `missingManDay` — a WBS row that has one or more allocation
rows whose Plan Man-Day sums to zero, distinct from `wbsWithoutAllocation`
(no allocation row at all). Every risk record now also carries a `Source`
field (`primarySource`, plus a full `sources` list) naming which sheet(s)
drove each flag. Confirmed structurally that no project can ever produce
two risk records (one risk object per `PROJECT_MASTER` row, by
construction) — tested directly, including a repeated-call determinism
check.

## 5. Management Manpower Baseline

Verified: Current MP, System Required MP, System Indicative Additional MP,
Management Baseline (+8), and Management Target MP are five distinct
fields on the dashboard (`currentMp`, `requiredMp`, `additionalMp`,
`managementBaselineMp`, `managementTargetMp`), all already correctly
wired in Phase 5 — **no bug found here**. Added a direct regression test
that edits `Config!MANAGEMENT_BASELINE_ADDITIONAL_MP` and confirms only
`managementBaselineMp`/`managementTargetMp` change while
`currentMp`/`requiredMp`/`additionalMp` (and the underlying
`indicativeAdditionalMPExact`/`idealMP.exact`) stay exactly the same. Also
confirmed the `+8` literal appearing in `WbsWorkload.gs` is only
`getConfigNum_`'s fallback default, not a hard-coded production value.

## 6. Manpower Scenario Audit

Verified CURRENT/+1/+2/+4/+8 are simulation-only — **no bug found**.
Added an explicit regression test snapshotting `Team`, `ORG_STRUCTURE`,
`PROJECT_MASTER`, and `RESOURCE_ALLOCATION` byte-for-byte before and after
calling `getManpowerScenario` (with real seeded data in all four sheets),
confirming zero mutation across all four — broader than Phase 4/5's
existing Team-only check.

## 7. Workload Reconciliation

Verified PROJECT (External + Internal) + IRREGULAR = TOTAL — **no bug
found**; the underlying computation already sums one bucket total from the
same row set the by-type buckets are filtered from, so they cannot
disagree structurally. Added tests for: a normal small dataset, a
multi-project dataset (5 projects, mixed type), the same engineer allocated
to two different WBS rows in the same period (proving correct additive
summation, not double counting), and a multi-week-spanning activity
(reconciling correctly in both the weekly and monthly view).

## 8. External Customer Data Sanitization

Formalized the existing Phase 5 customer/internal split into an explicit,
enforced contract: `CUSTOMER_REPORT_DATA_CONTRACT.md` documents the exact
`CUSTOMER_VIEW` field list (16 fields, including the new `country`) and the
4 fields excluded (`projectId`, `manDayPlanned`, `manDayActual`,
`riskLevel`). `phase5.1-test.js` Part 8 asserts the exact key set on both
views on every run — any future field added to one side without the other
now fails the test immediately instead of silently leaking or breaking.

## 9. Reporting Period

Audited Monday-Sunday week boundaries, date-range mode, current/previous
week, month crossing, year crossing, and no-activity projects. One real bug
found and fixed here too: `latestLogInPeriod_` used to pick the log at the
end of sheet **insertion order**, not the chronologically latest by date —
a backfilled/out-of-order log entry could silently mask a genuinely later
one. Fixed with a shared, date-sorting helper used by both weekly reports.
Added a computed (not hand-picked) year-boundary test that finds a real
year where ISO week 1's Monday falls in December of the previous year and
verifies `isoWeekToMonday_` handles it correctly. Confirmed a project with
no activity in the selected period still appears in the report with empty
detail fields, rather than being dropped.

## 10. Data Quality Integration

`getDataQualityReport` (already built in Phase 3.1) is now surfaced on the
Executive Dashboard as `dataQuality: {status: 'OK'|'WARNING', totalIssues,
bySeverity}` — a plain, documented rule (`totalIssues > 0 ? 'WARNING' :
'OK'`), computed by calling the existing handler, never a second
computation of the same checks. Confirmed it still fixes nothing (read-only)
and that the count matches `getDataQualityReport` called directly, byte for
byte, in every case.

## 11. Testing

`backend/production/test/phase5.1-test.js` — 45 checks across the 10 audit
areas above. Full suite, run together, zero regressions:

| Suite | Checks |
|---|---|
| Phase 1 (`smoke-test.js`) | 17 |
| Phase 2 | 23 |
| Phase 3 | 27 |
| Phase 3.1 | 17 |
| Phase 3.1 scenario | 5 |
| Phase 4 | 32 |
| Phase 5 | 27 |
| Phase 5.1 | 45 |
| **Total** | **193 passed, 0 failed** |

## 12. Documentation

Created: `WEEKLY_UPDATE_DESIGN_REVIEW.md`, `CUSTOMER_REPORT_DATA_CONTRACT.md`,
this file. Updated: `PROJECT_HEALTH_MODEL.md` (new fields, corrected closed-
project exemption list, the primaryReasonKey regression writeup),
`WEEKLY_REPORT_DATA_MODEL.md` (Country field, groupedBy fix, log-sorting
fix).

## Remaining Limitations

- **No `WEEKLY_UPDATE` sheet.** Still the single biggest limitation for the
  four downstream features this phase exists to prepare for — see item 1.
  Any project created since Phase 2 has zero weekly-update capability until
  Option C is built.
- **Country is blank for all pre-existing External projects.** Never
  backfilled or guessed, by design — it will read `"Unknown"` in every
  grouping until someone edits each project to add it, or a future phase
  does a deliberate, human-approved data cleanup pass.
- **Plant is still never collected by the current Add New form** (only
  `Customer` and, now, `Country`) — a pre-existing gap, not newly
  introduced, and out of this phase's stated scope (it audited the
  Customer/Country conflation specifically, not the separate question of
  Plant's own form wiring). Flagged here for a future pass.
- **Legacy `GlobalSupport.Country` still conflates plant-level names with
  country** — real, already-collected production data in a sheet outside
  `PROJECT_MASTER`'s scope. Left untouched per "do not invent data" / "do
  not redesign existing architecture"; documented, not fixed.
- **Risk/health thresholds remain uncalibrated against real PSP data**
  (same status as noted in `PHASE5_REPORTING_MODEL.md`) — `REPORTING_STALE_DAYS`,
  `PROJECT_AT_RISK_DAYS`, `PROJECT_CRITICAL_DAYS`, and the 20-point
  progress-behind threshold are still reasonable defaults, not derived from
  historical PSP project data (none was available). Recommend revisiting
  once a full quarter of real usage exists to compare flagged projects
  against what PSP management would have flagged manually.

## Recommended Next Architecture

1. Implement `WEEKLY_UPDATE` (Option C, hybrid) as part of whichever phase
   builds the Weekly Management Report / Global Customer Weekly Report —
   not as a standalone phase, since the sheet has no purpose without the
   entry UI and the report that consumes it.
2. Wire a "Plant" field into the External Add New form alongside the new
   "Country" field, completing the three-way split the form started this
   phase.
3. Once real weekly-update data exists, revisit the risk/health thresholds
   (item 9 above) against actual PSP outcomes before Phase 6 or later
   phases build anything that depends on their accuracy (e.g. an
   escalation workflow).
4. Excel/PowerPoint export (named as downstream consumers in this phase's
   objective) should be designed against the `PSP_INTERNAL_VIEW`/
   `CUSTOMER_VIEW` contract in `CUSTOMER_REPORT_DATA_CONTRACT.md` directly —
   it is already shaped as one row per project, ready to serialize.

## What Must Be Calibrated With Real PSP Data

- `REPORTING_STALE_DAYS` / `PROJECT_AT_RISK_DAYS` / `PROJECT_CRITICAL_DAYS`
  (Config) — currently 7/14/3 days, unvalidated against real PSP cadence.
- The 20-percentage-point `progressBehind` threshold (hard-coded in
  `computeProjectRisk_`, not yet a Config key) — worth promoting to Config
  once a real value is agreed, but not changed in this phase (no numeric
  threshold was touched, per the brief).
- `HIGH_LOAD_THRESHOLD_PCT` / `OVERLOAD_THRESHOLD_PCT` (Phase 4/5, 85%/100%)
  — same status.
- Country values for every existing External project — a real data-entry
  task for PSP staff, not something this system can or should infer.

---

PHASE 5.1 STATUS: READY FOR REVIEW
