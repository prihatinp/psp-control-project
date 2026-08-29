> **SUPERSEDED — historical record only, added by the Phase 5.2 audit.**
> This document describes the schema imagined for `backend/gas/*` (the
> Phase 1 scaffold), written before the real legacy `Code.gs` was
> available. It was never built this way and does not describe
> `backend/production/*`, which has shipped a completely different,
> real schema since Phase 2 (`PROJECT_MASTER`, `WBS`,
> `RESOURCE_ALLOCATION`, `ORG_STRUCTURE` — none of the tables below:
> `RESOURCE`, `ASSIGNMENT`, `POSITION`, `MP_BASELINE`, `ANNUAL_LOADING`,
> `SCENARIO` were ever implemented). **For the real, current schema see
> `backend/production/SCHEMA.md`.** Kept here only so `backend/gas/*`'s
> own history remains traceable, per `backend/README.md`'s folder table.

# Rev D Sheet Schema (Phase 1 Foundation) — describes backend/gas/* ONLY

Created additively by `setupSchema()` in `backend/gas/SchemaSetup.gs`.
None of these replace or touch the existing sheets (`Team`, `Stages`,
`Phases`, `Projects`, `DailyLogs`, `SupportJobs`, `GlobalSupport`, or
whatever their real names turn out to be after Phase 1A recovery).

| Sheet | Primary Key | Key Fields | Relationships | Required | Configurable |
|---|---|---|---|---|---|
| `PROJECT_MASTER` | `project_id` | type (External/Internal), name, customer_or_requestor, intake_date, target_date, priority, status, fiscal_year | 1→N `WBS` (parent_type='PROJECT_MASTER') | project_id, type, name, intake_date | priority levels, lifecycle stages |
| `WBS` | `wbs_id` | parent_type, parent_id, activity, plan_date, do_date, mp, need_day, man_day, depends_on, status | N→1 `PROJECT_MASTER`/`IRREGULAR_JOB`; 1→N `ASSIGNMENT`; self-ref via depends_on | wbs_id, parent_type, parent_id, activity | activity templates (18-stage / 8-step) |
| `IRREGULAR_JOB` | `job_id` | category, requestor, area, problem, priority, status, estimated_mp, estimated_need_day | 1→N `WBS` (parent_type='IRREGULAR_JOB') | job_id, category, requestor | category list lives in `CONFIG.IRREGULAR_JOB_CATEGORIES` |
| `RESOURCE` | `resource_id` | name, skill, level, status, weekly_capacity_days | 1→N `ASSIGNMENT`; 1→N `POSITION_ASSIGNMENT` | resource_id, name | skill taxonomy, level bands |
| `ASSIGNMENT` | `assignment_id` | wbs_id, resource_id, role, allocated_man_day | N→1 `WBS`; N→1 `RESOURCE` — enables Multi-PIC (many rows, one wbs_id) | assignment_id, wbs_id, resource_id | — |
| `ORG_NODE` | `node_id` | parent_node_id, name, type, display_order | self-referential tree | node_id, name | branch names/types — never hard-coded |
| `POSITION` | `position_id` | org_node_id, title, required_skill, ideal_hc | N→1 `ORG_NODE`; 1→N `POSITION_ASSIGNMENT` | position_id, org_node_id, title, ideal_hc | ideal_hc (management-editable) |
| `POSITION_ASSIGNMENT` | `pos_assign_id` | position_id, resource_id, start_date, end_date | N→1 `POSITION`; N→1 `RESOURCE` | pos_assign_id, position_id, resource_id | — |
| `MP_BASELINE` | `fiscal_year` | current_mp, management_add_mp, ot_current_ref, ot_target_ref, approved_by, approved_at | referenced by `ANNUAL_LOADING` (by year) | fiscal_year, management_add_mp, approved_by | OT reference values |
| `ANNUAL_LOADING` | `year` | project_volume, mp_actual, ratio_mp_per_project, ot_hours, ot_per_month_per_mp | N→1 `MP_BASELINE` (by fiscal_year) | year, project_volume, mp_actual | — |
| `SCENARIO` | `scenario_id` | name, parent_type, parent_id, assumption, projected_mp_impact, status | N→1 `PROJECT_MASTER`/`IRREGULAR_JOB` (draft link) | scenario_id, name | kept minimal by design (PRD §12) |
| `WEEKLY_UPDATE` | `update_id` | parent_type, parent_id, wbs_id, date, engineer, plan, actual, problem, next_action | N→1 `WBS`/project | update_id, date, plan, actual | — |
| `REPORT_HISTORY` | `report_id` | type, period, generated_at, generated_by, version | — | report_id, type, generated_at | — |
| `AUDIT_LOG` | `audit_id` | timestamp, actor, action, entity_type, entity_id, details | references any entity by type+id | audit_id, timestamp, actor, action | — |
| `CONFIG` | `config_key` | value, note | referenced by nearly every service | config_key, value | everything in this sheet, by definition |

Validation currently enforced in code (Phase 1 foundation level; deeper
rules — e.g. schedule/dependency-cycle checks — are later-phase work):

- `IRREGULAR_JOB.category` must be one of `CONFIG.IRREGULAR_JOB_CATEGORIES`.
- `PROJECT_MASTER.type` must be `External` or `Internal` (Irregular Job uses `IRREGULAR_JOB`, not `PROJECT_MASTER`).
- `MP_BASELINE` writes are rejected unless the caller's role is recognized as management (`isManagementRole_` in `Auth.gs` — currently a placeholder heuristic, see Known Risks in the phase report).
- `POSITION.current_hc` and `.gap`/`.display` (Vacant/Filled) are always derived at read time from `POSITION_ASSIGNMENT`, never stored, so they can't drift.
