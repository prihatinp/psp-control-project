# Phase 3.1 — Capacity Model Audit

The formula is **not changed** in this phase — this document is the review requested before any change is considered.

## Current formula (unchanged)

```
Net Capacity (MD) = Current MP × Working Days in Period × UTILIZATION_FACTOR
```

Where `Current MP` is a live count of `Team` rows, `Working Days` comes
from `WORKING_DAYS_PER_WEEK`, and `UTILIZATION_FACTOR` defaults to
`0.75` (see `CAPACITY_MODEL.md` for the full parameter table).

## Assumptions this formula makes

1. Every person in `Team` is 100% allocatable engineering capacity — no per-person part-time factor, no per-person role weighting (a Section Head and a junior engineer count identically).
2. `UTILIZATION_FACTOR` is a single flat percentage applied uniformly to the whole team, for the whole period — it does not vary by person, by week, or by season (e.g., year-end leave clustering isn't modeled).
3. All non-project time is collapsed into one discount factor — there is no separate accounting of *how much* of that 25% (at the default 0.75) is meetings vs. admin vs. reporting vs. leave; `MEETING_ALLOWANCE`/`ADMIN_ALLOWANCE`/`LEAVE_ALLOWANCE` exist as separate config keys but, as documented in `CAPACITY_MODEL.md`, are shown for breakdown transparency only — they don't independently drive the formula.

## Explicit separation of work categories, as requested

| Category | Where it lives today | Captured in Net Capacity? |
|---|---|---|
| **Project work** (External + Internal) | `WBS` + `RESOURCE_ALLOCATION` | Counted as *demand* (Required MD), not as a capacity deduction — this is the work the capacity is *for* |
| **Irregular Job** (Capacity Up / Komarigoto Produksi / Quality Up / other) | Legacy `SupportJobs` sheet | Counted as *demand* (Required MD), same as project work — see Section 4 below |
| **Meeting** | `MEETING_ALLOWANCE` config key (5% default) | Folded into `UTILIZATION_FACTOR`'s implied discount — **not independently applied** |
| **Admin** | `ADMIN_ALLOWANCE` config key (5% default) | Same — folded in, not independently applied |
| **Reporting** | **No dedicated key exists.** | Not modeled as its own category at all today — implicitly absorbed into whichever of `ADMIN_ALLOWANCE`/`UTILIZATION_FACTOR`'s residual the team decides it belongs to |
| **Production support** | Overlaps with `SupportJobs.Type = 'Support Produksi'` / `'Trouble Mesin'` (real seed data values) | Counted as Irregular Job demand, same as Capacity Up etc. |
| **Other non-project work** | `LEAVE_ALLOWANCE` config key (5% default) covers leave specifically; anything else has no home | Leave is folded into `UTILIZATION_FACTOR` like Meeting/Admin; any other "other" category has no explicit representation |

## Strengths

- Every input is a named, editable `Config` row — no formula constant is buried in code.
- The Required-MD side (Project + Irregular) is complete: nothing currently tracked in `WBS`/`RESOURCE_ALLOCATION`/`SupportJobs` is excluded from demand.
- Gross vs. Net is explicit and auditable (`getCapacitySummary` returns both).
- The model correctly never lets Indicative Additional MP overwrite the Management Baseline — verified by test in every phase so far.

## Weaknesses

1. **No dedicated "Reporting" category** — the brief explicitly asks for it as a separable bucket; today it has no config key or tracked source, unlike Meeting/Admin/Leave which at least have a named (if inert) key.
2. **Allowances are decorative, not causal** — `MEETING_ALLOWANCE`/`ADMIN_ALLOWANCE`/`LEAVE_ALLOWANCE` are displayed in `getCapacitySummary` but do not mathematically compose into `UTILIZATION_FACTOR`. If someone edits an allowance expecting the Net Capacity number to move, it won't — a real usability risk (documented already in `CAPACITY_MODEL.md`, restated here because it's the central finding of this audit).
3. **Uniform utilization across the whole team** doesn't reflect that, e.g., a Section Head plausibly spends more time in meetings/admin than a design engineer — the current model has no per-person or per-role utilization override.
4. **No seasonality** — a known-heavy leave month (e.g., around a holiday period) isn't discounted any more than a normal month.

## Risks if used for real manpower analysis as-is

- **Understated capacity risk:** if Reporting/Other genuinely consumes time beyond what 25% utilization discount already assumes, Net Capacity is overstated and the Gap/Indicative Additional MP will be *understated* relative to reality.
- **False precision risk:** displaying allowances that don't feed the formula could lead a reader to believe editing `MEETING_ALLOWANCE` changes the result when it doesn't, producing a mismatch between expectation and output.
- **Aggregate-only risk:** a uniform per-person utilization number can hide real per-person overload even while the team-wide number looks healthy (mitigated somewhat by `getEngineerLoading`'s per-person view, which does not use a uniform team-average — it already applies the same `UTILIZATION_FACTOR` per person individually, so this specific risk is smaller than it looks, but still assumes every person's *rate* of overhead is identical).

## Recommendation (not implemented — for your decision)

If Reporting needs its own visibility, the lowest-risk next step is a **new** `REPORTING_ALLOWANCE` config key (additive, like the three that exist) shown alongside the others in the same breakdown-only role — and, separately, a deliberate decision on whether allowances should start actually composing into `UTILIZATION_FACTOR` (`UTILIZATION_FACTOR = 1 − meeting − admin − reporting − leave − other`) instead of being independently configured. That is a formula change and is explicitly **not** made in this phase, per your instruction.
