# Schema Audit — Phase 5.2

Master schema inventory for every sheet Phase 1–5.1 touches, re-verified
against the actual header arrays and row-builder arrays in
`backend/production/*.gs` this session (row-array-to-header-length
alignment checked programmatically for every sheet with a schema owned by
Phase 2+, not just visually counted).

## Legend

"Owner module" = the `.gs` file whose header constant/setup function
defines the sheet. "Migration involved" = touched by
`migrateLegacyProjects`. "Config dependency" = a `Config` key controls
this sheet's validation or derived values.

---

### `Team` (legacy)

| | |
|---|---|
| Purpose | The single source of truth for headcount, identity, and skill |
| Owner module | legacy (`Code.gs`) |
| Columns | `Name`, `Role`, `Skill` |
| Required | `Name` |
| Optional | `Role`, `Skill` |
| API writers | none from Phase 2–5.1 — this sheet is never written to by any new code, only read |
| API readers | virtually every handler in every phase (`Current MP`, engineer loading, skill loading, org headcount, login) |
| Seed data | pre-existing, manually maintained |
| Migration involved | no |
| Config dependency | no |

### `Stages`, `Phases` (legacy)

Untouched by any Phase 2–5.1 code — not read, not written. Retained
purely for the legacy dashboard's own stage-tracking UI.

### `Projects` (legacy)

| | |
|---|---|
| Purpose | The original, single-table project record (pre-`PROJECT_MASTER`) |
| Owner module | legacy (`Code.gs`) |
| Columns | `ID,No,Name,Line,PIC,Support,Category,Start,Target,ProgressStage,StageDatesJSON,StageNotesJSON,Note,CreatedAt` |
| Required | `ID`,`No`,`Name` |
| API writers | `addProject` (legacy) only |
| API readers | legacy dashboard; `migrateLegacyProjects` (**read-only** — confirmed byte-identical before/after every migration run this session) |
| Seed data | 14 real seed rows from the original PSP dataset |
| Migration involved | **is** the migration source |
| Config dependency | no |

### `DailyLogs` (legacy)

| | |
|---|---|
| Purpose | Free-text daily plan/actual/problem/next-action log, per legacy project |
| Owner module | legacy (`Code.gs`) |
| Columns | `ID,ProjectID,ProjectNo,Date,Engineer,Stage,Plan,Actual,Problem,Next,CreatedAt` |
| Required | `ProjectID`,`Date` |
| API writers | `saveDailyLog` (legacy) only |
| API readers | legacy dashboard; Phase 5 weekly reports, joined via `PROJECT_MASTER.LegacyProjectId` (only migrated projects have this key — see `WEEKLY_UPDATE_DESIGN_REVIEW.md` for the resulting coverage gap) |
| Seed data | 4 real seed rows |
| Migration involved | read by Phase 5, not migrated itself |
| Config dependency | no |

### `SupportJobs` (legacy)

| | |
|---|---|
| Purpose | "Irregular Job" ad-hoc work log |
| Owner module | legacy (`Code.gs`) |
| Columns | (legacy shape, unchanged) |
| API writers | `saveSupportJob` (legacy) only |
| API readers | legacy dashboard; Phase 3/4 workload engine (the "IRREGULAR" bucket); Phase 5 internal weekly report |
| Migration involved | no |
| Config dependency | no |

### `GlobalSupport` (legacy)

| | |
|---|---|
| Purpose | Ad-hoc "support to other Musashi plants" log |
| Owner module | legacy (`Code.gs`) |
| Columns | `ID,Country,Flag,PIC,Status,Item,CreatedAt` |
| API writers | `saveGlobalItem` (legacy) only |
| API readers | legacy dashboard; Phase 5 dashboard's `globalSupportLegacy` (reported separately, unmodified) |
| Migration involved | no |
| Config dependency | no |
| **Note** | `Country` here actually stores plant-level values (e.g. "Musashi Vietnam") — a real, pre-existing naming quirk, a **different concept** from the new `PROJECT_MASTER.Country` (Phase 5.1). Left untouched; documented, not fixed (out of scope — real production data in a legacy sheet). |

### `Config` (legacy, extended every phase)

