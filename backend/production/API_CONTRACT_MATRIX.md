# API Contract Matrix — Phase 1 through Phase 5.1 (audited in Phase 5.2)

51 total actions: 49 `doPost` cases + `login` (special-cased before the
switch) + `teamNames` (the only `doGet` action). Every non-`login`,
non-`teamNames` action requires `verifyToken_` and is subject to
`checkRateLimit_` — both apply uniformly via the shared gate in `doPost`,
before the `switch` statement, so they are omitted per-row below except to
note the two exceptions.

Legend: **R** = read-only, **W** = write (wrapped in `LockService`),
**W\*** = write via delegation to another locked handler.

## Legacy (pre-existing, unchanged)

| Action | Method | Handler | File | Sheets R | Sheets W | Sanitized | Frontend caller | Tested |
|---|---|---|---|---|---|---|---|---|
| `login` | POST (no token) | `handleLogin_` | Code.gs | Team | — | n/a | login page | smoke-test.js, all suites (setup) |
| `teamNames` | **GET**, public | `publicTeamNames_` | Code.gs | Team | — | n/a | `initLoginOptions` | phase3-test.js #21c |
| `bootstrap` | POST | `getBootstrapData_` | Code.gs | Team,Stages,Phases,Projects,SupportJobs,GlobalSupport | — | n/a | `renderAll` | phase3/4/5/5.1-test.js regression checks |
| `addProject` | POST | `handleAddProject_` | Code.gs | Projects | Projects | Yes | `saveNewProject` | smoke-test.js |
| `saveDailyLog` | POST | `handleSaveDailyLog_` | Code.gs | Projects | DailyLogs,Projects | Yes | `saveDailyUpdate` | smoke-test.js |
| `markStage` | POST | `handleMarkStage_` | Code.gs | Projects | Projects | Yes | stage buttons | smoke-test.js |
| `undoStage` | POST | `handleUndoStage_` | Code.gs | Projects | Projects | Yes | stage buttons | smoke-test.js |
| `saveSupportJob` | POST | `handleSaveSupportJob_` | Code.gs | — | SupportJobs | Yes | `saveSupportJob` | smoke-test.js, phase5-test.js |
| `saveGlobalItem` | POST | `handleSaveGlobalItem_` | Code.gs | — | GlobalSupport | Yes | `saveGlobalItem` | smoke-test.js |

## Phase 2 — PROJECT_MASTER + External stream

| Action | Handler | File | Sheets R | Sheets W | Sanitized | Frontend caller | Tested |
|---|---|---|---|---|---|---|---|
| `addProjectMaster` | `handleAddProjectMaster_` | ProjectMaster.gs | Config | PROJECT_MASTER | Yes | `savePmProject` | phase2/5/5.1-test.js |
| `updateProjectMaster` | `handleUpdateProjectMaster_` | ProjectMaster.gs | PROJECT_MASTER | PROJECT_MASTER | Yes | **none** | phase2/5.1-test.js |
| `getProjectMaster` | `handleGetProjectMaster_` | ProjectMaster.gs | PROJECT_MASTER | — | n/a | **none** | phase2-test.js |
| `projectMasterList` | `handleProjectMasterList_` | ProjectMaster.gs | PROJECT_MASTER | — | n/a | `renderPmExternal/Internal` | all suites (setup checks) |
| `externalProjectList` | `handleExternalProjectList_` | ProjectMaster.gs | PROJECT_MASTER | — | n/a | **none** | phase2-test.js |
| `migrateLegacyProjects` | `handleMigrateLegacyProjects_` | ProjectMaster.gs | Projects (read-only) | PROJECT_MASTER | Yes (via ProjectMaster field cleaning) | **none** | phase2/5/5.1/production-readiness-test.js |

## Phase 3 — WBS + Man-Day + Workload + Capacity

| Action | Handler | File | Sheets R | Sheets W | Sanitized | Frontend caller | Tested |
|---|---|---|---|---|---|---|---|
| `createWBS` / `createActivity` | `handleCreateWbs_` | WbsWorkload.gs | Config | WBS | Yes | `saveRcWbs` | phase3/4/5.1/production-readiness-test.js |
| `updateWBS` / `updateActivity` | `handleUpdateWbs_` | WbsWorkload.gs | WBS | WBS | Yes | **none** | phase3-test.js |
| `deleteWBS` | `handleDeleteWbs_` | WbsWorkload.gs | WBS | WBS | n/a | **none** | phase3-test.js |
| `getWBS` | `handleGetWbs_` | WbsWorkload.gs | WBS | — | n/a | **none** | phase3-test.js |
| `getActivities` / `listWbsForProject` | `handleListWbsForProject_` | WbsWorkload.gs | WBS | — | n/a | `renderRcWbsPage` | phase3-test.js |
| `saveResourceAllocation` | `handleSaveResourceAllocation_` | WbsWorkload.gs | WBS | RESOURCE_ALLOCATION | Yes | `saveRcAllocation` | phase3/4/5.1/production-readiness-test.js |
| `getResourceAllocation` | `handleGetResourceAllocation_` | WbsWorkload.gs | RESOURCE_ALLOCATION | — | n/a | **none** | phase3-test.js |
| `getWorkloadSummary` | `handleGetWorkloadSummary_` | WbsWorkload.gs | WBS,RESOURCE_ALLOCATION,SupportJobs,PROJECT_MASTER,Team,Config | — | n/a | `renderRcWorkload` | phase3/4/5.1-test.js |
| `getCapacitySummary` | `handleGetCapacitySummary_` | WbsWorkload.gs | Team,Config | — | n/a | `renderRcCapacity` | phase3/5.1-test.js |
| `getEngineerLoading` / `getEngineerCapacity` / `getManpowerByEngineer` | `handleGetEngineerLoading_` | WbsWorkload.gs | WBS,RESOURCE_ALLOCATION,Team,Config | — | n/a | `renderMpDashboard` | phase3/4/5-test.js |
| `getSkillLoading` | `handleGetSkillLoading_` | WbsWorkload.gs | WBS,RESOURCE_ALLOCATION,Team | — | n/a | **none** | phase3-test.js |
| `getManpowerAnalysis` / `getManpowerGap` | `handleGetManpowerAnalysis_` | WbsWorkload.gs | Team,WBS,RESOURCE_ALLOCATION,Config | — | n/a | `renderRcManpower` | phase3/4/5/5.1-test.js |

