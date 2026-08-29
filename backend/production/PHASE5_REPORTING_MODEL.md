# Phase 5 — Executive Dashboard + Weekly Report Foundation

Read-only reporting/risk/dashboard layer over the sheets Phases 1-4 already
maintain. See `PROJECT_HEALTH_MODEL.md` for the exact risk/health rule
cascade and `WEEKLY_REPORT_DATA_MODEL.md` for the exact external/internal
report field lists — this document covers the pieces that don't belong in
either of those: the dashboard aggregation, the API surface, the schema
decision, and known limitations.

## Files

- `Reporting.gs` — every Phase 5 handler. No new sheet. Adds four `Config`
  keys via `ensurePhase5Config_()` (`REPORTING_STALE_DAYS`,
  `PROJECT_AT_RISK_DAYS`, `PROJECT_CRITICAL_DAYS`, `OVERLOAD_THRESHOLD_PCT`)
  using the same skip-if-present pattern every prior phase used —
  `MANAGEMENT_BASELINE_ADDITIONAL_MP` is never touched here.
- `Code.gs` — six new `doPost` switch cases (additive, see "API actions"
  below) and one added call, `ensurePhase5Config_();`, in
  `setupSpreadsheet()`, appended after the Phase 4 calls. Nothing else in
  `Code.gs` changed — `diff backend/legacy/Code.gs backend/production/Code.gs`
  still shows only the one pre-existing trailing-comma fix from Phase 2.

## Why no new sheet (schema decision, Part J)

Explained in full in `WEEKLY_REPORT_DATA_MODEL.md`. Short version: every
number Phase 5 reports is either already stored or cheap to derive at read
time from `PROJECT_MASTER`/`WBS`/`RESOURCE_ALLOCATION`/legacy sheets; a
snapshot table would only add a second, driftable copy of the same data.
Prefer read-only aggregation first, as instructed — that's what this phase
does, in full.

## Shared computation (`buildProjectRiskContext_`)

Every Phase 5 handler that needs project/WBS/allocation/log data calls this
once and reuses the result, so the dashboard, the two weekly reports, the
risk list, and the attention list can never report different numbers for
the same underlying data. It also reuses Phase 3/4's own handlers directly
(`handleGetEngineerLoading_`, `handleGetManpowerAnalysis_`,
`handleGetWorkloadSummary_`, `handleGetManpowerBySkill_`) rather than
recomputing capacity/manpower logic a second time.

## Executive Dashboard (`getExecutiveDashboard`)

| Section | Contents |
|---|---|
| `summary.portfolio` | counts by type (external/internal) and by status (rfq/study/quotation/negotiation/po/execution/completed/onHold/cancelled), plus `totalActive` (everything not COMPLETED/CANCELLED) |
| `summary.progress` | `onTrack`/`atRisk`/`delayed` (from `health`), `withoutRecentUpdate`, `nearTargetDate`, `overdue` (from risk flags) |
| `manpower` | `currentMp`, `requiredMp` (`idealMP.exact`), `additionalMp` (indicative, exact), `managementBaselineMp` (always `8` unless management changes the Config value), `managementTargetMp = currentMp + managementBaselineMp`, `utilizationPct`, `capacityGapMd`, counts of overloaded/high-load engineers |
| `workload` | weekly + monthly workload summaries (Phase 3/4, reused), by-skill breakdown, by-engineer loading |
| `globalSupport` | the **External/Global PROJECT_MASTER stream** — active count, breakdown by customer, PO/RFQ/Execution counts, count of external projects needing a customer update (`externalPoStale`) |
| `globalSupportLegacy` | the **actual legacy `GlobalSupport` sheet** (ad-hoc "support to other Musashi plants" log), reported separately with an explicit note — this is the same naming collision flagged in the Phase 1.5 audit; the two are deliberately never merged |
| `irregularJobsTotal` | row count of the legacy `SupportJobs` sheet (all-time, unfiltered by period — the period-filtered breakdown lives in the Internal Weekly Report) |
| `risks` | the full per-project risk list (see `PROJECT_HEALTH_MODEL.md`) |

The management baseline is read straight from `Config` via the existing
Phase 3 `handleGetManpowerAnalysis_` call — Phase 5 adds nothing that could
overwrite it, and `managementTargetMp` is only ever `currentMp + baseline`,
never a replacement for either number.

## API actions added (all read-only, all behind the existing `verifyToken_` + `checkRateLimit_` gate — no new auth code needed)

| Action | Handler |
|---|---|
| `getExecutiveDashboard` | `handleGetExecutiveDashboard_` |
| `getProjectRisks` | `handleGetProjectRisks_` |
| `getProjectsNeedAttention` | `handleGetProjectsNeedAttention_` |
| `getExternalWeeklyReport` | `handleGetExternalWeeklyReport_` |
| `getInternalWeeklyReport` | `handleGetInternalWeeklyReport_` |
| `getReportingPreview` | `handleGetReportingPreview_` (combines the four above, computes nothing new) |

## Testing

`test/phase5-test.js` — 27 checks: dashboard KPI shape and counts
(external/internal/PO/active/completed), risk detection (generic + isolated
overdue / critical-deadline / no-update / normal cases), the attention list's
filter+sort+action-lookup, manpower figures matching a direct
`getManpowerAnalysis` call, the management baseline staying `8` and
untouched by the calculation, the Phase 4 scenario engine staying consistent
with Phase 5's reported current MP, Irregular Job inclusion in both the
dashboard and the internal report, ISO-week/date-range period parsing and
its effect on which `DailyLogs` entries are included, external/internal
report dataset scoping, the exact customer-facing field exclusion list,
cross-report consistency, authentication, real 60/min rate limiting on a
new Phase 5 action, full Phase 1-4 regression, and confirmation that every
Phase 5 action leaves every sheet's row count unchanged (genuinely
read-only). All 6 suites plus the original Phase 1 `smoke-test.js` pass with
zero regressions (121 checks total).

## Known limitations

- **No `WEEKLY_UPDATE` sheet** — weekly detail fields
  (`plannedThisWeek`/`actualThisWeek`/`problem`/`nextAction`) only populate
  for migrated projects with a matching legacy `DailyLogs` entry in the
  selected period. See `WEEKLY_REPORT_DATA_MODEL.md` for the full
  explanation; this is a documented gap, not a bug.
- **`groupedBy.country`** in the External Weekly Report is actually grouped
  by `Customer` (e.g. "Musashi Vietnam") — there is no separate country
  field in `PROJECT_MASTER`. Kept as `country` to match the requested
  report shape, with the real source noted here.
- **Risk/health thresholds are opinionated defaults**, same status as the
  Phase 3 capacity parameters — editable in `Config`, not derived from real
  historical PSP data (none was available to calibrate against).

## Production integration steps

1. In the Apps Script editor, add `Reporting.gs` as a new file in the same
   project as `Code.gs`/`ProjectMaster.gs`/`WbsWorkload.gs`/`Organization.gs`.
2. Deploy the updated `Code.gs` (six new switch cases + the
   `ensurePhase5Config_();` call).
3. Run `setupSpreadsheet()` once from the editor — it only appends the four
   new Config keys (skip-if-present) and touches nothing else.
4. Verify in the `Config` sheet that `REPORTING_STALE_DAYS`,
   `PROJECT_AT_RISK_DAYS`, `PROJECT_CRITICAL_DAYS`, `OVERLOAD_THRESHOLD_PCT`
   now exist and `MANAGEMENT_BASELINE_ADDITIONAL_MP` is unchanged.
5. Smoke-test each of the six new actions against the real spreadsheet with
   a valid token before wiring the frontend to them.
