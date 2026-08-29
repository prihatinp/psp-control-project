/**
 * ============================================================
 *  PROJECT MASTER — PHASE 2 ADDITIVE EXTENSION
 *  ------------------------------------------------------------
 *  This file lives alongside the real production Code.gs in the
 *  same Apps Script project (all .gs files share one global
 *  scope) and reuses its security/locking/sanitization/ID
 *  functions verbatim: getSecret_/verifyToken_/checkRateLimit_/
 *  sanitizeStr_/sanitizeObjStrings_/LockService/getSheet_/
 *  ensureHeader_/rowsToObjects_/findRowIndexById_/newId_/
 *  todayStr_/fmtDateCell_. Nothing in this file redefines or
 *  modifies any of those — it only calls them.
 *
 *  Scope (Phase 2 only): PROJECT_MASTER (External + Internal
 *  project master data) and a one-way, idempotent migration
 *  from the legacy Projects sheet. WBS, capacity, manpower,
 *  organization, weekly reporting, and export are explicitly
 *  NOT part of this file — later phases.
 * ============================================================
 */

/**
 * Column order for PROJECT_MASTER. LegacyProjectId is the one
 * field beyond what was requested — it exists solely so
 * migrateLegacyProjects (below) can detect "already migrated"
 * rows and stay idempotent. It is not shown to users.
 */
var PROJECT_MASTER_HEADERS = [
  'ID', 'Type', 'No', 'Name', 'Customer', 'Plant', 'Category', 'Priority', 'Complexity',
  'Status', 'IntakeDate', 'TargetDate', 'FiscalYear',
  'RfqNo', 'RfqDate', 'QuotationStatus', 'QuotationDate', 'NegotiationStatus', 'PoNo', 'PoDate',
  'PIC', 'Note', 'CreatedBy', 'CreatedAt', 'UpdatedAt',
  'LegacyProjectId',
  'Country' // Phase 5.1 addition — see below. Appended last (same reasoning as
            // LegacyProjectId) so every existing index-based access stays valid.
];

function setupProjectMasterSheet_() {
  var sh = getSheet_(SHEET_NAMES.PROJECT_MASTER);
  ensureHeader_(sh, PROJECT_MASTER_HEADERS);
  ensureProjectMasterCountryColumn_();
}

/**
 * Phase 5.1 — Customer / Country / Plant data model fix.
 *
 * Audit finding: PROJECT_MASTER already had separate Customer and Plant
 * columns, but no Country column at all, and the External "Add New" form
 * only ever collected one free-text field ("Customer / Plant", e.g.
 * "Musashi Vietnam") into `Customer`. Reporting.gs's groupedBy.country then
 * grouped by that same Customer value, so "country" in every report was
 * really "customer" (or a customer+plant string) in disguise — exactly the
 * concept-mixing this phase was asked to find and fix.
 *
 * Fix (additive, no data invented): add a genuine Country column. On an
 * already-provisioned real sheet, ensureHeader_() above is a no-op (it only
 * writes headers to a completely empty row 1), so this function appends
 * the column explicitly if it is missing — existing rows simply get a
 * blank Country cell, never a guessed value. Existing Customer/Plant data
 * is untouched.
 */
function ensureProjectMasterCountryColumn_() {
  var sh = getSheet_(SHEET_NAMES.PROJECT_MASTER);
  var lastCol = sh.getLastColumn();
  var headerRow = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (headerRow.indexOf('Country') === -1) {
    sh.getRange(1, lastCol + 1).setValue('Country');
  }
}

/**
 * Adds Phase 2's two new Config keys (status lists) to the REAL
 * existing Config sheet — same Key/Value shape it already has,
 * no new sheet, no restructuring. Skips any key already present
 * so re-running never overwrites an admin's edited values.
 */
function ensurePhase2Config_() {
  var sh = getSheet_(SHEET_NAMES.CONFIG);
  var existingKeys = {};
  rowsToObjects_(sh).forEach(function (r) { existingKeys[r.Key] = true; });
  var defaults = [
    ['EXTERNAL_PROJECT_STATUS_LIST', 'PIPELINE,RFQ,STUDY,QUOTATION,NEGOTIATION,PO,EXECUTION,ON HOLD,COMPLETED,CANCELLED'],
    ['INTERNAL_PROJECT_STATUS_LIST', 'PIPELINE,EXECUTION,ON HOLD,COMPLETED,CANCELLED']
  ];
  defaults.forEach(function (row) {
    if (!existingKeys[row[0]]) sh.appendRow(row);
  });
}

