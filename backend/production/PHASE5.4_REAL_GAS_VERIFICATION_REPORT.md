# Phase 5.4 — Real Google Apps Script Verification: Access-Boundary Report

Branch `phase5-4-real-gas-verification`, based on
`phase5-3-pre-production-readiness`. **This phase's objective — "prove
that the repository release candidate can safely operate in the real
Google Apps Script environment" — could NOT be attempted, because this
session has no access to any real Google Apps Script project, real
Google Sheets spreadsheet, Script Properties, or deployed Web App
endpoint.** No such access was granted, configured, or made available at
any point in this conversation.

Per this phase's own explicit instruction ("If access to the real GAS
project is unavailable, STOP at the access boundary and report exactly
what remains unverified. Do NOT fabricate verification results.") and its
repeated restatement in Section G ("Do NOT claim PASS from mock
testing"), Section H ("Do not collapse UNVERIFIED into PASS"), and
Section O (absolute stop conditions), this report does not claim, imply,
or approximate any real-GAS test result. Every item that requires real
GAS access is recorded as **UNVERIFIED**, not PASS, not FAIL.

**Nothing was deployed. No real Google account, project, or spreadsheet
was contacted.**

## Confirming the access boundary (not assumed — checked this session)

- `ListConnectors` (Google/Sheets/Apps Script/Workspace keywords): **empty result** — no such connector exists for this account/session.
- `ToolSearch` for a Google Apps Script / Sheets / browser deployment tool: no matching tool found.
- No credential, deployment URL, service-account key, or OAuth token for any real GAS project was supplied anywhere in this conversation.
- This session's tool surface is: local filesystem/shell (this repository only), GitHub (for this repository), web search/fetch (public web only, and WebFetch explicitly cannot authenticate to Google services), and generic scheduling/monitoring tools — none of which can reach `script.google.com`, the Apps Script API, or a private deployed Web App requiring a session login.

Given this, Sections C through M of the Phase 5.4 brief (real test
environment verification, real spreadsheet verification, real security
verification, real concurrency test, real API smoke test, real
frontend↔API verification, real rollback rehearsal, real performance
check) are **structurally impossible to perform from this session** —
not merely inconvenient. What follows documents this precisely, section
by section, and re-confirms everything that **can** still be checked
from the repository alone (unchanged in outcome from Phase 5.3, but
re-executed fresh this session, not assumed).

## 1. Environment

No real GAS environment was reachable or identified this session.
**No environment identifier, project ID, spreadsheet ID, or deployment
URL exists to report** — none was provided, and this repository does not
contain one (confirmed already in Phase 5.2/5.3: no `appsscript.json` is
tracked for `backend/production/`, only the superseded Phase 1 scaffold's
`backend/appsscript.json`, which is not the real manifest).

## 2. Deployment ID / Version

**UNVERIFIED — not applicable.** Nothing was deployed this phase or any
prior phase. There is no deployment ID or version to report.

## 3. `appsscript.json` Verification

**UNVERIFIED.** No real project manifest is accessible. Re-confirmed this
session (as in Phase 5.2/5.3) that no `appsscript.json` for
`backend/production/` exists anywhere in this repository — `DEPLOYMENT_RUNBOOK.md`
§M6 already documents the exact fields a human must check
(`webapp.access`, `webapp.executeAs`, `timeZone: "Asia/Jakarta"`,
`runtimeVersion: "V8"`) once real access exists.

## 4. Spreadsheet Verification

**UNVERIFIED** for the real spreadsheet. What **is** re-confirmed this
session, from the repository's own schema source (not the real
spreadsheet, which is unreachable):

- `SCHEMA_AUDIT.md`'s inventory still matches the live header/row-array
  arrays in `backend/production/*.gs` — re-checked by counting array
  lengths again this session: `PROJECT_MASTER` = 27 columns, `WBS` = 23,
  `RESOURCE_ALLOCATION` = 8, `ORG_STRUCTURE` = 13.
- The additive-only diff against `backend/legacy/Code.gs` still holds
  (one mechanical comma, zero other non-append lines).

None of this proves the **real** spreadsheet's actual current headers,
data, or permissions match — that requires opening the real spreadsheet,
which this session cannot do.

## 5. Security Verification

**UNVERIFIED against the real environment.** Re-confirmed against the
repository/mock this session (unchanged from Phase 5.2/5.3, re-executed
fresh, not assumed):

- Token issuance/verification/expiry, forged-token rejection,
  brute-force lockout, rate limiting, and formula-injection sanitization
  all still behave correctly against the mock GAS harness (233/233 tests
  including `production-readiness-test.js`'s dedicated auth-gate
  category, re-run this session).
