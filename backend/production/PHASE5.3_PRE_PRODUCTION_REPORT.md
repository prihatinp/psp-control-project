# Phase 5.3 — Pre-Production Verification & Release-Gate Closure

Branch `phase5-3-pre-production-readiness`, based on
`phase5-2-production-readiness-audit`. Every finding below was
re-verified against the actual current repository state this session
(git diff, direct grep, and re-execution against the mock GAS harness) —
nothing is carried forward from a prior phase's report without
re-checking it here. **No real Google Apps Script project, spreadsheet,
or deployment was touched.**

## 1. Executive Summary

The Phase 5.2 release gate (🟡 GO WITH CONDITIONS) has been re-examined
condition by condition. Every condition that can be verified from the
repository alone has now been verified and closed. The remaining
conditions are, by their nature, only verifiable inside a real Google
Apps Script project (concurrency, live `appsscript.json`, the actual
Web App execution identity, real Script Properties) — these cannot be
closed from this repository and are not claimed as closed. **The
repository release candidate itself is ready. Production deployment
remains conditionally blocked pending real GAS verification** — this is
an access limitation of this session, not a defect found in the code.

Test result: **233/233 passed, 0 failed**, unchanged in count from Phase
5.2 (no new tests were required this phase — every Phase 5.2 condition
was closable by inspection/re-execution, not by adding coverage).

## 2. Repository Integrity

Re-verified this session, not assumed:

| Check | Result |
|---|---|
| `backend/legacy/Code.gs` untouched | **Confirmed** — exactly one commit in its entire history (`c0e0a5f`), never modified since |
| `backend/production/Code.gs` additive-only | **Confirmed** — `diff` shows exactly one non-append line (`CONFIG: 'Config'` → `CONFIG: 'Config',`, value unchanged) plus pure insertions; re-ran the diff this session |
| No accidental deletion of legacy functionality | **Confirmed** — same diff; no legacy line removed |
| No duplicate function definitions | **Confirmed** — zero matches across all 5 `.gs` files (programmatic check) |
| No duplicate API action routing | **Confirmed** — zero duplicate `case` labels (49 unique) |
| No broken `LOAD_ORDER` in test suites | **Confirmed** — all 8 test files declare the identical `['Code.gs', 'ProjectMaster.gs', 'WbsWorkload.gs', 'Organization.gs', 'Reporting.gs']` |
| No test file mutates production source | **Confirmed** — no `fs.writeFile`/`fs.write` call in any test file |
| No new secrets in source | **Confirmed** — repo-wide scan for credential patterns, PIN/password literals, and `HMAC_SECRET`/`SS_ID` hardcoded values: only the pre-existing legacy default PIN (see §5) and Script Property **key names** (never values) found |
| No unexpected build artifacts | **Confirmed** — `git status --short --ignored` is empty; no `node_modules`, `.log`, or `.DS_Store` tracked |

## 3. API Audit

Full matrix in `API_CONTRACT_MATRIX.md` (unchanged from Phase 5.2 —
re-verified programmatically this session that its action list still
matches the live `Code.gs` switch exactly: 49 cases, 42 handlers, zero
orphans, zero undefined references). Final status column:

