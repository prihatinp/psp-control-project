# Phase 3 — Man-Day / Capacity / Manpower Gap Model

All parameters below are **configurable assumptions** stored as Key/Value
rows in the real `Config` sheet, editable directly there — no code change
needed to tune them. Defaults are proposed starting points, not derived
from any real PSP data; management should review and adjust them.

## Configurable parameters

| Config Key | Default | Meaning |
|---|---|---|
| `WORKING_DAYS_PER_WEEK` | `5` | Days per week counted as working days |
| `WORKING_HOURS_PER_DAY` | `8` | Contract/shift length (not currently used in the MD-based formulas below — kept for a future hour-level calculation) |
| `AVAILABLE_HOURS_PER_PERSON` | `8` | Same status as above — reserved for future use |
| `UTILIZATION_FACTOR` | `0.75` | The single dial actually used to convert Gross → Net capacity |
| `MEETING_ALLOWANCE` | `0.05` | Breakdown/transparency only (see below) |
| `ADMIN_ALLOWANCE` | `0.05` | Breakdown/transparency only |
| `LEAVE_ALLOWANCE` | `0.05` | Breakdown/transparency only |
| `MANAGEMENT_BASELINE_ADDITIONAL_MP` | `8` | **Management Baseline — Reference Only.** Never written by any calculation. |

### Why `UTILIZATION_FACTOR` is not derived from the three allowances

The Phase 3 brief lists `UTILIZATION_FACTOR` and the three allowances
(`MEETING_ALLOWANCE`/`ADMIN_ALLOWANCE`/`LEAVE_ALLOWANCE`) as separate
config keys. Multiplying all four together would double-count — the
allowances are already what utilization is discounting for. This
implementation treats `UTILIZATION_FACTOR` as the one number the Net
Capacity formula actually uses, and surfaces the three allowances
separately in `getCapacitySummary` purely for a human-readable
breakdown ("of which: meeting 5%, admin 5%, leave 5%"). If you want the
allowances to *drive* utilization instead, set `UTILIZATION_FACTOR`
yourself to `1 - meeting - admin - leave - (any other overhead)` — the
system won't compute that automatically, to avoid silently double
counting if someone later edits the allowances without also editing
`UTILIZATION_FACTOR`.

## Formulas

```
Gross Capacity (MD) = Current MP × Working Days in Period
Net Capacity (MD)   = Gross Capacity × UTILIZATION_FACTOR
```

`Current MP` = live count of rows in the real `Team` sheet (currently
14 — see "Known limitation: Team roster" below).

`Working Days in Period`:
- for a **week**: `WORKING_DAYS_PER_WEEK` directly.
- for a **month**: the actual count of weekdays 1..`WORKING_DAYS_PER_WEEK`
  (Monday-indexed) in that calendar month — not a flat 4.33× average.

```
Required MD (period) = sum of planned Man-Day across all three workload
                        sources (External, Internal, Irregular) whose
                        attributed date falls in the period
Gap (MD)              = Required MD − Net Capacity (MD)
Indicative Additional MP = Gap MD / (Working Days in Period × UTILIZATION_FACTOR)
                            (0 if Gap ≤ 0)
```

`Indicative Additional MP` is always labeled **"system calculation, NOT
an HR recommendation"** in the API response, and is never written back
into `MANAGEMENT_BASELINE_ADDITIONAL_MP` — the two travel side by side
(`getManpowerAnalysis` returns both plus their difference) and never
merge.

## Workload sources

1. **PROJECT** (External + Internal) — `WBS` rows joined to
   `RESOURCE_ALLOCATION` (per-engineer Man-Day) joined to
   `PROJECT_MASTER` (for the External/Internal split).
2. **IRREGULAR** — the existing legacy `SupportJobs` sheet, read-only,
   exactly as it already works (`PIC` + `ManDay` per row). No parallel
   WBS-for-Irregular-Job structure was built — Irregular Job workload
   already has a working home in real production data, so Phase 3
   reads it rather than duplicating it.

## Documented simplification: date bucketing

A Man-Day allocation (`RESOURCE_ALLOCATION` row) is attributed to the
week/month containing its parent `WBS` row's `START_DATE` (or
`ACTUAL_START` if set) — **not** spread proportionally across a
multi-week activity's full date range. An activity planned from Jan 1
to Mar 31 with 30 MD would count all 30 MD in the week/month containing
Jan 1, not spread ~10 MD/month across three months. This is a Phase 3
foundation-level simplification, not a scheduling engine — precise
day-by-day or week-by-week spreading is deferred to a later phase.

## Known limitation: Team roster

`Current MP` is computed live from the real `Team` sheet — currently
**14** rows. Business context provided elsewhere in this project states
current manpower is 15, including Dadang Sandi, who **does not appear**
in the real `Team` sheet's seed data. Per the explicit instruction not
to invent people, no row was added on his behalf. `Current MP` will
correctly become 15 automatically, with no code change, the moment
Dadang Sandi (or anyone else) is added as an actual row in the real
`Team` sheet.