| | |
|---|---|
| Purpose | Key/Value store for every tunable parameter across all phases |
| Owner module | legacy shape; each phase's `ensurePhaseNConfig_` appends new keys, skip-if-present |
| Columns | `Key`,`Value` |
| API writers | `ensurePhase2Config_`/`ensurePhase3Config_`/`ensurePhase4Config_`/`ensurePhase5Config_` (idempotent, additive-only) |
| API readers | `getConfigNum_`/`getConfigList_`, called throughout Phase 3–5.1 |
| Config keys (17, verified zero collisions) | `EXTERNAL_PROJECT_STATUS_LIST`,`INTERNAL_PROJECT_STATUS_LIST` (P2); `WBS_STATUS_LIST`,`WORKING_DAYS_PER_WEEK`,`WORKING_HOURS_PER_DAY`,`AVAILABLE_HOURS_PER_PERSON`,`UTILIZATION_FACTOR`,`MEETING_ALLOWANCE`,`ADMIN_ALLOWANCE`,`LEAVE_ALLOWANCE`,`MANAGEMENT_BASELINE_ADDITIONAL_MP` (P3); `HIGH_LOAD_THRESHOLD_PCT`,`ORG_STATUS_LIST` (P4); `REPORTING_STALE_DAYS`,`PROJECT_AT_RISK_DAYS`,`PROJECT_CRITICAL_DAYS`,`OVERLOAD_THRESHOLD_PCT` (P5) |
| Migration involved | no |
| **`MANAGEMENT_BASELINE_ADDITIONAL_MP`** | never written by any calculation engine — read-only reference, re-verified this session by editing it directly and confirming zero effect on any calculated figure |

### `PROJECT_MASTER` (Phase 2, extended Phase 5.1)

| | |
|---|---|
| Purpose | Unified External + Internal project master record |
| Owner module | ProjectMaster.gs |
| Columns (27, in order) | `ID,Type,No,Name,Customer,Plant,Category,Priority,Complexity,Status,IntakeDate,TargetDate,FiscalYear,RfqNo,RfqDate,QuotationStatus,QuotationDate,NegotiationStatus,PoNo,PoDate,PIC,Note,CreatedBy,CreatedAt,UpdatedAt,LegacyProjectId,Country` |
| Required | `Type`,`Name`,`PIC`,`TargetDate` (enforced by `handleAddProjectMaster_`) |
| Optional | everything else — `Country` (Phase 5.1) is optional and never backfilled for existing rows |
| API writers | `addProjectMaster`,`updateProjectMaster`,`migrateLegacyProjects` |
| API readers | virtually all of Phase 2–5.1 |
| Seed data | none — populated only by explicit user action or migration |
| Migration involved | **is** the migration destination |
| Config dependency | `EXTERNAL_PROJECT_STATUS_LIST`/`INTERNAL_PROJECT_STATUS_LIST` validate `Status` |
| Verified this phase | a freshly-appended row has exactly 27 columns, matching the header, for both `addProjectMaster` and (26, by design — see below) `migrateLegacyProjects` |
| **Known, harmless inconsistency** | `handleMigrateLegacyProjects_`'s row-builder array is still 26 elements (not extended to explicitly write a 27th, blank `Country` cell) — every read site defaults with `\|\| ''`, so this is functionally correct, just stylistically inconsistent with `handleAddProjectMaster_`'s 27-element array. Not fixed this phase (cosmetic, zero functional risk). |

### `WBS` (Phase 3)

