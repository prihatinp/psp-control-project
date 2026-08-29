/**
 * ============================================================
 *  ORGANIZATION STRUCTURE — PHASE 4 ADDITIVE EXTENSION
 *  ------------------------------------------------------------
 *  New sheet, additive only. Reuses the real verifyToken_/
 *  checkRateLimit_/sanitizeObjStrings_/LockService/newId_ verbatim,
 *  same as every other Phase 2-4 file.
 *
 *  DESIGN NOTE — deviating from the suggested column list, explained:
 *  The brief's suggested schema (Part D) lists CURRENT_HEADCOUNT,
 *  VACANT_HEADCOUNT, and TEAM_ROLE as stored columns. This file does
 *  NOT store them, because Part D also explicitly says "Do not
 *  duplicate Team data unnecessarily. The Team sheet remains the
 *  authoritative source for current people." Storing those three
 *  values would either (a) duplicate what Team already says (drift
 *  risk — a person leaves Team, the org node silently disagrees) or
 *  (b) sit permanently blank if we don't bother computing them
 *  in-line. Instead: CURRENT_HEADCOUNT, VACANT_HEADCOUNT, and
 *  TEAM_ROLE are computed live, on every read, by orgNodeToObj_
 *  below, from Team — never stored, never able to go stale. Only
 *  IDEAL_HEADCOUNT is a real stored column, since it's the one
 *  genuine management input this table exists to hold (nothing in
 *  Team could tell you what headcount a branch *should* have).
 * ============================================================ */

var ORG_STRUCTURE_HEADERS = [
  'ORG_ID', 'PARENT_ORG_ID', 'ORG_LEVEL', 'ORG_NAME', 'POSITION', 'PERSON_NAME', 'SKILL',
  'IDEAL_HEADCOUNT', 'STATUS', 'NOTE', 'CREATED_BY', 'CREATED_AT', 'UPDATED_AT'
];
// CREATED_BY added beyond the suggested list — every other Phase 2-4 entity
// records who created it (consistent convention), and it costs nothing.

function setupOrgStructureSheet_() {
  ensureHeader_(getSheet_(SHEET_NAMES.ORG_STRUCTURE), ORG_STRUCTURE_HEADERS);
}

function validateOrgStatus_(status) {
  var allowed = getConfigList_('ORG_STATUS_LIST', ['ACTIVE']);
  return allowed.indexOf(status) !== -1;
}

/** Derives current/vacant headcount and team role live from Team — never stored. */
function orgNodeToObj_(o) {
  var teamRows = rowsToObjects_(getSheet_(SHEET_NAMES.TEAM));
  var currentHeadcount = 0;
  var teamRole = '';
  var personExists = false;
  if (o.PERSON_NAME) {
    var person = teamRows.filter(function (t) { return t.Name === o.PERSON_NAME; })[0];
    if (person) { currentHeadcount = 1; teamRole = person.Role || ''; personExists = true; }
  } else if (o.SKILL) {
    currentHeadcount = teamRows.filter(function (t) { return t.Skill === o.SKILL; }).length;
  }
  var idealHeadcount = Number(o.IDEAL_HEADCOUNT) || 0;
  var vacantHeadcount = Math.max(0, idealHeadcount - currentHeadcount);
  return {
    id: o.ORG_ID, parentId: o.PARENT_ORG_ID || '', level: Number(o.ORG_LEVEL) || 1,
    name: o.ORG_NAME, position: o.POSITION || '', personName: o.PERSON_NAME || '',
    personExistsInTeam: o.PERSON_NAME ? personExists : null,
    teamRole: teamRole, skill: o.SKILL || '',
    idealHeadcount: idealHeadcount, currentHeadcount: currentHeadcount, vacantHeadcount: vacantHeadcount,
    status: o.STATUS, note: o.NOTE || '', createdBy: o.CREATED_BY, createdAt: o.CREATED_AT, updatedAt: o.UPDATED_AT
  };
}

/* ============================================================
 *  CRUD
 * ============================================================ */
