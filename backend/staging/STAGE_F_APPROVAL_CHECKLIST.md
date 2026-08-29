# Stage F — Human Approval Checklist (GO / NO-GO for Production)

This is a **template**. Every row below is `PENDING` because Stages B–E
have not been executed against any real Google Apps Script environment —
this coding session has no such access (see
`backend/staging/PHASE5.5_STAGING_ACCESS_GUIDE.md`). Fill in each row
only after actually performing the corresponding stage against the real
staging project, then bring the filled-in results back for a final
recommendation before Stage G is ever considered.

**No row here may be marked PASS from a mock or local test.** Only a real
result against the real staging Web App URL counts.

| # | Item | Stage | Result | Evidence | Blocking? |
|---|---|---|---|---|---|
| 1 | Real GAS API smoke test (25 items) | B | `PENDING` | run `staging-smoke-test.js` against `STAGING_WEB_APP_URL`, paste the summary line | Yes — any FAIL blocks |
| 2 | Real concurrency result (LockService) | D | `PENDING` | run `concurrency-test.js`; also manually confirm `PROJECT_MASTER!LegacyProjectId` has no duplicates | Yes — this is the one property no mock can substitute for |
| 3 | Script Properties verification (`HMAC_SECRET`, `SS_ID` present; secret never returned by any API) | B/E | `PENDING` | `SECURITY_VERIFICATION.md` §"Script Properties" | Yes |
| 4 | Config sheet verification (17 Phase 3–5.1 keys present, no duplicates, `MANAGEMENT_BASELINE_ADDITIONAL_MP` unchanged) | B | `PENDING` | compare against `backend/production/SCHEMA_AUDIT.md` | Yes |
| 5 | `LOGIN_PIN` rotation decision | E | `PENDING` | state only whether it is still the legacy default (`LEGACY DEFAULT ACTIVE — ROTATION REQUIRED`) or has been rotated — **never paste the actual value here or anywhere in this repository** | Yes — must be a deliberate decision, not silence |
| 6 | Spreadsheet/Web-App sharing permissions | E | `PENDING` | `SECURITY_VERIFICATION.md` §"Web App configuration" | Yes |
| 7 | Web App execution identity (`executeAs`/`access` match `appsscript.json`) | B | `PENDING` | Deploy → Manage deployments, compared against `backend/staging/appsscript.json` | Yes |
| 8 | CORS / real browser behavior result | E | `PENDING` | frontend staging pages load without a console CORS error | Yes |
| 9 | Legacy-data integrity (Team/Projects/DailyLogs/SupportJobs/GlobalSupport unchanged after setup + migration) | B/C | `PENDING` | compare a spreadsheet snapshot before/after `setupSpreadsheet()` and `migrateLegacyProjects` | Yes |
| 10 | Frontend staging result (every page, no console error, no "Aksi tidak dikenal") | E | `PENDING` | click-through checklist in `DEPLOYMENT_RUNBOOK.md` Stage D | Yes |
| 11 | Rollback rehearsal result (against staging) | A/E | `PENDING` | `ROLLBACK_PLAN.md` rehearsed against the staging project per `STAGING_SETUP_CHECKLIST.md` step O | Yes |

## Recommendation

Cannot be filled in until every row above is `PASS`. As of this
checklist's creation: **0 of 11 items have a real result — Stage G
(Production Deployment) is not reachable yet.**

## Sign-off

- [ ] I have personally reviewed every row above with a real result, not a mock or assumption.
- [ ] `Config!LOGIN_PIN`'s status (row 5) reflects a deliberate decision, not an oversight.
- [ ] I explicitly approve proceeding to Stage G (Production Deployment).

Approved by: ______________________  Date: ______________
