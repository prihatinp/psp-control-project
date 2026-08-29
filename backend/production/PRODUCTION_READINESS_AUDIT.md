# Phase 5.2 — Production Readiness & Integration Audit

Scope: the cumulative Phase 1 → Phase 5.1 implementation, re-verified
against the actual repository state (not prior summaries) on branch
`phase5-2-production-readiness-audit`. This document is the detailed
evidence behind `PHASE5.2_FINAL_REPORT.md`'s release-gate table. Companion
documents: `API_CONTRACT_MATRIX.md`, `SCHEMA_AUDIT.md`,
`DEPLOYMENT_RUNBOOK.md`, `ROLLBACK_PLAN.md`.

**The real Google Apps Script production backend was NOT modified or
deployed during this audit.** One production code change was made (see
"Minimal Production Fix Applied" below), entirely inside
`backend/production/WbsWorkload.gs`, on this branch, tested, and pushed —
not against any live system.

## Part A — Legacy Backend Integrity

- **A1**: `backend/legacy/Code.gs` has exactly one commit in its entire git
  history (`c0e0a5f`, "Add real legacy Code.gs reference..."), never
  touched since. Confirmed byte-for-byte unchanged.
- **A2**: The repository's own `backend/legacy/Code.gs` **is** the
  authoritative source (supplied directly by the project owner) — there is
  no other copy in-repo to compare it against; this is by design, not a gap.
- **A3**: `diff backend/legacy/Code.gs backend/production/Code.gs` shows
  exactly three hunks, all additive:
  1. `SHEET_NAMES` gains `PROJECT_MASTER`, `WBS`, `RESOURCE_ALLOCATION`,
     `ORG_STRUCTURE` after the existing `CONFIG` entry (one trailing comma
     added to the `CONFIG` line to allow it — the only non-append
     character-level change in the whole file, value unchanged).
  2. `doPost`'s switch gains 30 new `case` blocks before the existing
     `default:` — zero existing cases altered.
  3. `setupSpreadsheet()` gains 8 new setup/config calls before the
     existing `getSecret_();`/`Sheet1` cleanup — zero existing calls
     reordered or altered.
- **A4**: Confirmed by the same diff — no legacy function removed, no
  legacy action disappeared, no legacy sheet renamed, no legacy field
  renamed, no legacy behavior changed. Every legacy security helper
  (`verifyToken_`, `checkRateLimit_`, `sanitizeStr_`/`sanitizeObjStrings_`,
  `getSecret_`, `signPayload_`, login brute-force lock) is byte-identical.

**No regression found. Not stopped.**

## Part B — API Routing

See `API_CONTRACT_MATRIX.md` for the full per-action table. Summary,
verified programmatically against the current source (not counted by
hand):

- 49 `case` statements in `doPost`, all unique action names — zero
  duplicate routing.
- 42 `handle*_` functions defined across the 5 `.gs` files; all 42 are
  routed (`handleLogin_` via the pre-switch `if (action === 'login')`
  branch, the other 41 via a `case`); zero orphans.
- Every `apiPost`/`apiGet` action name called from `js/app.js` exists on
  the backend (31 distinct actions checked); `teamNames` correctly uses
  `apiGet` and is handled by `doGet`, not `doPost`.
- No accidental unauthenticated write endpoint: every write handler sits
  behind the shared `verifyToken_`/`checkRateLimit_` gate in `doPost`
  (checked before the switch, so no case can bypass it) and wraps its
  mutation in `LockService`.

## Part C — Authentication & Security

Traced end to end and independently re-exercised this session (not just
re-read):

