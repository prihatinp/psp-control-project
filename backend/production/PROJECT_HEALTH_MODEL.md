# Phase 5 / 5.1 — Project Risk & Health Model

Deterministic, rule-based, read-only. No AI, no machine learning, no
weighted score — every rule below is a plain boolean check with a fixed
threshold read from `Config`, and the implementation in `computeProjectRisk_`
(`Reporting.gs`) must match this document exactly. If the two ever diverge,
the code is what actually runs — update this file to match it, not the
other way around.

> **Phase 5.1 changes to this document**, made during the calibration/
> hardening pass, not the original Phase 5 cut: (1) a new `missingManDay`
> flag; (2) `noWbs`, `wbsWithoutAllocation`, and `missingManDay` are now also
> exempted for closed projects — a real bug, not a threshold tweak: a
> completed legacy project with no Phase 3/4 WBS ever created for it used to
> show WATCH forever and never leave the attention list; (3) a
> `primaryReasonKey`/`primaryReason`/`primarySource` on every risk record, so
> the single reason and recommended action shown always matches the reason
> that actually decided the risk level (see the regression note below).

## Configurable thresholds

| Config Key | Default | Meaning |
|---|---|---|
| `REPORTING_STALE_DAYS` | `7` | No update (project/WBS/DailyLog) for more than this many days -> "no recent update" |
| `PROJECT_AT_RISK_DAYS` | `14` | Target date within this many days -> "near target" |
| `PROJECT_CRITICAL_DAYS` | `3` | Target date within this many days -> "critical deadline" |
| `OVERLOAD_THRESHOLD_PCT` | `100` | Formalizes the >100% boundary the Phase 4 engineer-loading status (`OVERLOAD`) already used |

## Inputs (one shared read per report cycle — `buildProjectRiskContext_`)

- `PROJECT_MASTER` (all projects, all fields including the internal-only `LegacyProjectId` and the Phase 5.1 `Country` column)
- `WBS` (all rows, via `wbsRowToObj_`)
- `RESOURCE_ALLOCATION` (all rows, via `allocRowToObj_`)
- legacy `DailyLogs`, grouped by legacy `ProjectID` — only reachable for a
  project that has a non-empty `LegacyProjectId` (i.e. it was migrated from
  the legacy `Projects` sheet; a project created directly via
  `addProjectMaster` has no legacy log trail — see `WEEKLY_UPDATE_DESIGN_REVIEW.md`)
- `getEngineerLoading_({periodType:'week'})` (Phase 4 engine, reused — never recomputed here)

## "Last update" (`computeLastUpdateDate_`)

The system has no `WEEKLY_UPDATE` sheet (Phase 5.1 evaluated adding one and
recommended against it for now — see `WEEKLY_UPDATE_DESIGN_REVIEW.md`).
"Last update" is therefore the **latest** of:
1. `PROJECT_MASTER.UpdatedAt`
2. every related `WBS.UPDATED_AT`
3. every related legacy `DailyLogs.Date` (only for migrated projects)

This is a documented approximation, not a real "last touched" audit trail —
see the Known Limitations section of `PHASE5_REPORTING_MODEL.md`.

## Flags (evaluated for every project, independent of each other)

