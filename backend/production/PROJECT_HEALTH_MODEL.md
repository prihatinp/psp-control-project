# Phase 5 — Project Risk & Health Model

Deterministic, rule-based, read-only. No AI, no machine learning, no
weighted score — every rule below is a plain boolean check with a fixed
threshold read from `Config`, and the implementation in `computeProjectRisk_`
(`Reporting.gs`) must match this document exactly. If the two ever diverge,
the code is what actually runs — update this file to match it, not the
other way around.

## Configurable thresholds

| Config Key | Default | Meaning |
|---|---|---|
| `REPORTING_STALE_DAYS` | `7` | No update (project/WBS/DailyLog) for more than this many days -> "no recent update" |
| `PROJECT_AT_RISK_DAYS` | `14` | Target date within this many days -> "near target" |
| `PROJECT_CRITICAL_DAYS` | `3` | Target date within this many days -> "critical deadline" |
| `OVERLOAD_THRESHOLD_PCT` | `100` | Formalizes the >100% boundary the Phase 4 engineer-loading status (`OVERLOAD`) already used |

## Inputs (one shared read per report cycle — `buildProjectRiskContext_`)

- `PROJECT_MASTER` (all projects, all fields including the internal-only `LegacyProjectId`)
- `WBS` (all rows, via `wbsRowToObj_`)
- `RESOURCE_ALLOCATION` (all rows, via `allocRowToObj_`)
- legacy `DailyLogs`, grouped by legacy `ProjectID` — only reachable for a
  project that has a non-empty `LegacyProjectId` (i.e. it was migrated from
  the legacy `Projects` sheet; a project created directly via
  `addProjectMaster` has no legacy log trail)
- `getEngineerLoading_({periodType:'week'})` (Phase 4 engine, reused — never recomputed here)

## "Last update" (`computeLastUpdateDate_`)

The system has no `WEEKLY_UPDATE` sheet (none was ever built — confirmed
absent from the whole codebase). "Last update" is therefore the **latest**
of:
1. `PROJECT_MASTER.UpdatedAt`
2. every related `WBS.UPDATED_AT`
3. every related legacy `DailyLogs.Date` (only for migrated projects)

This is a documented approximation, not a real "last touched" audit trail —
see the Known Limitations section of `PHASE5_REPORTING_MODEL.md`.

## Flags (evaluated for every project, independent of each other)

| Flag | Condition |
|---|---|
| `overdue` | not closed, has a target date, target date < today |
| `criticalDeadline` | not closed, `0 <= daysUntilTarget <= PROJECT_CRITICAL_DAYS` |
| `nearTarget` | not closed, `0 <= daysUntilTarget <= PROJECT_AT_RISK_DAYS` |
| `noRecentUpdate` | not closed, and no last-update date exists OR it is more than `REPORTING_STALE_DAYS` days old |
| `noWbs` | zero `WBS` rows for this project |
| `wbsWithoutAllocation` | has WBS, but none of them has any row in `RESOURCE_ALLOCATION` |
| `overloadedEngineer` | any engineer on this project (allocated on its WBS, or the project PIC) has Phase 4 weekly status `OVERLOAD` |
| `highLoadEngineer` | same, but status `HIGH LOAD` |
| `progressBehind` | expected progress (linear, `IntakeDate` -> `TargetDate`) minus actual average WBS `PROGRESS` is more than 20 percentage points |
| `poApproaching` | not closed, status is `PO` or `EXECUTION`, and `nearTarget` |
| `externalPoStale` | type `EXTERNAL`, status `PO` or `EXECUTION`, and `noRecentUpdate` |
| `onHold` | status is `ON HOLD` |
| `missingCriticalData` | no `PIC` or no `TargetDate` |

"Closed" = status `COMPLETED` or `CANCELLED`. A closed project can never be
`overdue`, `criticalDeadline`, `nearTarget`, `noRecentUpdate`,
`progressBehind`, `poApproaching`, or `externalPoStale` — those checks are
about *active* work.

## Risk level cascade (checked in this exact order — first match wins)

```
CRITICAL   if overdue OR criticalDeadline OR (overloadedEngineer AND poApproaching)
AT RISK    else if poApproaching OR progressBehind OR overloadedEngineer OR externalPoStale
WATCH      else if noRecentUpdate OR highLoadEngineer OR wbsWithoutAllocation
                OR onHold OR missingCriticalData OR (NOT hasWbs)
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
  "flags": { "overdue": false, "nearTarget": false, "noRecentUpdate": false, "externalPoStale": false }
}
```

## Projects Need Attention (`getProjectsNeedAttention`)

A plain filter + sort over the risk list above — **not** a separate
scoring model:
1. Keep only `riskLevel !== 'NORMAL'`.
2. Sort `CRITICAL` -> `AT RISK` -> `WATCH`.
3. Attach one `recommendedAction` per project, looked up from
   `ATTENTION_ACTION_MAP_` using the project's **first** `reasonKey` — a
   fixed, hand-written lookup table (12 entries, one per flag above), not a
   generated recommendation. This is intentionally an operational
   decision-support list, not an AI recommendation engine.