- No `HMAC_SECRET` value (only the key **name**) appears anywhere in
  `backend/production/*.gs`, `js/app.js`, or `index.html` — re-confirmed
  by grep this session.
- `Config!LOGIN_PIN`'s value in the **real** spreadsheet cannot be
  checked from here — see §13.

**None of this constitutes real-GAS security verification.** A mock
proving the logic is internally consistent is not the same as observing
`verifyToken_`/`checkRateLimit_`/`LockService` behave correctly under
Google's actual V8 runtime, actual `CacheService`, and actual concurrent
request handling.

## 6. Authentication Verification

**UNVERIFIED against real GAS.** See §5. The mock-level behavior (login,
invalid login, brute-force lock, valid/invalid/expired/forged token
handling) was re-exercised this session with identical results to Phase
5.3 (25/25 on the mock smoke-test script) — but this is the same
evidence as before, not new real-environment evidence, and is reported
as such.

## 7. Rate-Limit Verification

**UNVERIFIED against real GAS.** The mock's `CacheService` has no real
60-second TTL (a documented limitation of the test harness itself, not
of the production code) — so even "rate limiting works" as tested in
this repository only proves the *counting* logic is correct, not that a
real 60-second window resets correctly under Google's actual
`CacheService`. This exact caveat was already flagged in Phase 5.2/5.3
and remains open.

## 8. LockService Concurrency Verification