| Flag | Condition | Source |
|---|---|---|
| `overdue` | not closed, has a target date, target date < today | `PROJECT_MASTER.TargetDate` |
| `criticalDeadline` | not closed, `0 <= daysUntilTarget <= PROJECT_CRITICAL_DAYS` | `PROJECT_MASTER.TargetDate` |
| `nearTarget` | not closed, `0 <= daysUntilTarget <= PROJECT_AT_RISK_DAYS` | `PROJECT_MASTER.TargetDate` |
| `noRecentUpdate` | not closed, and no last-update date exists OR it is more than `REPORTING_STALE_DAYS` days old | `PROJECT_MASTER.UpdatedAt` + `WBS.UPDATED_AT` + legacy `DailyLogs` |
| `noWbs` | **not closed**, and zero `WBS` rows for this project | `WBS` |
| `wbsWithoutAllocation` | **not closed**, has WBS, but none of them has any row in `RESOURCE_ALLOCATION` | `WBS` + `RESOURCE_ALLOCATION` |
| `missingManDay` *(Phase 5.1)* | **not closed**, at least one WBS row has one or more allocation rows whose Plan Man-Day sums to zero — distinct from `wbsWithoutAllocation` (that one fires when a WBS has *no* allocation row at all) | `RESOURCE_ALLOCATION.PLAN_MAN_DAY` |
| `overloadedEngineer` | any engineer on this project (allocated on its WBS, or the project PIC) has Phase 4 weekly status `OVERLOAD` | `RESOURCE_ALLOCATION` + Engineer Loading (Phase 4) |
| `highLoadEngineer` | same, but status `HIGH LOAD` | `RESOURCE_ALLOCATION` + Engineer Loading (Phase 4) |
| `progressBehind` | expected progress (linear, `IntakeDate` -> `TargetDate`) minus actual average WBS `PROGRESS` is more than 20 percentage points | `WBS.PROGRESS` vs `PROJECT_MASTER.IntakeDate`/`TargetDate` |
| `poApproaching` | not closed, status is `PO` or `EXECUTION`, and `nearTarget` | `PROJECT_MASTER.Status` + `TargetDate` |
| `externalPoStale` | type `EXTERNAL`, status `PO` or `EXECUTION`, and `noRecentUpdate` | `PROJECT_MASTER.Status` + `UpdatedAt` |
| `onHold` | status is `ON HOLD` | `PROJECT_MASTER.Status` |
| `missingCriticalData` | no `PIC` or no `TargetDate` — in practice only reachable via `updateProjectMaster` clearing one of them after creation, since `addProjectMaster` itself requires both | `PROJECT_MASTER.PIC`/`TargetDate` |

"Closed" = status `COMPLETED` or `CANCELLED`. A closed project can never be
`overdue`, `criticalDeadline`, `nearTarget`, `noRecentUpdate`,
`noWbs`, `wbsWithoutAllocation`, `missingManDay`, `progressBehind`,
`poApproaching`, or `externalPoStale` — those checks are all about whether
*active* work is being planned/executed/tracked well, which stops being a
meaningful risk signal once the project is done. `onHold` and
`missingCriticalData` are the only two flags NOT exempted for closed
projects: `onHold` is moot for a closed project anyway (mutually exclusive
statuses), and `missingCriticalData` is a data-integrity concern that stays
relevant regardless of status (a completed project with no recorded PIC is
still a record-keeping gap worth surfacing).

## Risk level cascade (checked in this exact order — first match wins)

```
CRITICAL   if overdue OR criticalDeadline OR (overloadedEngineer AND poApproaching)
AT RISK    else if poApproaching OR progressBehind OR overloadedEngineer OR externalPoStale
WATCH      else if noRecentUpdate OR highLoadEngineer OR wbsWithoutAllocation
                OR missingManDay OR onHold OR missingCriticalData OR noWbs
NORMAL     otherwise
```

## Health color (for dashboard/report display)

```
GRAY    if onHold                     (overrides every other color)
RED     else if riskLevel = CRITICAL
ORANGE  else if riskLevel = AT RISK
YELLOW  else if riskLevel = WATCH
GREEN   else                          (riskLevel = NORMAL)
```

`onHold` always renders GRAY even though its risk *level* still follows the
cascade above (an ON HOLD project that is also overdue is still level
CRITICAL internally, for sorting/attention purposes, but always displays
GRAY, not RED — "on hold" is a deliberate management state, not a red
alarm).

## The single "primary" reason (Phase 5.1)

