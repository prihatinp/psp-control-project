# Phase 5.1 — Customer Report Data Contract

This is the explicit, test-enforced contract for the two data shapes
`handleGetExternalWeeklyReport_` (`Reporting.gs`) produces per project. It
formalizes what `WEEKLY_REPORT_DATA_MODEL.md` already described in prose;
this file exists so the exact field list is unambiguous and checked by
`phase5.1-test.js` (Part 8) on every run — if either contract's field list
changes without updating the other, that test fails.

## PSP_INTERNAL_VIEW (`getExternalWeeklyReport().projects`)

Full detail. Never sent anywhere outside PSP's own internal pages.

```
projectId, customer, country, plant, projectNo, projectName, pic, status,
overallProgress, currentActivity, plannedThisWeek, actualThisWeek, problem,
nextAction, targetDate, scheduleStatus, riskLevel, manDayPlanned,
manDayActual, remarks
```

## CUSTOMER_VIEW (`getExternalWeeklyReport().customerFacingProjects`)

Exactly `PSP_INTERNAL_VIEW` minus the four internal-only fields below. No
other transformation, no renaming, no rounding beyond what the internal row
already has.

```
customer, country, plant, projectNo, projectName, pic, status,
overallProgress, currentActivity, plannedThisWeek, actualThisWeek, problem,
nextAction, targetDate, scheduleStatus, remarks
```

## Fields excluded from CUSTOMER_VIEW, and why

| Field | Why it's internal-only |
|---|---|
| `projectId` | Internal record key (`PROJECT_MASTER.ID`) — has no meaning to a customer and would leak internal identifiers. |
| `manDayPlanned`, `manDayActual` | PSP's own capacity/costing data. Never a customer's business, and explicitly required to stay internal-only per Phase 5's brief ("Man-Day figures... must not automatically expose internal-only fields"). |
| `riskLevel` | Internal classification vocabulary (`CRITICAL`, `AT RISK`, `WATCH`, `NORMAL`, and the underlying reason keys like `overloadedEngineer`). A customer sees the already-softened `scheduleStatus` instead (`ON TRACK`/`AT RISK`/`DELAYED`) — same signal, without PSP's internal risk-engine vocabulary or resourcing detail. |

## Fields intentionally NOT excluded (plain descriptive data, not sensitive)

`customer`, `country`, `plant`, `projectNo`, `projectName`, `pic`, `status`,
`overallProgress`, `currentActivity`, `plannedThisWeek`, `actualThisWeek`,
`problem`, `nextAction`, `targetDate`, `remarks` — these describe the
project itself, not PSP's internal capacity or risk classification, so they
appear identically in both views. `country` (Phase 5.1) was added
alongside `customer`/`plant` on the same basis.

## Enforcement

`phase5.1-test.js`, Part 8, asserts (for every project row returned):

1. `Object.keys(customerFacingRow)` equals exactly the CUSTOMER_VIEW field
   list above — no more, no less.
2. `PSP_INTERNAL_VIEW` contains every CUSTOMER_VIEW field plus all four
   internal-only fields.
3. None of the four internal-only fields ever appear on a customer-facing
   row, under any fixture.

Any future field added to `handleGetExternalWeeklyReport_`'s internal row
must default to **excluded** from the customer row unless it is explicitly
added to both this document and the customer row construction — the test
will fail loudly (unexpected key on either side) if this contract is
violated, rather than silently leaking a new internal field.

## Scope note

This contract covers only the **External Weekly Report**. The Internal
Weekly Report (`getInternalWeeklyReport`) has no customer-facing variant —
every field it returns is PSP-internal by definition, since it only exists
for PSP's own Internal project tracking. The Executive Dashboard and
Projects Need Attention list are likewise internal-only tools and are never
intended to be shown to a customer.
