# Phase 3.1 — Multi-Week Man-Day Distribution: Design (not implemented)

## The current limitation, precisely

`getWorkloadSummary`/`getEngineerLoading`/etc. attribute an entire
`RESOURCE_ALLOCATION` row's Plan/Actual Man-Day to the single week or
month containing its parent `WBS` row's `START_DATE`. An activity
planned 2026-09-01 → 2026-09-10 with 20 MD counts all 20 MD in the
first week of September, none in the second — even though the work
plainly spans both.

## Proposed model (design only)

**Even distribution across working days in the activity's date range**,
computed at query time rather than stored:

```
workingDaysInRange(startDate, targetDate) = count of weekdays (per
    WORKING_DAYS_PER_WEEK) between startDate and targetDate inclusive

dailyRate = PLAN_MAN_DAY / workingDaysInRange(startDate, targetDate)

For a given week/month period P:
    workingDaysOfActivityInPeriod = count of the activity's working
        days that fall inside P
    attributedMD(P) = dailyRate × workingDaysOfActivityInPeriod
```

Example from the brief: Mechanical Design, 2026-09-01 → 2026-09-10, 20
MD, `WORKING_DAYS_PER_WEEK=5` → 8 working days in range → `dailyRate =
2.5 MD/day`. Week of Sep 1 (Tue–Fri, 4 working days) → 10 MD
attributed; week of Sep 7 (Mon–Thu, 4 working days) → 10 MD attributed.
10 + 10 = 20, matching the total exactly — the key correctness property
this model must preserve (sum across all periods a WBS row touches
must equal its total Plan Man-Day).

## Why this doesn't require a schema change now

`WBS.START_DATE` and `WBS.TARGET_DATE` already exist (Phase 3). The
distribution above is a pure function of data already on the row — no
new column, no new sheet. This is why Phase 3's schema is confirmed
compatible with this later enhancement: implementing it later means
replacing the single-bucket lookup inside `collectProjectWorkloadRows_`
with a loop that emits one `{date, planManDay: attributedMD}` entry per
working day (or per week, for less granularity) instead of one entry
at `START_DATE` — a change contained entirely inside
`WbsWorkload.gs`'s aggregation functions, not the schema.

## What *would* need a new field, if wanted later

- **Uneven distribution** (e.g., a design-heavy first week, a
  review-light last week) would need either a child table
  (`WBS_ID, WEEK_START, PLAN_MD`) for manual weekly overrides, or a
  richer curve parameter — out of scope for "future-compatible," which
  only requires that even distribution remains possible without a
  migration.
- **Actual (not planned) multi-week spreading** could reuse
  `ACTUAL_START`/`ACTUAL_END` (already present) the same way.

## How weekly/monthly loading would work under this model

`getWorkloadSummary`/`getEngineerLoading`/`getSkillLoading` would each
call the distribution function per `RESOURCE_ALLOCATION` row instead of
doing a single date lookup, then sum the attributed MD for the
requested period — the external API contract (request/response shape)
does not change, only the internal aggregation. No frontend change
would be required either.

## Not implemented in Phase 3.1

Per your instruction, this is design-only. The current single-bucket
behavior remains exactly as Phase 3 built it; `Config` gains no new
key for this yet.