| Check | Result |
|---|---|
| C1: every non-public action requires `verifyToken_` | **Pass** — gate sits before the switch, applies to all 49 actions except `login` (produces the token) |
| C2: every authenticated action is rate limited | **Pass** — `checkRateLimit_` runs immediately after `verifyToken_`, same shared gate |
| C3: login brute-force protection works | **Pass** — reproduced directly: 5 wrong PINs lock the account for `LOGIN_LOCK_SEC`, confirmed the 6th attempt (even with the correct PIN) is rejected |
| C4: HMAC secret never exposed to frontend | **Pass** — confirmed a login response never contains the secret string |
| C5: HMAC secret never stored in repository source | **Pass** — see Part O |
| C6: token cannot be forged by modifying payload | **Pass** — reproduced directly: a tampered payload reusing the original signature is rejected |
| C7: expired tokens are rejected | **Pass** — reproduced directly: a validly-signed but `exp`-in-the-past token is rejected. **This exact case had zero prior test coverage before this phase** (flagged in the Phase 5.1 review gate as finding F-08) — now covered by `production-readiness-test.js` Category 2 |
| C8: malformed tokens are rejected | **Pass** — reproduced directly for empty string, no-dot string, 3-part string, garbage string |
| C9: formula injection is blocked | **Pass** — `sanitizeStr_`/`sanitizeObjStrings_` prefix a leading `'` on values starting with `=+-@`, applied by every write handler across all 5 files (verified function-by-function) |
| C10: string length limits | **Not enforced anywhere** (legacy behavior, unchanged) — no `MAX_LENGTH` truncation exists in `sanitizeStr_`. Not a regression (identical to `backend/legacy/Code.gs`), but a real absence — see Findings |
| C11: writes use `LockService` | **Pass** — every write handler in all 5 files wraps its mutation in `LockService.getScriptLock()...finally{releaseLock()}`, verified function-by-function. `saveVacancy` has no lock of its own but delegates directly to `handleUpdateOrgNode_`, which does — safe by composition, verified by reading the delegation |
| C12: no Phase 2–5.1 code bypasses the legacy helpers | **Pass** — same verification as C1/C9/C11 |

No vulnerability found. Authentication was not redesigned.

## Part D — Spreadsheet / Schema

See `SCHEMA_AUDIT.md` for the full inventory. Key confirmations:

- **D1/D2**: no duplicate schema definitions, no field-name collision —
  `Country` (Phase 5.1) was the one genuinely new column added to
  `PROJECT_MASTER`, appended last (position 27), same pattern as
  `LegacyProjectId`.
- **D3**: `ensureHeader_` only ever writes headers to a row that is
  currently completely empty — it cannot overwrite an existing header row.
  `ensureProjectMasterCountryColumn_` (Phase 5.1) is the one function that
  adds a column to an *already-populated* sheet, and it does so by
  appending past the last column, never touching an existing cell —
  re-verified this session against a simulated pre-existing 26-column
  sheet with real data in row 2, both first-run and a second, idempotent
  run.
- **D4/D5/D6**: `setupSpreadsheet()` re-run twice against a spreadsheet
  that already had real seeded data (a project, an org node) left every
  sheet byte-identical, and did not duplicate Config keys or re-create any
  sheet's header row — directly tested this session
  (`production-readiness-test.js` Category 4).
- **D7**: confirmed by Part A's diff — legacy sheets are never targeted by
  any Phase 2–5.1 setup/write call except the explicitly-designed,
  read-only-source `migrateLegacyProjects`.
- **D8**: zero duplicate Config keys across all four `ensurePhaseNConfig_`
  functions (17 keys, each appearing exactly once) — checked
  programmatically this session, not by eye.