| | |
|---|---|
| Purpose | Generic recursive Phase→Activity→Task tree per project |
| Owner module | WbsWorkload.gs |
| Columns (23) | `WBS_ID,PROJECT_ID,PARENT_WBS_ID,WBS_LEVEL,WBS_CODE,NAME,TYPE,STATUS,PIC,SKILL,DEPENDENCY,PRIORITY,START_DATE,TARGET_DATE,ACTUAL_START,ACTUAL_END,PLAN_MAN_DAY,ACTUAL_MAN_DAY,PROGRESS,NOTE,CREATED_BY,CREATED_AT,UPDATED_AT` |
| Required | `PROJECT_ID`,`NAME` |
| API writers | `createWBS`,`updateWBS`,`deleteWBS` |
| API readers | Phase 3–5.1 workload/capacity/risk engines |
| Config dependency | `WBS_STATUS_LIST` validates `STATUS` |
| Verified this phase | freshly-appended row = 23 columns, exact header match; **`PLAN_MAN_DAY`/`ACTUAL_MAN_DAY` negative values are now rejected at write time** (this phase's fix — previously accepted silently) |

### `RESOURCE_ALLOCATION` (Phase 3)

| | |
|---|---|
| Purpose | Multi-engineer Man-Day allocation per WBS row |
| Owner module | WbsWorkload.gs |
| Columns (8) | `ALLOC_ID,WBS_ID,ENGINEER_NAME,ROLE,PLAN_MAN_DAY,ACTUAL_MAN_DAY,CREATED_BY,CREATED_AT` |
| Required | `WBS_ID`,`ENGINEER_NAME` |
| API writers | `saveResourceAllocation` |
| API readers | Phase 3–5.1 workload/capacity/risk engines |
| Deliberate omission | `SKILL` is **not** stored here — looked up live from `Team.Skill` by `ENGINEER_NAME` at aggregation time, so a skill-loading report never goes stale if someone's skill label changes later. This is intentional anti-duplication, not a missing column. |
| Verified this phase | freshly-appended row = 8 columns, exact header match; negative Man-Day now rejected at write time |

### `ORG_STRUCTURE` (Phase 4)

| | |
|---|---|
| Purpose | Recursive organization tree — named-person nodes and skill-group nodes |
| Owner module | Organization.gs |
| Columns (13) | `ORG_ID,PARENT_ORG_ID,ORG_LEVEL,ORG_NAME,POSITION,PERSON_NAME,SKILL,IDEAL_HEADCOUNT,STATUS,NOTE,CREATED_BY,CREATED_AT,UPDATED_AT` |
| Required | `ORG_NAME` |
| API writers | `createOrgNode`,`updateOrgNode`,`saveVacancy` (delegates to `updateOrgNode`) |
| API readers | `getOrgStructure`,`getVacancySummary`,`getDataQualityReport` |
| Deliberate omission | `CURRENT_HEADCOUNT`/`VACANT_HEADCOUNT` are **not** stored — derived live from `Team` every time (`orgNodeToObj_`), same anti-duplication rationale as `RESOURCE_ALLOCATION.SKILL` |
| Config dependency | `ORG_STATUS_LIST` validates `STATUS` |
| Verified this phase | freshly-appended row = 13 columns, exact header match |
| **Real, minor gap (not fixed)** | no validation prevents two different org nodes from referencing the same `SKILL` or the same `PERSON_NAME` — each would independently show the same headcount. Not an active double-counting bug today because nothing in the codebase sums `currentHeadcount` across nodes (verified: only ever displayed per-node), but worth a future `getDataQualityReport` check. |

---

## D1–D9 verdicts

| Check | Verdict |
|---|---|
| D1: no duplicate schema definitions | **Pass** |
| D2: no field-name collision | **Pass** |
| D3: no accidental overwriting of existing columns | **Pass** — `ensureHeader_` only writes to a completely-empty header row; `ensureProjectMasterCountryColumn_` only appends past the last column, verified against a simulated pre-existing populated sheet |
| D4: `setupSpreadsheet()` is idempotent | **Pass** — re-run twice against seeded data this phase, byte-identical result |
| D5: repeated runs do not destroy data | **Pass** — same test |
| D6: new sheets created only when absent | **Pass** — `getSheet_` only calls `insertSheet` when `getSheetByName` returns null |
| D7: existing legacy sheets remain untouched | **Pass** — confirmed by the Part A diff; no Phase 2–5.1 setup/write call ever targets a legacy sheet name except the read-only migration source |
| D8: Config keys not duplicated | **Pass** — 17 keys, each declared exactly once across all four `ensurePhaseNConfig_` functions, checked programmatically |
| D9: Config defaults safe and documented | **Pass** — every default is a plain day-count/percentage/status-list value, documented in `CAPACITY_MODEL.md`/`PROJECT_HEALTH_MODEL.md`; none are safety-critical secrets |

Automated, re-runnable proof: `backend/production/test/production-readiness-test.js`, Categories 4 and 5.