**UNVERIFIED — cannot be executed from this session, by design of the
task itself.** Section G of this phase's brief requires "a controlled
staging test that attempts simultaneous writes to the same resource" in
a **real** environment. This session has no ability to issue two
genuinely concurrent HTTP requests against a real Apps Script Web App
(no real deployment exists to target, and no such capability exists in
this session's tool surface regardless). The mock's own `LockService` is
an explicitly documented no-op call-counter (`mock-gas-v2.js`'s own
comment: "does not provide real mutual exclusion, since these tests run
single-threaded") — so no test in this repository, past or present, can
answer this question. Per instruction, this is marked **UNVERIFIED**, not
PASS, and no mock result is substituted for it.

## 9. API Smoke-Test Results

**UNVERIFIED against real GAS for all 25 items.** The identical 25-item
checklist from `DEPLOYMENT_RUNBOOK.md`/`PHASE5.3_PRE_PRODUCTION_REPORT.md`
§12 was **not** re-run against any real environment this session (none
exists to run it against). Re-running it against the mock again would
only reproduce Phase 5.3's already-recorded mock result — doing so and
presenting it again here would risk exactly the "collapse UNVERIFIED into
PASS" this phase explicitly forbids. Status for all 25 items:

| # | Item | Status |
|---|---|---|
| 1–25 | (identical list: setupSpreadsheet, login, invalid login, brute-force lock, bootstrap, Project Master CRUD, WBS, allocation, workload, capacity, manpower, organization, vacancy, scenario, executive dashboard, project risk, attention list, external/internal weekly report, reporting preview, data quality, legacy migration + idempotency, legacy-unchanged check, rate limiting, invalid token, expired token) | **UNVERIFIED** (real GAS) — see `PHASE5.3_PRE_PRODUCTION_REPORT.md` §12 for the mock-level result (25/25 PASS on mock), which stands as repository-level evidence only, not real-GAS evidence |

## 10. Frontend / Real-API Verification

**UNVERIFIED.** No real deployment URL exists to point `js/app.js`'s
`PSP_API_URL` at. Repository-level frontend↔backend contract (action
names, payload shapes, response field usage, `authError` handling) was
re-verified programmatically this session — identical, zero-defect
result to Phase 5.3 (every `apiPost`/`apiGet` call resolves; every nav
item, section, and `goPage()` target resolves; `js/app.js` parses
cleanly). This proves the **contract** is internally consistent; it does
not prove the frontend actually receives correct responses from a real
deployed Web App, real CORS headers, or a real execution identity.

## 11. Rollback Rehearsal

**UNVERIFIED — not executed.** `ROLLBACK_PLAN.md`'s procedure requires a
real (or at minimum a real-equivalent staging) GAS project and
spreadsheet to rehearse against (restoring a `Code.gs` version, removing
files, repointing a Web App deployment). None exists in this session.
The plan itself was re-read this session and remains internally
consistent with the current repository state (file list, rollback steps
reference the correct 5 `.gs` files and the correct sheet names) — but
"the document is internally consistent" is not the same as "the
procedure was rehearsed," and this report does not claim the latter.

## 12. Performance Sanity Check

**UNVERIFIED — not measured.** No real deployed endpoint exists to time.
`PRODUCTION_READINESS_AUDIT.md` Part J's finding stands unchanged: local
static analysis identified `getExecutiveDashboard` as performing several
redundant full-sheet reads per request, classified MEDIUM risk at PSP's
expected real data volume — this is a code-shape observation, not a
measured real-GAS response time, and is not upgraded to a measurement
here.

## 13. LOGIN_PIN Status

**Config!LOGIN_PIN in the real spreadsheet: UNVERIFIED — cannot be read
from this session.** The repository's own seed data (`backend/legacy/Code.gs`
line 311) sets the default to `psp2026`; no evidence exists anywhere in
this repository that the **real** production `Config` sheet has ever been
changed from that default, because this session cannot read the real
sheet at all.

**LEGACY DEFAULT STILL ACTIVE — MANUAL ROTATION REQUIRED** (reported per
instruction; not changed, not rotated, no replacement invented; the real
production PIN, if different from this documented default, is not known
to and was not requested from this session, and would not be committed
to the repository regardless).

## 14. Remaining Risks

Unchanged from Phase 5.3, with one addition:

- **Every item in Sections 5–12 above is a real, open risk precisely
  because it is unverified**, not because a defect was found. The
  repository cannot self-certify real-environment behavior.
- Concurrency (§8) remains the single highest-value item to verify first
  once real access exists — it is the one property no amount of
  repository-level testing can ever substitute for.
- `LOGIN_PIN` rotation (§13) remains a pending human decision.
- (Unchanged) `getExecutiveDashboard` read-amplification, absence of a
  frontend UI for 13 backend actions, `newId_`'s 8-hex-char ID space —
  all previously documented, none newly discovered this phase.

## 15. Unverified Items (complete list)

Real `appsscript.json`; real Script Properties (`HMAC_SECRET`, `SS_ID`);
real `Config` sheet contents including `LOGIN_PIN`; real `Team` and all
other real sheet contents/headers/permissions; Web App deployment
configuration, execution identity, access list, deployed version,
deployment ID, endpoint URL; real login/token/expiry/brute-force/rate-limit
behavior; real formula-injection protection under Google's actual
runtime; real `LockService` concurrency; real `CacheService` behavior;
all 25 API smoke-test items against a real endpoint; real frontend↔API
behavior including real CORS; rollback rehearsal against a real or
staging project; real performance/response-time measurements. **Every
item in Sections C through M of this phase's brief.**

## 16. Final Recommendation

Nothing in this session changed the repository's readiness relative to
Phase 5.3 — because nothing that Phase 5.4 asks for could be attempted
without real GAS access, which was not available. The repository release
candidate remains exactly as ready as `PHASE5.3_PRE_PRODUCTION_REPORT.md`
found it: all repository-verifiable checks pass (233/233 tests, additive
diff intact, contracts consistent), and every production-blocking
question that only a real environment can answer is still open.

**Repository release candidate is ready, but production deployment
remains conditionally blocked pending real GAS verification** — restated
here exactly because Phase 5.4 could not close that gap, not because a
new defect was found.

PRODUCTION DEPLOYMENT STATUS: **NOT DEPLOYED**

PHASE 5.4 RELEASE GATE: **🟡 GO WITH CONDITIONS**

No 🔴 NO-GO condition exists (no critical production-blocking defect was
found — nothing was found at all, because nothing real was reachable to
test). No 🟢 GO is possible, because the required real-GAS checks in
Sections C–M were not performed and are not claimed to have been.

## What would allow this phase to actually proceed

None of the following are requests being made automatically — they are
listed so a human knows exactly what unlocks the next step:

1. A real (or staging) Google Apps Script Web App URL this session could
   send HTTP requests to, reachable over the public internet or via a
   connector this session has access to.
2. Read access to the real `Config` sheet (or the human reporting its
   `LOGIN_PIN` value out-of-band) — not committed to this repository
   either way.
3. A way to issue genuinely concurrent requests against that real
   deployment (even two overlapping `curl` calls from this session would
   be sufficient for §8, if a real endpoint existed to target).
4. Explicit human approval before any of the above touches a **production**
   (as opposed to disposable test/staging) project or spreadsheet, per
   this phase's own hard safety rule.

Absent all of the above, the honest and only correct status remains
🟡 GO WITH CONDITIONS, with production deployment NOT DEPLOYED.