## Phase 3.1 — Data Quality (extended in Phase 4)

| Action | Handler | File | Sheets R | Sheets W | Frontend caller | Tested |
|---|---|---|---|---|---|---|
| `getDataQualityReport` | `handleGetDataQualityReport_` | WbsWorkload.gs | PROJECT_MASTER,WBS,RESOURCE_ALLOCATION,ORG_STRUCTURE,Team,Config | — | `renderMpDashboard` | phase3.1/4/5.1-test.js |

## Phase 4 — Workload Calendar + Organization + Manpower Engine

| Action | Handler | File | Sheets R | Sheets W | Sanitized | Frontend caller | Tested |
|---|---|---|---|---|---|---|---|
| `getWorkloadCalendar` | `handleGetWorkloadCalendar_` | WbsWorkload.gs | WBS,RESOURCE_ALLOCATION,SupportJobs,Team,Config | — | n/a | `renderMpCalendar` | phase4-test.js |
| `getWeeklyWorkload` / `getMonthlyWorkload` | thin period-fixed wrappers around `handleGetWorkloadCalendar_` | WbsWorkload.gs | same | — | n/a | **none** | phase4-test.js |
| `getSkillCapacity` / `getManpowerBySkill` | `handleGetManpowerBySkill_` | WbsWorkload.gs | WBS,RESOURCE_ALLOCATION,Team | — | n/a | `renderMpDashboard` | phase4/5.1-test.js |
| `createOrgNode` | `handleCreateOrgNode_` | Organization.gs | Config | ORG_STRUCTURE | Yes | `saveMpOrgNode` | phase4/5.1/production-readiness-test.js |
| `updateOrgNode` | `handleUpdateOrgNode_` | Organization.gs | ORG_STRUCTURE | ORG_STRUCTURE | Yes | **none** (also called internally by `saveVacancy`) | phase4-test.js |
| `getOrgStructure` | `handleGetOrgStructure_` | Organization.gs | ORG_STRUCTURE,Team | — | n/a | `renderMpOrg` | phase4/5.1-test.js |
| `getVacancySummary` | `handleGetVacancySummary_` | Organization.gs | ORG_STRUCTURE,Team | — | n/a | `renderMpDashboard`,`renderMpVacancy` | phase4-test.js |
| `saveVacancy` | `handleSaveVacancy_` → delegates to `handleUpdateOrgNode_` | Organization.gs | ORG_STRUCTURE | ORG_STRUCTURE (W\*) | Yes (inherited) | **none** | phase4-test.js |
| `getManpowerScenario` | `handleGetManpowerScenario_` | WbsWorkload.gs | Team,WBS,RESOURCE_ALLOCATION,SupportJobs,Config | — | n/a | `renderMpScenario` | phase4/5.1/production-readiness-test.js |

## Phase 5 — Executive Dashboard + Weekly Reports (all read-only)

| Action | Handler | File | Sheets R | Frontend caller | Tested |
|---|---|---|---|---|---|
| `getExecutiveDashboard` | `handleGetExecutiveDashboard_` | Reporting.gs | PROJECT_MASTER,WBS,RESOURCE_ALLOCATION,DailyLogs,Team,Config,SupportJobs,GlobalSupport | `renderExDashboard` | phase5/5.1-test.js |
| `getProjectRisks` | `handleGetProjectRisks_` | Reporting.gs | same context | **none directly** (used inside attention/dashboard construction) | phase5/5.1/production-readiness-test.js |
| `getProjectsNeedAttention` | `handleGetProjectsNeedAttention_` | Reporting.gs | same context | `renderExAttention` | phase5/5.1-test.js |
| `getExternalWeeklyReport` | `handleGetExternalWeeklyReport_` | Reporting.gs | PROJECT_MASTER,WBS,RESOURCE_ALLOCATION,DailyLogs | `renderExExternal` | phase5/5.1-test.js |
| `getInternalWeeklyReport` | `handleGetInternalWeeklyReport_` | Reporting.gs | + SupportJobs | `renderExInternal` | phase5/5.1-test.js |
| `getReportingPreview` | `handleGetReportingPreview_` | Reporting.gs | (composes the five above) | `renderExPreview` | phase5-test.js |

## Verification performed this phase (Phase 5.2), source-level and re-executed, not re-read from memory

- Zero duplicate action names (49 unique `case` labels).
- Zero orphan handlers (every `handle*_` function defined is routed;
  `handleLogin_` routes via the pre-switch branch, everything else via a
  `case`).
- Zero handler referenced but undefined.
- Every `apiPost`/`apiGet` call in `js/app.js` resolves to a real backend
  action (31 distinct calls checked against the 49+1 backend actions).
- Zero cross-file function/constant name collisions across
  `Code.gs`/`ProjectMaster.gs`/`WbsWorkload.gs`/`Organization.gs`/`Reporting.gs`.

Automated, re-runnable proof of all of the above:
`backend/production/test/production-readiness-test.js`, Categories 1, 8, 9.