function getConfigList_(key, fallback) {
  var row = rowsToObjects_(getSheet_(SHEET_NAMES.CONFIG)).filter(function (r) { return r.Key === key; })[0];
  if (!row || !row.Value) return fallback || [];
  return String(row.Value).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function validateProjectType_(type) {
  return type === 'EXTERNAL' || type === 'INTERNAL';
}

function validateProjectStatus_(type, status) {
  var key = type === 'EXTERNAL' ? 'EXTERNAL_PROJECT_STATUS_LIST' : 'INTERNAL_PROJECT_STATUS_LIST';
  var allowed = getConfigList_(key, ['PIPELINE']);
  return allowed.indexOf(status) !== -1;
}

function projectMasterRowToObj_(p) {
  return {
    id: p.ID, type: p.Type, no: p.No, name: p.Name, customer: p.Customer, plant: p.Plant,
    country: p.Country || '', // Phase 5.1 — real, separate field; '' means not yet entered, never guessed
    category: p.Category, priority: p.Priority, complexity: p.Complexity, status: p.Status,
    intakeDate: fmtDateCell_(p.IntakeDate), targetDate: fmtDateCell_(p.TargetDate), fiscalYear: p.FiscalYear,
    rfqNo: p.RfqNo, rfqDate: fmtDateCell_(p.RfqDate), quotationStatus: p.QuotationStatus,
    quotationDate: fmtDateCell_(p.QuotationDate), negotiationStatus: p.NegotiationStatus,
    poNo: p.PoNo, poDate: fmtDateCell_(p.PoDate),
    pic: p.PIC, note: p.Note, createdBy: p.CreatedBy, createdAt: p.CreatedAt, updatedAt: p.UpdatedAt
    // legacyProjectId intentionally not exposed to the frontend — internal migration key only
  };
}

/* ============================================================
 *  ADD
 * ============================================================ */
function handleAddProjectMaster_(body, auth) {
  if (!validateProjectType_(body.type)) {
    return { ok: false, message: 'project_type harus EXTERNAL atau INTERNAL.' };
  }
  if (!body.name || !body.pic || !body.targetDate) {
    return { ok: false, message: 'Nama project, PIC, dan Target Date wajib diisi.' };
  }
  var status = body.status || 'PIPELINE';
  if (!validateProjectStatus_(body.type, status)) {
    return { ok: false, message: 'Status tidak dikenal untuk tipe project ini.' };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensurePhase2Config_();
    setupProjectMasterSheet_();
    var sh = getSheet_(SHEET_NAMES.PROJECT_MASTER);
    var id = newId_('pm');
    var clean = sanitizeObjStrings_(body, [
      'no', 'name', 'customer', 'plant', 'country', 'category', 'priority', 'complexity',
      'rfqNo', 'quotationStatus', 'negotiationStatus', 'poNo', 'pic', 'note'
    ]);
    var intakeDate = body.intakeDate || todayStr_();
    var fiscalYear = Number(String(intakeDate).slice(0, 4)) || new Date().getFullYear();
    var nowIso = new Date().toISOString();
    var row = [
      id, body.type, clean.no || '', clean.name, clean.customer || '', clean.plant || '',
      clean.category || '', clean.priority || 'Medium', clean.complexity || '',
      status, intakeDate, body.targetDate, fiscalYear,
      clean.rfqNo || '', body.rfqDate || '', clean.quotationStatus || '', body.quotationDate || '',
      clean.negotiationStatus || '', clean.poNo || '', body.poDate || '',
      clean.pic, clean.note || '', auth.n, nowIso, nowIso,
      '', // LegacyProjectId — blank for genuinely new projects; only set by migration
      clean.country || '' // Phase 5.1 — separate, optional, never inferred from customer/plant
    ];
    sh.appendRow(row);
    var obj = {};
    PROJECT_MASTER_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
    return { ok: true, project: projectMasterRowToObj_(obj) };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 *  UPDATE
 * ============================================================ */
function handleUpdateProjectMaster_(body, auth) {
  if (!body.id) return { ok: false, message: 'ID project wajib diisi.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_(SHEET_NAMES.PROJECT_MASTER);
    var rowIdx = findRowIndexById_(sh, 'ID', body.id);
    if (rowIdx === -1) return { ok: false, message: 'Project tidak ditemukan.' };
    var rowVals = sh.getRange(rowIdx, 1, 1, PROJECT_MASTER_HEADERS.length).getValues()[0];
    var obj = {};
    PROJECT_MASTER_HEADERS.forEach(function (h, i) { obj[h] = rowVals[i]; });

    if (body.status !== undefined && !validateProjectStatus_(obj.Type, body.status)) {
      return { ok: false, message: 'Status tidak dikenal untuk tipe project ini.' };
    }

    var clean = sanitizeObjStrings_(body, [
      'no', 'name', 'customer', 'plant', 'country', 'category', 'priority', 'complexity',
      'rfqNo', 'quotationStatus', 'negotiationStatus', 'poNo', 'pic', 'note'
    ]);
    var fieldMap = {
      no: 'No', name: 'Name', customer: 'Customer', plant: 'Plant', country: 'Country', category: 'Category',
      priority: 'Priority', complexity: 'Complexity', status: 'Status', targetDate: 'TargetDate',
      rfqNo: 'RfqNo', rfqDate: 'RfqDate', quotationStatus: 'QuotationStatus', quotationDate: 'QuotationDate',
      negotiationStatus: 'NegotiationStatus', poNo: 'PoNo', poDate: 'PoDate', pic: 'PIC', note: 'Note'
    };
    var patch = {};
    Object.keys(fieldMap).forEach(function (f) {
      if (body[f] === undefined) return;
      patch[fieldMap[f]] = clean[f] !== undefined ? clean[f] : body[f];
    });
    patch.UpdatedAt = new Date().toISOString();

    PROJECT_MASTER_HEADERS.forEach(function (h, i) {
      if (Object.prototype.hasOwnProperty.call(patch, h)) sh.getRange(rowIdx, i + 1).setValue(patch[h]);
    });
    var merged = Object.assign({}, obj, patch);
    return { ok: true, project: projectMasterRowToObj_(merged) };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 *  READ
 * ============================================================ */
function handleGetProjectMaster_(body) {
  if (!body.id) return { ok: false, message: 'ID project wajib diisi.' };
  var row = rowsToObjects_(getSheet_(SHEET_NAMES.PROJECT_MASTER)).filter(function (r) { return r.ID === body.id; })[0];
  if (!row) return { ok: false, message: 'Project tidak ditemukan.' };
  return { ok: true, project: projectMasterRowToObj_(row) };
}

function handleProjectMasterList_(body) {
  var rows = rowsToObjects_(getSheet_(SHEET_NAMES.PROJECT_MASTER));
  if (body && body.type) rows = rows.filter(function (r) { return r.Type === body.type; });
  return { ok: true, projects: rows.map(projectMasterRowToObj_) };
}

function handleExternalProjectList_() {
  var rows = rowsToObjects_(getSheet_(SHEET_NAMES.PROJECT_MASTER)).filter(function (r) { return r.Type === 'EXTERNAL'; });
  return { ok: true, projects: rows.map(projectMasterRowToObj_) };
}

/* ============================================================
 *  MIGRATION (legacy Projects -> PROJECT_MASTER, additive, idempotent)
 *
 *  Legacy field -> PROJECT_MASTER field:
 *    Projects.ID        -> PROJECT_MASTER.LegacyProjectId  (migration key, not shown to users)
 *    Projects.No        -> PROJECT_MASTER.No
 *    Projects.Name      -> PROJECT_MASTER.Name
 *    Projects.PIC       -> PROJECT_MASTER.PIC
 *    Projects.Category  -> PROJECT_MASTER.Category
 *    Projects.Start     -> PROJECT_MASTER.IntakeDate   (approximation: legacy has no "intake"
 *                          concept; Start is the closest analogous date — flagged, not exact)
 *    Projects.Target    -> PROJECT_MASTER.TargetDate
 *    Projects.Note      -> PROJECT_MASTER.Note
 *    Projects.CreatedAt -> PROJECT_MASTER.CreatedAt
 *    (fixed)            -> PROJECT_MASTER.Type = 'INTERNAL'   (every seeded legacy project is
 *                          Indonesia-factory automation work, confirmed in the Phase 1.5 audit)
 *    (derived)          -> PROJECT_MASTER.Status = 'COMPLETED' if ProgressStage >= 18 else 'EXECUTION'
 *                          (legacy has no status field; this is the most defensible default,
 *                          not a real legacy value — documented here, not invented silently)
 *    (derived)          -> PROJECT_MASTER.FiscalYear = year of IntakeDate
 *
 *  Left UNMAPPED (do not exist on legacy Internal projects, not invented):
 *    Customer, Plant, Priority, Complexity, RfqNo, RfqDate, QuotationStatus, QuotationDate,
 *    NegotiationStatus, PoNo, PoDate, CreatedBy (legacy Projects has no "who created it" field)
 * ============================================================ */
function handleMigrateLegacyProjects_(body, auth) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensurePhase2Config_();
    setupProjectMasterSheet_();

    var alreadyMigrated = {};
    rowsToObjects_(getSheet_(SHEET_NAMES.PROJECT_MASTER)).forEach(function (r) {
      if (r.LegacyProjectId) alreadyMigrated[r.LegacyProjectId] = true;
    });

    var legacyProjects = rowsToObjects_(getSheet_(SHEET_NAMES.PROJECTS));
    var sh = getSheet_(SHEET_NAMES.PROJECT_MASTER);
    var migrated = 0, skipped = 0;
    var nowIso = new Date().toISOString();

    legacyProjects.forEach(function (p) {
      if (alreadyMigrated[p.ID]) { skipped++; return; }

      var status = (Number(p.ProgressStage) || 0) >= 18 ? 'COMPLETED' : 'EXECUTION';
      var intakeDate = p.Start ? fmtDateCell_(p.Start) : todayStr_();
      var fiscalYear = Number(String(intakeDate).slice(0, 4)) || new Date().getFullYear();

      var row = [
        newId_('pm'), 'INTERNAL', p.No || '', p.Name || '', '', '', p.Category || '', '', '',
        status, intakeDate, fmtDateCell_(p.Target) || '', fiscalYear,
        '', '', '', '', '', '', '',
        p.PIC || '', p.Note || '', '', p.CreatedAt || nowIso, nowIso,
        p.ID
      ];
      sh.appendRow(row);
      migrated++;
    });

    return { ok: true, migrated: migrated, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}
