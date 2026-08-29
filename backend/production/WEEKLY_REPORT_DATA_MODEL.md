# Phase 5 — Weekly Report Data Model (External + Internal)

Both weekly reports are computed on demand from existing sheets
(`PROJECT_MASTER`, `WBS`, `RESOURCE_ALLOCATION`, legacy `DailyLogs`, legacy
`SupportJobs`) — no `WEEKLY_UPDATE`/report-snapshot table exists or was
created. See "Why no new sheet" below for the reasoning this phase's brief
required before implementing (or not implementing) one.

## Reporting period

Accepts, in this priority order (`parseReportingPeriod_`):
1. `{ week: 'YYYY-Www' }` — ISO 8601 week, resolved to that week's Monday..Sunday.
2. `{ startDate, endDate }` — an explicit inclusive date range (`endDate` defaults to `startDate` if omitted).
3. Neither -> defaults to the current ISO week.

The period only filters **legacy `DailyLogs` entries** (via
`PROJECT_MASTER.LegacyProjectId`) into `plannedThisWeek` / `actualThisWeek`
/ `problem` / `nextAction` (the latest log inside the period). It does not
filter which *projects* appear in the report — a project stays listed even
if it has no log entry in the selected period (its weekly-detail fields are
then simply empty strings).

## External Weekly Report (`getExternalWeeklyReport`)

**Scope**: `PROJECT_MASTER` rows where `Type = 'EXTERNAL'` and
`Status` in `[PO, EXECUTION, ON HOLD, COMPLETED]` — the four statuses a
customer-facing report is actually about. Pass `{ allStatuses: true }` to
include every status (internal use, e.g. a full pipeline review).

Every project produces **two rows**, built from the same computation so
they can never disagree with each other or with the dashboard:

### `internal` row (PSP-only — the `projects` array)

| Field | Source |
|---|---|
| `projectId` | `PROJECT_MASTER.ID` |
| `customer`, `plant`, `projectNo`, `projectName`, `pic`, `status`, `targetDate` | `PROJECT_MASTER` |
| `overallProgress` | average `WBS.PROGRESS` across this project's WBS rows |
| `currentActivity` | the WBS row with `STATUS = 'ON PROGRESS'`, else the most recently created WBS row |
| `plannedThisWeek`, `actualThisWeek`, `problem`, `nextAction` | latest legacy `DailyLogs` entry inside the reporting period (empty string if none — see "Known limitation" below) |
| `scheduleStatus` | softened from `health`: `RED` -> `DELAYED`, `ORANGE` -> `AT RISK`, else `ON TRACK` |
| `riskLevel` | from the Project Risk Engine — **internal only** |
| `manDayPlanned`, `manDayActual` | sum of `RESOURCE_ALLOCATION.planManDay` / `.actualManDay` across this project's WBS — **internal only** |
| `remarks` | reserved, currently always `''` |

### `customerFacing` row (the `customerFacingProjects` array)

**Exactly the `internal` row minus four fields**, no other transformation:

- **excluded**: `projectId` (internal record key), `riskLevel` (internal
  classification language — "OVERLOAD", "CRITICAL" etc. is not vocabulary a
  customer report should ever show), `manDayPlanned`, `manDayActual`
  (internal capacity/costing data, never a customer's business).
- **kept, already softened**: `scheduleStatus` — the customer sees
  ON TRACK / AT RISK / DELAYED, never the internal `riskLevel` string.
- every other field (`customer`, `plant`, `projectNo`, `projectName`, `pic`,
  `status`, `overallProgress`, `currentActivity`, `plannedThisWeek`,
  `actualThisWeek`, `problem`, `nextAction`, `targetDate`, `remarks`) is
  identical between the two rows.

This inclusion/exclusion list must stay in sync with
`handleGetExternalWeeklyReport_` in `Reporting.gs` — if a field is ever
added to the internal row, it defaults to **excluded** from
`customerFacing` unless explicitly added to both.

### Summary / grouping

`summary`: `totalActiveProject`, `poProject`, `projectCompleted`,
`projectOnTrack`, `projectAtRisk`, `projectDelayed` (all counted from
`scheduleStatus`/`status`, in-scope projects only).

`groupedBy`: `country` (grouped by `customer` — legacy naming carried over
from the Phase 1 audit, no separate country field exists), `plant`,
`status`, `pic` — each a simple count map.

## Internal Weekly Report (`getInternalWeeklyReport`)

**Scope**: `PROJECT_MASTER` rows where `Type = 'INTERNAL'` — no status
filter (an internal report is for PSP's own tracking, not curated for an
external audience).

Per project: `projectId`, `projectNo`, `projectName`, `pic`, `status`,
`progress` (avg WBS progress), `wbsCount`, `plannedThisWeek` /
`actualThisWeek` / `problem` / `nextAction` (same legacy-log join as the
external report), `targetDate`, `manDayPlanned`/`manDayActual`, `loading`
(this project's PIC's current Phase 4 weekly loading: `plannedMD`,
`availableMD`, `status`), and `riskLevel`. Everything here is internal —
there is no customer-facing variant of the internal report.

### Irregular Jobs (Part I)

Read directly from the existing legacy `SupportJobs` sheet, filtered to the
reporting period by `Date` — **no duplicate storage created**. Grouped by
`Type` into `irregularJobs.byCategory` (`{category, count, manDay}` per
type), plus `totalManDay` and `totalCount` across all categories in the
period.

## Why no new sheet (Part J)

A "reporting snapshot" table was considered and rejected. Every field in
both reports is either:
- already stored (`PROJECT_MASTER`, `WBS`, `RESOURCE_ALLOCATION`, legacy
  `DailyLogs`, legacy `SupportJobs`), or
- cheaply derived at read time from those (progress averages, Man-Day
  sums, risk/health, the customer-facing subset).

Persisting a snapshot would require a write path (with its own
`LockService`/audit trail) purely to cache numbers that are already fast to
compute from small sheets, and would immediately create a second source of
truth that could drift from `PROJECT_MASTER`/`WBS` after any edit — exactly
the kind of duplication this phase's brief said to avoid unless "genuinely
required." Nothing here is (yet). If report history/versioning across time
is ever required, add a dedicated `WEEKLY_REPORT_SNAPSHOT` sheet then, with
an explicit save action — not now.

## Known limitation: no `WEEKLY_UPDATE` sheet

No sheet capturing a structured weekly status update (per the kind of
concept implied by "Weekly Report") exists anywhere in the codebase
(confirmed by inspection — Phase 3/4 never built one). `plannedThisWeek` /
`actualThisWeek` / `problem` / `nextAction` are therefore only ever
populated for a project that (a) was migrated from the legacy `Projects`
sheet (so it has a `LegacyProjectId`) and (b) has a matching legacy
`DailyLogs` row inside the selected period. A project created directly via
`addProjectMaster` (any brand-new External or Internal project going
forward) will always show those four fields as empty strings until a real
weekly-update capture mechanism is built — this is a real gap, not a bug,
and is called out here rather than silently hidden.