- **D9**: every Config default is a plain, documented, non-secret value
  (day counts, percentages, status lists) — none are safety-critical in a
  way that a wrong default could corrupt data (worst case: a threshold
  displays a project's risk color differently until corrected).

## Part E — Data Migration

`migrateLegacyProjects` re-inspected directly and re-executed against a
fresh in-memory mock (never against any real spreadsheet):

- **E1**: additive-only — writes exclusively to `PROJECT_MASTER`.
- **E2**: `backend/legacy` `Projects` sheet (mocked) proven byte-identical
  before/after two migration runs.
- **E3/E4/E5**: run twice; first run migrated all 14 seeded legacy
  projects with 0 skips; second run migrated 0 and skipped all 14,
  recognizing every one via `LegacyProjectId` — no duplicate
  `LegacyProjectId` values exist afterward.
- **E6/E7**: unmapped fields (`Customer`, `Plant`, `Country`, RFQ/PO
  fields, `Complexity`, `Priority`) are written as `''` for every migrated
  row — confirmed programmatically, not spot-checked; mapped fields
  (`PIC`, `Name`, `No`, `Category`, dates) come straight from the legacy
  row, nothing invented.
- **E8**: `fmtDateCell_` conversion applied consistently; `IntakeDate`
  falls back to `todayStr_()` only when the legacy row's `Start` is blank
  — a defensible default, not an invented value (legacy has no separate
  "intake" concept).
- **E9**: status mapping is a pure function of `ProgressStage`
  (`>= 18 → COMPLETED`, else `EXECUTION`) — deterministic, same input
  always produces the same output.
- **E10**: every row in the legacy `Projects` sheet is treated as eligible
  (the legacy sheet has no "draft"/"invalid" concept to filter on) — this
  is consistent with the legacy source's own lack of a status field, not a
  new gap introduced here.

**Dry-run report** (from this session's mock run, reproducible via
`production-readiness-test.js` Category 6 — no real spreadsheet touched):

```
legacy project count:      14
eligible records:          14 (legacy has no invalid/draft concept to exclude)
migrated (first run):      14
skipped (first run):       0
migrated (second run):     0
skipped (second run):      14 — reason: LegacyProjectId already present
duplicates prevented:      yes, all 14
```

## Part F — Capacity & Manpower

Formulas independently recomputed by hand against `handleGetCapacitySummary_`/
`handleGetManpowerAnalysis_`/`distributeManDay_`, not re-read from the docs
and trusted:

| Check | Result |
|---|---|
| F1: no double-counted allowances | **Pass** — `UTILIZATION_FACTOR` is the only multiplier actually used in Net Capacity; `MEETING_ALLOWANCE`/`ADMIN_ALLOWANCE`/`LEAVE_ALLOWANCE` are reported for breakdown only, never separately multiplied in (documented in `CAPACITY_MODEL.md`) |
| F2: no negative manpower produced | **Pass with a caveat** — every *computed* manpower figure clamps at 0 (`Math.max(0, ...)` in `distributeManDay_`; `indicativeAdditionalMPExact` only computed `gapMD > 0`). **However**, `createWBS`/`updateWBS`/`saveResourceAllocation` did not previously reject a negative `planManDay` **at write time** — a negative value could be stored on a WBS/allocation row directly (caught only afterward by `getDataQualityReport`'s `NEGATIVE_MAN_DAY` check, never blocked). **Fixed in this phase** — see "Minimal Production Fix Applied" below. |
| F3: zero Man-Day | **Pass** — `distributeManDay_(…, 0, …)` returns `{}`, contributes nothing anywhere, verified directly |
| F4: weekend-only activities | **Pass, documented fallback** — a range with zero working days attributes the full amount to the containing period rather than silently dropping it (`countWorkingDaysInRange_ === 0` branch), verified directly this session; **this fallback was not previously documented** in `MULTIWEEK_DISTRIBUTION_DESIGN.md` — see Findings |
| F5: multi-week distribution | **Pass** — independently recomputed a Jan 28–Feb 5 / 10 MD case by hand: 3 working days in the first ISO week, 4 in the second → 4.2857/5.7143 MD, matching the code's output exactly |
| F6: total distributed MD == original | **Pass for valid input.** Verified for 1-day, cross-week, cross-month, weekend-only (via fallback), and inverted-date-range (via fallback) cases. **Does not hold for negative input** (by design — clamped to 0, not distributed as negative) — this is now moot for new writes given the Part F2 fix, but any already-existing negative value in a real sheet would still exhibit this until corrected |
| F7: Irregular Job workload not duplicated | **Pass** — `collectProjectWorkloadRows_` (WBS/allocation-sourced) and `collectIrregularWorkloadRows_` (`SupportJobs`-sourced) are disjoint by construction (different source sheets); `totalPlannedMD` is the sum of both, and `byType.EXTERNAL + byType.INTERNAL + byType.IRREGULAR` reconciles to it — verified with normal, multi-project, and multi-week datasets |
| F8: Current MP always from Team | **Pass** — every consumer (`getManpowerAnalysis`, `getManpowerScenario`, `getWorkloadSummary`, `getCapacitySummary`, the dashboard) independently calls `rowsToObjects_(Team).length` live; nothing caches or duplicates it |
| F9: management baseline never silently overwritten | **Pass** — `MANAGEMENT_BASELINE_ADDITIONAL_MP` is only ever read via `getConfigNum_`, never written by any calculation engine; re-verified this session by editing the Config value directly and confirming only the baseline/target figures changed while every calculated figure stayed identical |
| F10: simulation never mutates data | **Pass** — `getManpowerScenario` snapshotted-and-compared across `Team`, `ORG_STRUCTURE`, `PROJECT_MASTER`, and `RESOURCE_ALLOCATION` before/after, byte-identical |

## Part G — Reporting / Executive

All 6 endpoints (`getExecutiveDashboard`, `getProjectRisks`,
`getProjectsNeedAttention`, `getExternalWeeklyReport`,
`getInternalWeeklyReport`, `getReportingPreview`) call the same
`buildProjectRiskContext_`/`computeProjectRisk_` on the same request-scoped
data — a project cannot receive contradictory classifications between
endpoints by construction (re-verified with fresh fixtures this session).

- **G1**: confirmed read-only — none of the 6 call `LockService`, none
  call `appendRow`/`setValue`/`setValues`.
- **G2**: `primaryReasonKey`/`primaryReason`/`primarySource` (Phase 5.1)
  are chosen by a priority list matching the cascade's own conditions per
  level — re-verified the specific regression this fixed (an
  `overloadedEngineer`+`noRecentUpdate` project now correctly shows the
  AT-RISK-tier action, not the WATCH-tier one).
- **G3**: `noWbs`/`wbsWithoutAllocation`/`missingManDay` are exempted for
  `COMPLETED`/`CANCELLED` projects (Phase 5.1 fix) — re-verified a
  COMPLETED project with no WBS is `NORMAL`/`GREEN`, not stuck at WATCH.
- **G4**: `missingManDay` (an allocation exists but sums to zero Man-Day,
  distinct from no allocation at all) re-verified in isolation.
- **G5**: `dataQuality.status`/`totalIssues`/`bySeverity` on the dashboard
  matches a direct `getDataQualityReport` call byte-for-byte.
- **G6**: `Country` and `Customer` are genuinely separate `PROJECT_MASTER`
  fields and separate `groupedBy` buckets (Phase 5.1 fix) — re-verified.
- **G7**: `Plant` is blank wherever not entered — never guessed.
- **G8**: the legacy `GlobalSupport.Country` field (which stores
  plant-level names, a pre-existing quirk) is untouched by any Phase
  2–5.1 code; `globalSupportLegacy` on the dashboard reports it exactly
  as stored, unmodified.
- **G9**: weekly reports never fabricate data — a project with no
  `DailyLogs` entry in the selected period shows empty strings, not an
  invented plan/actual value; still listed, never dropped.
- **G10**: the dashboard exposes `currentMp`/`requiredMp`/`additionalMp`
  (calculated) alongside `managementBaselineMp`/`managementTargetMp`
  (reference) as five distinct fields — never merged into one number.

## Part H — Frontend/Backend Contract

Re-verified programmatically against the current `index.html`/`js/app.js`
(not from memory): every `data-page` matches a `page-*` section 1:1; every
`onclick="goPage('X')"` resolves to a real section; every `apiPost`/`apiGet`
action name exists on the backend; `js/app.js` parses cleanly
(`node --check`); `<section>` tags balance (27 open / 27 close).

- **H1/H2/H3**: no undefined backend action called, no missing expected
  response field found, no renamed-field mismatch found — checked
  source-to-source, not just by re-running the existing test suites.
- **H4/H5**: `apiPost`'s `.catch()` shows a `toast()` error for any
  rejected promise; an `authError:true` response triggers `forceLogout`
  centrally in `apiPost`, applying uniformly to every action including
  the newest reporting pages.
- **H6**: `"Aksi tidak dikenal"` only fires for the literal `default:`
  case — confirmed no frontend call can reach it (Part B).
- **H7**: legacy pages (dashboard, projects table, daily update, team) —
  no element, id, or render function belonging to them was touched by any
  phase; re-confirmed via the same diff-equivalent reasoning as Part A.

**Real, pre-existing gap** (not a contract mismatch, a completeness gap):
13 backend actions have no frontend caller at all —
`updateProjectMaster`, `migrateLegacyProjects`, `updateWBS`, `deleteWBS`,
`updateOrgNode`, `saveVacancy`, `getWBS`, `getProjectMaster`,
`externalProjectList`, `getSkillLoading`, `getResourceAllocation`,
`getWeeklyWorkload`, `getMonthlyWorkload`, `getProjectRisks`. PSP staff
cannot edit/delete a WBS row, edit an org node, edit a `PROJECT_MASTER`
project, or trigger migration through the UI today — only via direct API
calls, as exercised by the test suites. Not a defect; a scope note for a
future UI phase.

## Part I — Google Apps Script Compatibility

- All 5 `.gs` files parse as valid, self-contained JS (`vm.Script`
  construction, equivalent to what the real Apps Script V8 runtime does)
  — verified for every file, not assumed from tests passing.
- **Zero cross-file function-name collisions, zero cross-file top-level
  var/const/let collisions** — checked programmatically across all 5
  files (necessary for them to coexist in one Apps Script project's
  shared global scope).
- **Zero Node/browser-only API usage** inside any `.gs` file — no
  `require(`, `module.exports`, `fetch`, `document.`, `window.`,
  `localStorage`, `process.env`, `__dirname` (one earlier automated check
  false-positived on the English word "export" inside a doc comment;
  corrected to a syntax-specific pattern — the underlying code was always
  clean).
- Only documented GAS global services are referenced:
  `SpreadsheetApp`, `PropertiesService`, `CacheService`, `LockService`,
  `Utilities`, `Session`, `ContentService`, `Logger`.
- `var`/`const`/`let` are all valid under `runtimeVersion: "V8"`; Phase
  2–5.1 files consistently use `var` (a deliberate style choice, not an
  incompatibility) while the legacy `Code.gs` uses `const`/`let` — both
  coexist without conflict since no name is declared twice.
- Load-order: `Code.gs`'s `setupSpreadsheet()` calls into functions
  defined in the other 4 files (`setupWbsSheet_`, `ensurePhase5Config_`,
  etc.) — in the real Apps Script editor, files share one global scope
  regardless of tab order/execution order at *definition* time (only
  *call* order matters, and every call happens after the whole project is
  loaded), so this poses no real load-order risk. The test harness's own
  `LOAD_ORDER` array exists only because Node's `vm.runInContext` executes
  files sequentially — not a constraint of the real GAS environment.

**No GAS incompatibility found.**

## Part J — Performance

Not optimized — findings only, per this phase's explicit instruction.

| Area | Classification | Note |
|---|---|---|
| `getExecutiveDashboard` | **MEDIUM** | Internally calls `buildProjectRiskContext_` once, but then separately calls `handleGetManpowerAnalysis_`, `handleGetWorkloadSummary_` (twice — week and month), and `handleGetManpowerBySkill_`, each of which independently re-reads `Team`/`WBS`/`RESOURCE_ALLOCATION`/`SupportJobs` via their own `rowsToObjects_` calls. A single dashboard load can trigger 10+ full sheet reads, several redundant. At PSP's current real scale (≈15 team members, dozens of projects) each `getDataRange().getValues()` call is fast — no user-facing latency problem today. Would become a real concern if `WBS`/`RESOURCE_ALLOCATION`/`DailyLogs` grow into the thousands of rows. |
| `findRowIndexById_` | **LOW** | O(n) linear scan per update/delete call (`handleUpdateProjectMaster_`, `handleUpdateWbs_`, `handleUpdateOrgNode_`). Fine at current and foreseeable scale; not called in any loop. |
| `computeProjectRisk_` over all projects | **LOW** | O(projects × WBS rows) per risk-list request — hundreds of operations at current scale, negligible. |
| `getWorkloadSummary`/`getManpowerBySkill`/etc. individually | **LOW** | Each does a small, fixed number of full-sheet reads; fine standalone (as used by their own dedicated pages), the cost only compounds when several are called together for one dashboard render. |

**Recommendation** (not applied — would be a feature/refactor, out of this
phase's scope): if real usage grows well beyond current scale, refactor
the manpower/workload handlers to optionally accept a pre-fetched context
(the same pattern `buildProjectRiskContext_` already uses for the risk
engine) so `getExecutiveDashboard` stops re-reading the same sheets
multiple times per request.

## Part K — Error Handling & Failure Modes

Directly re-exercised against the mock this session (not inferred):

| Input | Result |
|---|---|
| Empty payload | `{ok:false, authError:true, ...}` — no crash |
| Malformed JSON | `{ok:false, message:"Server error: ..."}` — caught by `doPost`'s try/catch, generic parse-position message only, no stack trace |
| Missing action / missing token / invalid token / expired token / malformed token | All rejected with `authError:true`, no crash |
| Unknown action (with a valid token) | `{ok:false, message:'Aksi tidak dikenal.'}` |
| Invalid project ID / WBS ID / engineer | Each returns a clear `ok:false` message ("Project tidak ditemukan.", "WBS tidak ditemukan.") — no crash, no stack trace |
| Negative Man-Day | **Previously accepted silently at write time** (Part F2) — **now rejected** with `{ok:false, message:'Plan Man-Day tidak boleh negatif.'}` (this phase's fix) |
| Zero Man-Day | Accepted (a valid, real value — e.g. "not started yet") — correctly distinguished from negative |
| Duplicate allocation | Accepted at write time (not blocked), flagged afterward by `getDataQualityReport`'s `DUPLICATE_ALLOCATION` check — consistent with the system's established "detect, don't auto-correct or block" philosophy for this class of issue |
| Missing Config key | Every reader uses `getConfigNum_`/`getConfigList_` with an explicit fallback default — never throws on a missing key |
| Missing/empty sheet | `getSheet_` auto-creates a missing sheet via `insertSheet`; `rowsToObjects_` returns `[]` for a sheet with only (or even zero) rows — no crash |
| Concurrent writes | **Not verifiable by this test harness** — the mock's `LockService` is a call-counting no-op (documented in `mock-gas-v2.js`), so true mutual exclusion can only be validated in the real Apps Script environment. The code *calls* `waitLock`/`releaseLock` correctly (verified), but real concurrency safety is unproven by any test in this repository. |

**No HMAC secret, stack trace, internal credential, or sensitive Config
value is ever returned in any response** — confirmed across every case
above.

## Minimal Production Fix Applied (this phase)

Per Part F2/Part K's finding — `createWBS`, `updateWBS`, and
`saveResourceAllocation` accepted a negative `planManDay`/`actualManDay`
at write time with no rejection, storing it verbatim on the sheet (caught
only afterward, never blocked, by `getDataQualityReport`). This did not
corrupt any calculation (downstream consumers already clamp negative
input, per Part F2), but is a genuine input-validation gap.

**Fix**: added an explicit rejection (`ok:false, message:'Plan/Actual
Man-Day tidak boleh negatif.'`) to all three handlers, matching the exact
validation style already used elsewhere in the same codebase (e.g.
`idealHeadcount` in `Organization.gs`). Confirmed zero existing test
depended on the old, silently-accepting behavior; all 176 existing checks
plus the new fix-specific checks pass. This is the only production code
change made during this audit — entirely inside
`backend/production/WbsWorkload.gs`, not `Code.gs`, not
`backend/legacy/*`.

## Findings not fixed (reported only, per this phase's "do not fix by
guessing" instruction)

- **C10**: no string length limit is enforced anywhere (legacy behavior,
  unchanged) — a very long input could theoretically bloat a sheet cell.
  Low real-world risk given this is an internal tool with a small,
  identified user base; not fixed, since changing legacy-shared
  `sanitizeStr_` risks altering behavior relied on elsewhere.
- **F4/F6 fallback rules undocumented**: `MULTIWEEK_DISTRIBUTION_DESIGN.md`
  describes only the clean-case formula, not the weekend-only/negative-
  clamp/missing-date/inverted-range fallback rules the real code
  implements and tests. Documentation gap, not a code defect — left for a
  future doc pass rather than rewritten here (out of this phase's minimal-
  change mandate).
- **Concurrency**: genuinely unverifiable outside the real GAS environment
  — flagged as a required manual verification step in
  `DEPLOYMENT_RUNBOOK.md`, not something a mock can prove.
