# Phase 2 — PROJECT_MASTER Schema & Migration

## Sheet: `PROJECT_MASTER`

New sheet, created additively by `setupProjectMasterSheet_()` (called from
`setupSpreadsheet()`). Does not touch the legacy `Projects` sheet.

| Column | Type | Notes |
|---|---|---|
| `ID` | string | `pm_xxxxxxxx`, via the real `newId_('pm')` — same convention as legacy `p_`/`l_`/`s_`/`g_` IDs |
| `Type` | string | `EXTERNAL` or `INTERNAL` — enforced by `validateProjectType_` |
| `No` | string | Project number, optional |
| `Name` | string | Required |
| `Customer` | string | External only |
| `Plant` | string | External only |
| `Category` | string | Free text (Internal: Automation/Reduce MP/Capacity Up/etc.) |
| `Priority` | string | Free text, default `Medium` |
| `Complexity` | string | Free text, optional |
| `Status` | string | Validated against `Config!EXTERNAL_PROJECT_STATUS_LIST` or `Config!INTERNAL_PROJECT_STATUS_LIST` depending on `Type` |
| `IntakeDate` | date string | Defaults to today if not supplied |
| `TargetDate` | date string | Required |
| `FiscalYear` | number | Derived from `IntakeDate`'s year |
| `RfqNo` / `RfqDate` | string / date | External only |
| `QuotationStatus` / `QuotationDate` | string / date | External only |
| `NegotiationStatus` | string | External only |
| `PoNo` / `PoDate` | string / date | External only |
| `PIC` | string | Required |
| `Note` | string | Optional |
| `CreatedBy` | string | Token's user name (`auth.n`) |
| `CreatedAt` / `UpdatedAt` | ISO datetime | Stamped by the server |
| `LegacyProjectId` | string | **Not a requested field** — added solely so `migrateLegacyProjects` can detect already-migrated rows and stay idempotent. Never shown to the frontend (`projectMasterRowToObj_` omits it from the API response). |

## Status model

Stored in the real `Config` sheet (same `Key`/`Value` shape it already has — no second Config sheet, no schema change to it):

- `EXTERNAL_PROJECT_STATUS_LIST` = `PIPELINE,RFQ,STUDY,QUOTATION,NEGOTIATION,PO,EXECUTION,ON HOLD,COMPLETED,CANCELLED`
- `INTERNAL_PROJECT_STATUS_LIST` = `PIPELINE,EXECUTION,ON HOLD,COMPLETED,CANCELLED`

`ensurePhase2Config_()` only appends these two keys if they're not already present — it never touches `LOGIN_PIN` or `SUPPORT_CAPACITY_MANDAY_PER_WEEK` or any admin edit made to the new keys after first run.

Status is deliberately separate from the legacy `Projects.ProgressStage` (0–18 stage counter) — they answer different questions (commercial/lifecycle status vs. engineering stage progress) and are not meant to be merged.

## Migration: legacy `Projects` → `PROJECT_MASTER`

Triggered by the `migrateLegacyProjects` action. Read-only against `Projects` (verified by test: legacy sheet is byte-identical before/after). Idempotent: a second run skips every row whose `ID` already appears as some `PROJECT_MASTER` row's `LegacyProjectId`.

| Legacy field | → PROJECT_MASTER field | How |
|---|---|---|
| `Projects.ID` | `LegacyProjectId` | Direct copy — the migration key, not user-facing |
| `Projects.No` | `No` | Direct copy |
| `Projects.Name` | `Name` | Direct copy |
| `Projects.PIC` | `PIC` | Direct copy |
| `Projects.Category` | `Category` | Direct copy |
| `Projects.Start` | `IntakeDate` | **Approximation** — legacy has no "intake" concept; `Start` is the closest analog |
| `Projects.Target` | `TargetDate` | Direct copy |
| `Projects.Note` | `Note` | Direct copy |
| `Projects.CreatedAt` | `CreatedAt` | Direct copy |
| *(fixed)* | `Type` | Always `'INTERNAL'` — every legacy seed project is Indonesia-factory automation work, confirmed in the Phase 1.5 audit |
| *(derived)* | `Status` | `'COMPLETED'` if `ProgressStage >= 18`, else `'EXECUTION'` — legacy has no status field; this is a documented default, not a real legacy value |
| *(derived)* | `FiscalYear` | Year of `IntakeDate` |

**Left unmapped, not invented:** `Customer`, `Plant`, `Priority`, `Complexity`, every RFQ/Quotation/Negotiation/PO field, `CreatedBy` — none of these exist on a legacy Internal project record, so they are written as empty strings rather than guessed.
