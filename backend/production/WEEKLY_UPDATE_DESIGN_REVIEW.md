# Phase 5.1 — Weekly Update Data Source: Design Review

Phase 5 flagged that no `WEEKLY_UPDATE` sheet exists, and approximated
weekly "plan / actual / problem / next action" detail from the legacy
`DailyLogs` sheet instead. This document is the requested design review:
**is DailyLogs alone sufficient going forward, or is a dedicated sheet
warranted?** This is a design recommendation only — nothing in this
section is implemented in Phase 5.1.

## How DailyLogs actually joins to PROJECT_MASTER today

`DailyLogs` is the real legacy sheet (`ID, ProjectID, ProjectNo, Date,
Engineer, Stage, Plan, Actual, Problem, Next, CreatedAt`), keyed by the
**legacy** `Projects.ID`. `PROJECT_MASTER` only carries that legacy id in
its own `LegacyProjectId` column, and only for rows created by
`migrateLegacyProjects` — every project created directly through
`addProjectMaster` (every new External project, every new Internal project,
from Phase 2 onward) has `LegacyProjectId = ''` and therefore **no path to
any `DailyLogs` row, ever**, no matter how much weekly data is entered
against it through the legacy `saveDailyLog` action (which itself still
targets the old `Projects`/`Stages` model, not `PROJECT_MASTER`/`WBS` — there
is no existing UI path to log a weekly update against a `PROJECT_MASTER`
project at all today).

This means the gap is not just historical — it is structural and growing:
every project created since Phase 2 already has zero weekly-update
capability, and the legacy-linked share of `PROJECT_MASTER` will keep
shrinking as new projects are added, IF nothing changes.

## Option A — Use DailyLogs (status quo)

| Criterion | Assessment |
|---|---|
| Data completeness | **Poor and worsening.** Only migrated projects can ever have data; zero coverage for anything created since Phase 2. |
| Historical traceability | Good, but only for the legacy population. |
| Customer-facing reporting | **Poor.** A customer report needs this week's plan/actual per active project; most External projects (all created via `addProjectMaster`) can never show it. |
| Internal reporting | Same limitation as above. |
| Data duplication risk | None — reuses what exists. |
| Ease of data entry | **Poor.** There is no UI today that lets a user log a weekly update against a `PROJECT_MASTER`/`WBS` project; the legacy entry form is tied to the old `Stages` model. |
| Excel export | Poor — most exported rows would be blank for anything but old legacy projects. |
| PowerPoint export | Same limitation. |
| Scalability | **Poor.** Depends on a join key (`LegacyProjectId`) that most future data will never have. |

## Option B — Create a standalone WEEKLY_UPDATE sheet

Keyed directly by `PROJECT_MASTER.ID` (not the legacy id), one row per
project per reporting period, columns mirroring what the reports already
need: `PROJECT_ID`, `PERIOD_KEY` (ISO week), `PLAN`, `ACTUAL`, `PROBLEM`,
`NEXT_ACTION`, `PROGRESS_NOTE`, `CREATED_BY`, `CREATED_AT`.

| Criterion | Assessment |
|---|---|
| Data completeness | **High.** Every project, migrated or new, External or Internal, can have a real row from day one. |
| Historical traceability | **Excellent** — one row per project per week, queryable directly by period instead of approximated by "latest log in range." |
| Customer-facing reporting | **High** — a direct, reliable source. |
| Internal reporting | **High.** |
| Data duplication risk | Some conceptual overlap with legacy `DailyLogs` (both capture plan/actual/problem/next) for the transition period, but they'd serve disjoint populations if scoped correctly (legacy Stage-based projects vs. `PROJECT_MASTER` projects) — not true duplication as long as one project is never written to both. |
| Ease of data entry | Needs a **new** UI (a "Weekly Update" form) — real, not-yet-built cost. |
| Excel export | **Excellent** fit — clean, one row per project per period. |
| PowerPoint export | **Excellent** fit, same reason. |
| Scalability | **Excellent** — bounded by projects × weeks, no legacy-join dependency. |

## Option C — Hybrid

Add `WEEKLY_UPDATE` for `PROJECT_MASTER` projects going forward, but keep
reading legacy `DailyLogs` (via `LegacyProjectId`) for projects that have
not yet been given a `WEEKLY_UPDATE` row for a given period — i.e. the
reporting engine prefers `WEEKLY_UPDATE` when a row exists for that
project+period, and falls back to the legacy join only when it doesn't.

| Criterion | Assessment |
|---|---|
| Data completeness | **High** going forward, without discarding legacy history already relied on. |
| Historical traceability | **Best of both** — old history stays exactly as it is; new history is captured cleanly. |
| Customer-facing / internal reporting | **High.** |
| Data duplication risk | **Low**, provided the precedence rule ("prefer WEEKLY_UPDATE, fall back to legacy DailyLogs, never merge the two for the same project+period") is the only join logic and is documented and tested. |
| Ease of data entry | Same new-UI cost as Option B — this does not avoid that work. |
| Excel / PowerPoint export | **Excellent** for data captured after adoption; legacy-era rows keep Option A's limitation, shrinking over time. |
| Scalability | **Excellent.** |

## Recommendation

**Option C (Hybrid) is the correct long-term architecture** — it is the
only option that gets to full data completeness without silently
discarding the real legacy history the current reports already depend on.
The "strong architectural reason" this phase's brief asked for before
building anything exists: Option A's gap is structural and growing, and
will directly block the two reports named as the reason for this hardening
pass (Weekly Management Report, Global Customer Weekly Report) for any
project created after Phase 2.

**Phase 5.1 does not implement `WEEKLY_UPDATE`.** Building it is real,
separate work (a new sheet, a new API action, a new entry form, and the
precedence logic above) that belongs to whichever future phase actually
builds the Weekly Management Report / Global Customer Weekly Report /
export features that need it — not to this calibration/hardening pass.
Recommended trigger to actually build it: the moment work starts on any of
the four downstream features named in this phase's objective (Weekly
Management Report, Global Customer Weekly Report, Excel export, PowerPoint
export), since all four need reliable per-project weekly data that Option A
cannot provide for non-migrated projects.

## Related fix made in this phase (not a WEEKLY_UPDATE change)

While auditing this area, Phase 5.1 found and fixed a real bug in how the
*existing* `DailyLogs` join picks "the latest" entry: it took the last row
in sheet **insertion order**, not the chronologically latest by date. For
normal same-day entry these are the same thing, but a backfilled or
out-of-order entry would have silently shown as "latest" when it wasn't.
Fixed via a shared `latestLogInPeriod_` helper that sorts by date before
picking the last one — see `PHASE5_REPORTING_MODEL.md` and
`WEEKLY_REPORT_DATA_MODEL.md`.