function handleCreateOrgNode_(body, auth) {
  if (!body.name) return { ok: false, message: 'name wajib diisi.' };
  var status = body.status || 'ACTIVE';
  if (!validateOrgStatus_(status)) return { ok: false, message: 'Status tidak dikenal. Lihat Config!ORG_STATUS_LIST.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensurePhase4Config_();
    setupOrgStructureSheet_();
    var sh = getSheet_(SHEET_NAMES.ORG_STRUCTURE);
    var id = newId_('org');
    var clean = sanitizeObjStrings_(body, ['name', 'position', 'personName', 'skill', 'note']);
    var parentId = body.parentId || '';
    var level = parentId ? computeChildLevel_(parentId) : 1;
    var nowIso = new Date().toISOString();
    var row = [
      id, parentId, level, clean.name, clean.position || '', clean.personName || '', clean.skill || '',
      Number(body.idealHeadcount) || 0, status, clean.note || '', auth.n, nowIso, nowIso
    ];
    sh.appendRow(row);
    var obj = {};
    ORG_STRUCTURE_HEADERS.forEach(function (h, i) { obj[h] = row[i]; });
    return { ok: true, node: orgNodeToObj_(obj) };
  } finally {
    lock.releaseLock();
  }
}
function computeChildLevel_(parentId) {
  var parent = rowsToObjects_(getSheet_(SHEET_NAMES.ORG_STRUCTURE)).filter(function (r) { return r.ORG_ID === parentId; })[0];
  return parent ? (Number(parent.ORG_LEVEL) || 1) + 1 : 1;
}

function handleUpdateOrgNode_(body, auth) {
  if (!body.id) return { ok: false, message: 'ID org node wajib diisi.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSheet_(SHEET_NAMES.ORG_STRUCTURE);
    var rowIdx = findRowIndexById_(sh, 'ORG_ID', body.id);
    if (rowIdx === -1) return { ok: false, message: 'Org node tidak ditemukan.' };
    var rowVals = sh.getRange(rowIdx, 1, 1, ORG_STRUCTURE_HEADERS.length).getValues()[0];
    var obj = {};
    ORG_STRUCTURE_HEADERS.forEach(function (h, i) { obj[h] = rowVals[i]; });

    if (body.status !== undefined && !validateOrgStatus_(body.status)) {
      return { ok: false, message: 'Status tidak dikenal. Lihat Config!ORG_STATUS_LIST.' };
    }
    var clean = sanitizeObjStrings_(body, ['name', 'position', 'personName', 'skill', 'note']);
    var fieldMap = { name: 'ORG_NAME', position: 'POSITION', personName: 'PERSON_NAME', skill: 'SKILL', status: 'STATUS', note: 'NOTE', idealHeadcount: 'IDEAL_HEADCOUNT' };
    var patch = {};
    Object.keys(fieldMap).forEach(function (f) {
      if (body[f] === undefined) return;
      patch[fieldMap[f]] = f === 'idealHeadcount' ? (Number(body[f]) || 0) : (clean[f] !== undefined ? clean[f] : body[f]);
    });
    patch.UPDATED_AT = new Date().toISOString();
    ORG_STRUCTURE_HEADERS.forEach(function (h, i) {
      if (Object.prototype.hasOwnProperty.call(patch, h)) sh.getRange(rowIdx, i + 1).setValue(patch[h]);
    });
    return { ok: true, node: orgNodeToObj_(Object.assign({}, obj, patch)) };
  } finally {
    lock.releaseLock();
  }
}

/** Part H: "saving a vacancy" = setting the Ideal Headcount target on a
 *  node — vacancy itself is never stored, only ever derived (Ideal −
 *  Current) at read time in orgNodeToObj_. No fake employee row is
 *  ever created for a vacant slot. */
function handleSaveVacancy_(body, auth) {
  if (!body.id) return { ok: false, message: 'ID org node wajib diisi.' };
  if (body.idealHeadcount === undefined) return { ok: false, message: 'idealHeadcount wajib diisi.' };
  if (Number(body.idealHeadcount) < 0) return { ok: false, message: 'idealHeadcount tidak boleh negatif.' };
  return handleUpdateOrgNode_({ id: body.id, idealHeadcount: body.idealHeadcount, note: body.note }, auth);
}

/* ============================================================
 *  READ — full tree + flattened vacancy summary
 * ============================================================ */
function handleGetOrgStructure_() {
  var rows = rowsToObjects_(getSheet_(SHEET_NAMES.ORG_STRUCTURE));
  var nodes = rows.map(orgNodeToObj_);
  var byParent = {};
  nodes.forEach(function (n) {
    var key = n.parentId || '';
    (byParent[key] = byParent[key] || []).push(n);
  });
  function build(parentId) {
    return (byParent[parentId] || []).map(function (n) {
      return Object.assign({}, n, { children: build(n.id) });
    });
  }
  return { ok: true, tree: build(''), flat: nodes };
}

function handleGetVacancySummary_() {
  var flat = handleGetOrgStructure_().flat;
  return {
    ok: true,
    vacancies: flat.map(function (n) {
      return { id: n.id, name: n.name, position: n.position, skill: n.skill, current: n.currentHeadcount, ideal: n.idealHeadcount, vacant: n.vacantHeadcount };
    }).filter(function (v) { return v.ideal > 0; }) // only nodes that actually declare a headcount target are meaningful here
  };
}
