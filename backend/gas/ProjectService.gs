/**
 * ProjectService.gs — compatibility layer reconstructing the existing
 * frontend's contract (teamNames, bootstrap, addProject, markStage,
 * undoStage) plus the additive PROJECT_MASTER entity.
 *
 * IMPORTANT — Phase 1A dependency: the legacy_* functions below assume
 * sheet/column names identical to the JSON field names js/app.js already
 * sends and reads (Team, Stages, Phases, Projects, DailyLogs — with
 * fields id/no/name/line/pic/support/category/start/target/progressStage/
 * stageDates/note). This is a reasonable reconstruction from the client
 * contract, not a copy of verified server source — confirm against the
 * real Code.gs (Phase 1A) before ever pointing this at production.
 */

function legacyTeamNames_() {
  return readAll_('Team').map(t => ({ name: t.name, role: t.role }));
}

function legacyBootstrap_() {
  return {
    ok: true,
    team: readAll_('Team'),
    stages: readAll_('Stages'),
    phases: readAll_('Phases'),
    projects: readAll_('Projects'),
    dailyLogs: readAll_('DailyLogs'),
    supportJobs: readAll_('SupportJobs'),
    globalSupport: readAll_('GlobalSupport'),
    supportCapacity: toNumber_(getConfigValue_('SUPPORT_CAPACITY_MANDAY_PER_WEEK', 60), 60)
  };
}

function legacyAddProject_(user, payload) {
  const project = {
    id: nextId_('PRJ'),
    no: payload.no || 'NO-BUDGET',
    name: payload.name,
    line: payload.line,
    pic: payload.pic,
    support: payload.support,
    category: payload.category,
    start: payload.start,
    target: payload.target,
    progressStage: 0,
    stageDates: JSON.stringify({}),
    note: payload.note || ''
  };
  appendRow_('Projects', project);
  logAudit_(user.name, 'ADD_PROJECT', 'PROJECT', project.id, { no: project.no, name: project.name });
  return { ok: true, project: project };
}

function legacyMarkStage_(user, projectId, idx) {
  const rows = readAll_('Projects');
  const p = rows.find(r => r.id === projectId);
  if (!p) throw new Error('Project tidak ditemukan');
  const stageDates = safeParse_(p.stageDates);
  stageDates[idx] = Object.assign(stageDates[idx] || {}, { end: nowIso_() });
  const updated = updateById_('Projects', 'id', projectId, {
    progressStage: Math.max(toNumber_(p.progressStage), idx + 1),
    stageDates: JSON.stringify(stageDates)
  });
  logAudit_(user.name, 'MARK_STAGE', 'PROJECT', projectId, { idx: idx });
  return { ok: true, project: updated };
}

function legacyUndoStage_(user, projectId, idx) {
  const rows = readAll_('Projects');
  const p = rows.find(r => r.id === projectId);
  if (!p) throw new Error('Project tidak ditemukan');
  const updated = updateById_('Projects', 'id', projectId, { progressStage: Math.min(toNumber_(p.progressStage), idx) });
  logAudit_(user.name, 'UNDO_STAGE', 'PROJECT', projectId, { idx: idx });
  return { ok: true, project: updated };
}

function safeParse_(jsonStr) {
  try { return JSON.parse(jsonStr || '{}'); } catch (e) { return {}; }
}

/* ===================== NEW: PROJECT_MASTER (Rev D) ===================== */

/** Creates an External or Internal demand record. Irregular Job uses IrregularJobService instead — see PRD §2/§3. */
function addProjectMaster_(user, payload) {
  if (['External', 'Internal'].indexOf(payload.type) === -1) {
    throw new Error('type harus "External" atau "Internal" (Irregular Job pakai addIrregularJob)');
  }
  const record = {
    project_id: nextId_('PM'),
    type: payload.type,
    name: payload.name,
    customer_or_requestor: payload.customerOrRequestor || '',
    intake_date: payload.intakeDate || nowIso_(),
    target_date: payload.targetDate || '',
    priority: payload.priority || 'Medium',
    status: 'PIPELINE',
    lifecycle_stage: '',
    pic_resource_id: payload.picResourceId || '',
    fiscal_year: fiscalYearOf_(payload.intakeDate),
    created_at: nowIso_(),
    created_by: user.name
  };
  appendRow_('PROJECT_MASTER', record);
  logAudit_(user.name, 'ADD_PROJECT_MASTER', 'PROJECT_MASTER', record.project_id, { type: record.type, name: record.name });
  return { ok: true, project: record };
}

function listProjectMaster_(filter) {
  return findAll_('PROJECT_MASTER', filter ? (r => r.type === filter) : null);
}