Every project can trigger several flags at once (e.g. both stale AND
overloaded). `riskReasons`/`reasonKeys` still list **all** of them, in fixed
evaluation order, unchanged from Phase 5. But picking "the" reason to show
as a headline (and to look up a recommended action for) needs to reflect
**why the risk level is what it is** — not just whichever flag happened to
be evaluated first in the source code.

`RISK_LEVEL_REASON_PRIORITY_` mirrors the cascade's own conditions, per level:

```
CRITICAL: overdue, critical_deadline, overloadedEngineer, poApproaching
AT RISK:  poApproaching, progressBehind, overloadedEngineer, externalPoStale
WATCH:    noRecentUpdate, highLoadEngineer, wbsWithoutAllocation,
          missingManDay, onHold, missingCriticalData, noWbs
```

`primaryReasonKey` is the first key in that list (for the level actually
assigned) that is present in `reasonKeys`. `primaryReason` is its text,
`primarySource` is its entry in `RISK_SOURCE_MAP_` (the "Source" column
above).

**Regression this fixes**: before Phase 5.1, `getProjectsNeedAttention_`
used `reasonKeys[0]` — the first flag evaluated in source order — as "the"
reason. A project that was both `noRecentUpdate` (a WATCH-tier flag,
evaluated first) and `overloadedEngineer` (the AT-RISK-tier flag that
actually determined its level) would show the WATCH-tier action ("ask PIC
for an update") for a project that was actually AT RISK because an engineer
is overloaded. `primaryReasonKey` always belongs to the tier that won.

Example — RED, worked through the model exactly as the code computes it:
a project with `TargetDate` in the past and `Status != COMPLETED` sets
`overdue = true`. In the cascade, `overdue` alone is enough for
`riskLevel = CRITICAL`, and `health = RED` follows from `riskLevel = CRITICAL`.
`primaryReasonKey = 'overdue'`, `primaryReason = 'Target date terlewati,
status belum COMPLETED'` (English gloss: "Target date passed + project not
completed") — the exact reason a viewer sees is the exact reason the color
was assigned, not a separate guess.

## Output shape (`getProjectRisks` / embedded in the dashboard)

```json
{
  "projectId": "...", "projectNo": "...", "projectName": "...", "type": "EXTERNAL|INTERNAL",
  "pic": "...", "status": "...", "targetDate": "...",
  "lastUpdate": "YYYY-MM-DD|null", "daysUntilTarget": -30, "avgProgress": 20,
  "riskLevel": "CRITICAL|AT RISK|WATCH|NORMAL",
  "riskReasons": ["human-readable Indonesian sentence", "..."],
  "reasonKeys": ["overdue", "..."],
  "health": "RED|ORANGE|YELLOW|GREEN|GRAY",
  "primaryReasonKey": "overdue|null", "primaryReason": "...|null", "primarySource": "...|null",
  "sources": ["PROJECT_MASTER.TargetDate", "..."],
  "flags": { "overdue": false, "nearTarget": false, "noRecentUpdate": false, "externalPoStale": false, "missingManDay": false }
}
```

A `NORMAL` project has `primaryReasonKey`/`primaryReason`/`primarySource`
all `null` — there is nothing to explain.

## Projects Need Attention (`getProjectsNeedAttention`)

A plain filter + sort over the risk list above — **not** a separate
scoring model:
1. Keep only `riskLevel !== 'NORMAL'`.
2. Sort `CRITICAL` -> `AT RISK` -> `WATCH`. Every project maps to exactly
   one risk record, so this list can never contain duplicate entries for
   the same project.
3. Attach one `recommendedAction` per project, looked up from
   `ATTENTION_ACTION_MAP_` using **`primaryReasonKey`** (Phase 5.1 — see
   above; Phase 5 originally used `reasonKeys[0]`) — a fixed, hand-written
   lookup table (13 entries, one per flag above), not a generated
   recommendation. This is intentionally an operational decision-support
   list, not an AI recommendation engine.
