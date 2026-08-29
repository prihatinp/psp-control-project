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
| 1 | Real GAS API smoke test (25 items) | B | `PASS` | reported by human operator: 25/25 PASS | Yes — any FAIL blocks |
| 2 | Real concurrency result (LockService) | D | `PASS` | reported: concurrency test PASS; `PROJECT_MASTER!LegacyProjectId` checked manually, no duplicates found | Yes — this is the one property no mock can substitute for |
| 3 | Script Properties verification (`HMAC_SECRET`, `SS_ID` present; secret never returned by any API) | B/E | `PENDING — not yet explicitly confirmed` | not reported separately from the smoke test; needs an explicit look at Script Properties per `SECURITY_VERIFICATION.md` §"Script Properties" | Yes |
| 4 | Config sheet verification (17 Phase 3–5.1 keys present, no duplicates, `MANAGEMENT_BASELINE_ADDITIONAL_MP` unchanged) | B | `PASS` | reported: "17 Config keys: PASS" (Stage B) | Yes |
| 5 | `LOGIN_PIN` rotation decision | E | `PASS — ROTATED` | human confirmed the PIN has been rotated away from the legacy default (value itself never disclosed or recorded) | Yes — must be a deliberate decision, not silence |
| 6 | Spreadsheet/Web-App sharing permissions | E | `PENDING — not yet explicitly confirmed` | "Web App deployment: PASS" was reported, but sharing/permissions specifically (per `SECURITY_VERIFICATION.md` §"Web App configuration") was not called out separately | Yes |
| 7 | Web App execution identity (`executeAs`/`access` match `appsscript.json`) | B | `PENDING — not yet explicitly confirmed` | same as row 6 — "Web App deployment: PASS" likely covers this, but not stated explicitly | Yes |
| 8 | CORS / real browser behavior result | E | `PASS` | reported: "CORS: PASS", "Browser console: NO ERROR" | Yes |
| 9 | Legacy-data integrity (Team/Projects/DailyLogs/SupportJobs/GlobalSupport unchanged after setup + migration) | B/C | `PENDING — not yet explicitly confirmed` | migration idempotency (row-count behavior) was confirmed via "migration #2: PASS, 0 migrated", but a direct before/after check that the legacy sheets themselves are untouched was not separately reported | Yes |
| 10 | Frontend staging result (every page, no console error, no "Aksi tidak dikenal") | E | `PASS` | reported: "All pages: PASS", "Browser console: NO ERROR" | Yes |
| 11 | Rollback rehearsal result (against staging) | A/E | `PENDING — not reported at all` | `STAGING_SETUP_CHECKLIST.md` step O / `DEPLOYMENT_RUNBOOK.md` Stage A's rollback rehearsal was not mentioned in the results provided | Yes |

## Recommendation

**7 of 11 items PASS. 4 items (rows 3, 6, 7, 9, 11 — note row 11 wasn't
mentioned at all) still need an explicit confirmation before this
checklist can honestly be called complete.** Rows 6 and 7 are likely
already covered in substance by "Web App deployment: PASS" but were not
stated as their own line item, so they are listed as pending rather than
assumed. **Stage G is not yet reachable — the outstanding items must be
confirmed (not assumed) first, especially row 11 (rollback rehearsal),
which was not mentioned at all and is the one item this checklist
treats as non-negotiable per `DEPLOYMENT_RUNBOOK.md`.**

## Sign-off

- [ ] I have personally reviewed every row above with a real result, not a mock or assumption.
- [ ] `Config!LOGIN_PIN`'s status (row 5) reflects a deliberate decision, not an oversight.
- [ ] I explicitly approve proceeding to Stage G (Production Deployment).

Approved by: ______________________  Date: ______________