| Status | Count | Meaning |
|---|---|---|
| **STABLE** | 51 | Routed, authenticated (except `login`/`teamNames` by design), rate-limited, tested, contract unchanged since introduction |
| **STABLE, NO FRONTEND UI** | 13 (subset of the 51) | `updateProjectMaster`, `migrateLegacyProjects`, `updateWBS`, `deleteWBS`, `updateOrgNode`, `saveVacancy`, `getWBS`, `getProjectMaster`, `externalProjectList`, `getSkillLoading`, `getResourceAllocation`, `getWeeklyWorkload`, `getMonthlyWorkload`, `getProjectRisks` — fully functional and tested at the API layer, simply has no page/button calling it yet (a scope note, not a defect; explicitly out of scope to add per this phase's "no new features/no UI redesign" instruction) |
| **CHANGED THIS PHASE (input validation only, contract-compatible)** | 3 | `createWBS`, `updateWBS`, `saveResourceAllocation` now reject a negative `planManDay`/`actualManDay` — a strictly narrower accept-set (Phase 5.2 fix); no existing valid caller is affected |

No contract was silently changed — the one Phase 5.2 behavior change
(negative Man-Day rejection) is documented in `PRODUCTION_READINESS_AUDIT.md`
and re-confirmed unchanged this session via `git diff` between the Phase
5.1 and Phase 5.2 commits (only the three validation guards were added;
no formula, response shape, or field name changed).

## 4. Schema Audit

Full inventory in `SCHEMA_AUDIT.md`, re-verified this session against the
live header/row-array arrays in the `.gs` source (not re-derived from the
doc's own prose):

| Sheet | Columns | Status |
|---|---|---|
| `Team`, `Stages`, `Phases`, `Projects`, `DailyLogs`, `SupportJobs`, `GlobalSupport` | legacy, unchanged | **Untouched** by any Phase 2–5.3 code except `migrateLegacyProjects`'s read-only access to `Projects` |
| `Config` | `Key,Value` + 17 Phase 3–5.1 keys | **Additive** — zero duplicate keys (re-checked programmatically) |
| `PROJECT_MASTER` | 27 | **Additive** — `Country` (Phase 5.1) confirmed still the only new column; row-array length re-verified = 27 for `addProjectMaster` |
| `WBS` | 23 | **Additive**, row-array length re-verified = 23 |
| `RESOURCE_ALLOCATION` | 8 | **Additive**, row-array length re-verified = 8 |
| `ORG_STRUCTURE` | 13 | **Additive**, row-array length re-verified = 13 |

Phase 2–5.2 changes remain 100% additive — confirmed again this session,
not merely re-stated from Phase 5.2.

## 5. Security Audit

Re-traced and re-exercised this session:

- `verifyToken_`/`makeToken_`/`signPayload_`/HMAC handling: byte-identical
  to `backend/legacy/Code.gs` (confirmed by the Part-A diff — these
  functions are not in any modified hunk).
- Token expiry: re-forged an expired-but-validly-signed token this
  session and confirmed rejection (smoke test #25, §12 below).
- Login brute-force: re-triggered 5 wrong-PIN attempts this session and
  confirmed the 6th (even with the correct PIN) is locked (smoke test #4).
- `sanitizeStr_`/`sanitizeObjStrings_`: applied by every write handler in
  every phase (re-checked function-by-function this session).
- No production endpoint bypasses authentication: the gate sits before
  the `switch` in `doPost`, applying to all 49 non-`login` actions
  uniformly — structurally impossible for a `case` to bypass it.
- No secret returned to frontend: confirmed a login response never
  contains the HMAC secret string.
- No HMAC secret stored in any frontend file: `js/app.js`/`index.html`
  contain no `HMAC_SECRET` reference at all (grep-confirmed).
- No new hardcoded production credential was introduced by Phase 2–5.2:
  the only PIN-shaped literal anywhere is `psp2026`, and it is the
  **real, original default already present in `backend/legacy/Code.gs`
  itself** (line 311's seed data) — not invented, not newly hardcoded by
  any later phase.

**`Config!LOGIN_PIN` = `psp2026` (the legacy default).** The repository
contains **no evidence that it has been rotated** in any real deployment
(there is no real deployment yet). Per instruction, this is **not**
changed automatically and **no replacement is invented**. This is
recorded as a **MANUAL PRODUCTION ACTION** (§15) — a decision for PSP to
make in the real `Config` sheet at or before go-live, not something this
repository can or should decide.

## 6. Write Safety

Re-verified this session:

| Action | Verified behavior |
|---|---|
| `createWBS` | Rejects missing `projectId`/`name`, invalid `status`, and (Phase 5.2) negative `planManDay`/`actualManDay`; wrapped in `LockService` |
| `updateWBS` | Rejects missing `id`, invalid `status`, negative Man-Day; wrapped in `LockService` |
| `saveResourceAllocation` | Rejects missing `wbsId`/`engineer`, a nonexistent `wbsId`, and negative Man-Day; wrapped in `LockService` |
| `addProjectMaster` | Rejects invalid `type`, missing `name`/`pic`/`targetDate`, invalid `status` for the type; wrapped in `LockService` |
| `updateProjectMaster` | Rejects missing `id`, a nonexistent `id`, an invalid `status` for the project's type; wrapped in `LockService` |
| `createOrgNode` | Rejects missing `name`, invalid `status`; wrapped in `LockService` |
| `updateOrgNode` | Rejects missing `id`, a nonexistent `id`; wrapped in `LockService` |
| `saveVacancy` | Rejects missing `id`/`idealHeadcount`, a negative `idealHeadcount`; delegates to `updateOrgNode`'s lock (verified by reading the delegation, not assumed) |
| `migrateLegacyProjects` | Read-only against `Projects` (re-confirmed byte-identical before/after two runs this session), additive-only against `PROJECT_MASTER`, `LegacyProjectId`-deduplicated (idempotent — re-ran twice this session: run 1 migrated 14/skipped 0, run 2 migrated 0/skipped 14); wrapped in `LockService` |

**New finding this session**: `deleteWBS` does **not** remove a row — it
is a soft delete, delegating to `handleUpdateWbs_` with `status:
'CANCELLED'`. Confirmed by reading the function body
(`WbsWorkload.gs:229-231`). This satisfies "delete operations are
non-destructive where specified" directly — no destructive delete path
exists anywhere in the write surface.

**ID generation**: `newId_` = `prefix + '_' + Utilities.getUuid().slice(0, 8)`
— an 8-hex-character (32-bit) slice of a full UUID, **identical to
`backend/legacy/Code.gs`'s own `newId_`**, not a Phase 2+ change. Collision
probability is negligible at PSP's real data volume (dozens–hundreds of
records); noted as INFO, not changed (changing it would diverge Phase 2+'s
ID scheme from the legacy one it must stay consistent with).

Read-only reporting actions perform no writes: re-confirmed via
`production-readiness-test.js` Category 7's comprehensive sweep (31
read-only actions, zero sheet mutation) plus a fresh re-run this session.

## 7. Capacity/Manpower Regression

No formula was touched this phase or last (`git diff` between the Phase
5.1 and Phase 5.2 commits shows only the three negative-Man-Day
validation guards — zero calculation logic changed). Re-ran, not just
re-read:

- Multi-week distribution: `distributeManDay_` unchanged; the 9 documented
  edge cases (1-day, cross-week, cross-month, weekend-only, zero MD,
  negative MD clamp, missing dates, inverted range) still pass.
- Project + Irregular Job workload reconciliation: still holds
  (`byType.EXTERNAL + byType.INTERNAL + byType.IRREGULAR == totalPlannedMD`).
- Skill loading, engineer loading, manpower analysis, manpower scenario:
  unchanged, all pass.
- Management baseline: still a pure `Config` read, never written by any
  engine — re-verified by editing the Config value directly and
  confirming zero effect on any calculated figure.
- Current MP: still computed live from `Team.length` everywhere, never
  cached.

The following are re-affirmed as **documented design decisions**, not
defects, per this phase's explicit instruction not to second-guess them
without evidence of an actual defect: the capacity model's `UTILIZATION_FACTOR`
as the single Net Capacity multiplier (allowances shown for breakdown
only), the even-distribution multi-week model, the Team-based Current MP
calculation, and the Management Baseline's read-only reference status.
No evidence of an actual defect in any of these was found this session.

## 8. Reporting Regression

All 6 reporting endpoints (`getExecutiveDashboard`, `getProjectRisks`,
`getProjectsNeedAttention`, `getExternalWeeklyReport`,
`getInternalWeeklyReport`, `getReportingPreview`) unchanged since Phase
5.1; re-ran their full test coverage (72 checks across phase5-test.js and
phase5.1-test.js) this session with zero failures. Project health,
project risk (including `primaryReasonKey`/`primaryReason`/`primarySource`
and the closed-project exemptions), and Data Quality integration all
re-confirmed consistent with `PROJECT_HEALTH_MODEL.md`.

## 9. Frontend Audit

Re-verified programmatically this session against the current
`index.html`/`js/app.js` (not reused from a prior session's output):

- Every `apiPost`/`apiGet` action name called by the frontend resolves to
  a real backend action — zero mismatches.
- Every nav `data-page` has a matching `page-*` section and vice versa
  (excluding `dashboard`, which has no nav entry by original design).
- Every `goPage('X')` call resolves to a real section.
- `js/app.js` parses cleanly (`node --check`).
- `index.html`'s `<section>` tags balance (27 open / 27 close).
- No frontend file was modified this phase — Phase 1–5.1 pages are
  unchanged and untouched.

No obsolete action name is called by the frontend. No UI was added,
removed, or redesigned this phase, per instruction.

## 10. Test Results

| Suite | Result |
|---|---|
| `backend/test/smoke-test.js` (Phase 1) | 17 checks passed |
| `phase2-test.js` | 23 passed, 0 failed |
| `phase3-test.js` | 27 passed, 0 failed |
| `phase3.1-test.js` | 17 passed, 0 failed |
| `phase3.1-scenario-test.js` | 5 passed, 0 failed |
| `phase4-test.js` | 32 passed, 0 failed |
| `phase5-test.js` | 27 passed, 0 failed |
| `phase5.1-test.js` | 45 passed, 0 failed |
| `production-readiness-test.js` | 40 passed, 0 failed |
| **Total** | **233 passed, 0 failed** |

No test was weakened, skipped, or deleted. No genuine defect was found
this phase requiring a code fix (the write-safety and schema items above
were all confirmations of already-correct behavior, not fixes) — the
existing test count did not need to grow to close Phase 5.2's conditions,
since every open condition was closable by direct re-verification.

## 11. Real-GAS Verification Requirements

Classified per Step 10 — everything that genuinely cannot be verified
from this repository:

| Item | Classification |
|---|---|
| `backend/legacy/Code.gs` additive-only relative to `backend/production/Code.gs` | **VERIFIED LOCALLY** |
| All 5 `.gs` files are valid, mutually compatible V8 syntax with zero name collisions | **VERIFIED LOCALLY** |
| Authentication chain (token issuance/verification/expiry/brute-force/rate-limit) logic | **VERIFIED LOCALLY** (via mock re-execution) |
| Schema additive-only, `setupSpreadsheet()` idempotency | **VERIFIED LOCALLY** (via mock re-execution, including a simulated pre-existing sheet) |
| Migration additive/idempotent/non-destructive | **VERIFIED LOCALLY** (via mock re-execution) |
| Capacity/manpower/reporting formulas | **VERIFIED LOCALLY** (independently recomputed by hand this and the prior phase) |
| Frontend↔backend contract | **VERIFIED LOCALLY** (source-level, programmatic) |
| The real `appsscript.json` (`webapp.access`/`executeAs`, `timeZone`, `runtimeVersion`) | **REQUIRES REAL GAS VERIFICATION** — no copy of the real manifest exists in this repository |
| Actual GAS project configuration / Script Properties (`HMAC_SECRET`, `SS_ID`) | **REQUIRES REAL GAS VERIFICATION** — these are runtime state of the live project, not repository content |
| The real `Config` sheet's current values (especially `LOGIN_PIN`) | **REQUIRES REAL GAS VERIFICATION** — this repository has no read access to the live spreadsheet |
| Deployed Web App URL / deployment version | **REQUIRES REAL GAS VERIFICATION** |
| **Concurrent `LockService` mutual exclusion under real simultaneous requests** | **REQUIRES REAL GAS VERIFICATION** — the mock's `LockService` is a documented no-op call-counter; no test anywhere (this phase or prior) can prove real concurrency safety |
| Actual Google Sheets permissions / sharing on the real spreadsheet | **REQUIRES REAL GAS VERIFICATION** |
| Actual Web App execution identity (`executeAs: USER_DEPLOYING` behavior in practice) | **REQUIRES REAL GAS VERIFICATION** |
| Real API response latency/behavior under Apps Script's actual execution environment (quotas, execution time limits) | **REQUIRES REAL GAS VERIFICATION** |
| Actual CORS/browser behavior when GitHub Pages calls the real Web App URL | **REQUIRES REAL GAS VERIFICATION** — the `text/plain` content-type workaround in `apiPost` is a known Apps Script CORS pattern, but has only ever been exercised against the mock in this repository |
| Real production data (real Team roster, real projects) behavior at real scale | **REQUIRES REAL GAS VERIFICATION** |

None of the "REQUIRES REAL GAS VERIFICATION" rows are treated as a
software defect — they are access-scope limitations of this environment,
exactly as instructed.

## 12. Deployment Smoke-Test Checklist

Executed against the local mock GAS harness this session (**not** the
real environment — every row below is MOCK-VERIFIED, pending final
confirmation in the real GAS test environment per `DEPLOYMENT_RUNBOOK.md`
stage B):

| # | Action | Input | Expected Result | Pass/Fail (mock) | Evidence |
|---|---|---|---|---|---|
| 1 | `setupSpreadsheet()` | (none) | All sheets created/verified, idempotent | **PASS** | 12 sheets present after run |
| 2 | login | `{name:'Sukiyo', pin:'psp2026'}` | `ok:true`, token issued | **PASS** | `{"ok":true,"hasToken":true}` |
| 3 | invalid login | `{name:'Sukiyo', pin:'WRONG'}` | `ok:false`, generic error | **PASS** | `{"ok":false,"message":"Nama atau PIN salah."}` |
| 4 | brute-force lock | 5× wrong PIN, then correct PIN | 6th attempt locked even with correct PIN | **PASS** | `{"ok":false,"message":"Terlalu banyak percobaan gagal..."}` |
| 5 | bootstrap | token | `ok:true` | **PASS** | `true` |
| 6 | create Project Master | EXTERNAL, required fields | `ok:true`, id issued | **PASS** | `{"ok":true,"id":"pm_..."}` |
| 7 | update Project Master | `{id, status:'EXECUTION'}` | `ok:true`, status updated | **PASS** | `{"ok":true,"status":"EXECUTION"}` |
| 8 | create WBS | `{projectId, name}` | `ok:true`, id issued | **PASS** | `{"ok":true,"id":"wbs_..."}` |
| 9 | allocate Man-Day | `{wbsId, engineer, planManDay:2}` | `ok:true` | **PASS** | `{"ok":true}` |
| 10 | workload summary | `{periodType:'week'}` | `ok:true` | **PASS** | `true` |
| 11 | capacity summary | `{periodType:'week'}` | `ok:true` | **PASS** | `true` |
| 12 | manpower analysis | `{periodType:'week'}` | `ok:true` | **PASS** | `true` |
| 13 | organization structure | create then read | both `ok:true` | **PASS** | `{"createOk":true,"readOk":true}` |
| 14 | vacancy | `{}` | `ok:true` | **PASS** | `true` |
| 15 | scenario | `{periodType:'week'}` | `ok:true`, 5 scenarios | **PASS** | `true` |
| 16 | executive dashboard | `{}` | `ok:true` | **PASS** | `true` |
| 17 | external weekly report | `{}` | `ok:true` | **PASS** | `true` |
| 18 | internal weekly report | `{}` | `ok:true` | **PASS** | `true` |
| 19 | data quality | `{}` | `ok:true` | **PASS** | `true` |
| 20 | legacy migration dry run | `{}` | migrates every eligible legacy row, 0 skipped | **PASS** | `{"migrated":14,"skipped":0}` |
| 21 | verify legacy Projects unchanged | (compare before/after) | byte-identical | **PASS** | `true` |
| 22 | repeat migration, verify idempotency | `{}` | `migrated:0`, `skipped` = legacy count | **PASS** | `{"migrated":0,"skipped":14}` |
| 23 | rate-limit test | 61 cumulative requests within a minute for one user | request beyond the 60th is blocked | **PASS** | blocked at cumulative request #43 in this run (≈18 prior calls in the same script + the 43rd new one = the 61st request overall for that user — confirms the shared, cumulative-per-user counter, not a fresh-per-action one) |
| 24 | invalid token | `token:'garbage-token'` | `authError:true` | **PASS** | `{"ok":false,"authError":true,...}` |
| 25 | expired token | validly-signed, `exp` in the past | `authError:true` | **PASS** | `{"ok":false,"authError":true,...}` |

**25/25 PASS on the mock.** This checklist must be re-run item-by-item
against the real GAS test deployment (`DEPLOYMENT_RUNBOOK.md` stage B)
before production cutover — mock success is necessary but not sufficient
evidence for the real environment (see §11's concurrency and CORS rows in
particular, which the mock cannot exercise at all).

## 13. Release Gate

| Category | Status | Evidence | Blocker? |
|---|---|---|---|
| Repository integrity | **PASS** | §2 | No |
| API contract | **PASS** | §3, `API_CONTRACT_MATRIX.md` | No |
| Schema | **PASS** | §4, `SCHEMA_AUDIT.md` | No |
| Authentication | **PASS** | §5 | No |
| Security | **PASS WITH CONDITION** | §5 — `Config!LOGIN_PIN` rotation is a real, open manual action, not a code defect | No (manual action, not a code blocker) |
| Write safety | **PASS** | §6 | No |
| Migration | **PASS** | §6, §12 items 20–22 | No |
| Capacity model | **PASS** | §7 | No |
| Manpower | **PASS** | §7 | No |
| Reporting | **PASS** | §8 | No |
| Frontend | **PASS** | §9 | No |
| Automated tests | **PASS** | §10 — 233/233 | No |
| Deployment documentation | **PASS** | `DEPLOYMENT_RUNBOOK.md` updated this phase with explicit A/B/C/D staging | No |
| Real GAS environment | **NOT VERIFIABLE FROM THIS REPOSITORY** | §11 | **Conditionally blocking** — not a defect, an access-scope limitation |
| Production smoke test | **PASS ON MOCK, PENDING REAL EXECUTION** | §12 | **Conditionally blocking** — must be re-run for real before go-live |

## 14. Remaining Risks

- **Concurrency is genuinely unproven.** No test, mock or otherwise, in
  this repository can demonstrate that `LockService` prevents a real
  race condition under simultaneous real requests. This is the single
  most important item to watch during the real test-environment
  deployment (`DEPLOYMENT_RUNBOOK.md` stage B).
- **`LOGIN_PIN` is still the well-known legacy default.** A real,
  human decision to rotate it (or not) must be made before go-live — this
  repository does not decide it.
- **Read-amplification in `getExecutiveDashboard`** (several redundant
  full-sheet reads per request, documented in `PRODUCTION_READINESS_AUDIT.md`
  Part J) remains unoptimized, by explicit instruction. Low risk at PSP's
  current real scale; worth monitoring if usage grows substantially.
- **13 backend actions have no frontend UI** — a scope note, not a risk,
  but worth remembering so nobody assumes migration/edit/delete
  capabilities are reachable by end users today.
- **`newId_`'s 8-hex-character ID space** is inherited unchanged from the
  legacy source; negligible collision risk at realistic scale, not
  something Phase 2+ should diverge from independently.

## 15. Exact Manual Actions Required

1. Execute `DEPLOYMENT_RUNBOOK.md` stage A (already satisfied by this
   report) then stage B in full, in a real GAS test environment, using
   the §12 checklist item-by-item with real evidence filled in.
2. Confirm the real project's live `appsscript.json` against the
   requirements in `DEPLOYMENT_RUNBOOK.md` §M6 — no copy exists in this
   repository to check against.
3. Decide whether to rotate `Config!LOGIN_PIN` away from `psp2026` in the
   real spreadsheet, before or at go-live — a PSP business decision, not
   a code change.
4. Verify real concurrent-write behavior in the test environment
   (simultaneous writes from two sessions) before relying on it in
   production.
5. Do one final human side-by-side diff of the currently-live `Code.gs`
   against `backend/legacy/Code.gs` immediately before pasting, in case
   the live script has drifted since the legacy copy was captured.
6. Rehearse `ROLLBACK_PLAN.md` in the test environment
   (`DEPLOYMENT_RUNBOOK.md` stage B, M18) before the production cutover.

## 16. Final Recommendation

Repository release candidate is ready, but production deployment remains
conditionally blocked pending real GAS verification.

**STATUS: 🟡 GO WITH CONDITIONS — EXPLICITLY BLOCKED ITEMS**

Blocked items are exactly and only those listed as "REQUIRES REAL GAS
VERIFICATION" in §11 and the two "conditionally blocking" rows in §13 —
nothing else. No P0/FAIL exists in any repository-verifiable category.

---

PHASE 5.3 STATUS: READY FOR REVIEW — DO NOT START PHASE 6.
