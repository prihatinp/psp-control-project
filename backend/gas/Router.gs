/**
 * Router.gs — one dispatch table, one auth check, one error shape.
 * Legacy actions preserve the exact request/response contract js/app.js
 * already expects (see ProjectService.gs header for the recovery caveat).
 * New Rev D actions are additive.
 */

const ROUTES_ = {
  // ---- legacy-compatible (existing frontend) ----
  ping:            { auth: false, fn: () => ({ ok: true, pong: nowIso_() }) },
  teamNames:       { auth: false, fn: () => legacyTeamNames_() },
  login:           { auth: false, fn: (u, p) => login_(p.name, p.pin) },
  bootstrap:       { auth: true,  fn: (u) => legacyBootstrap_() },
  addProject:      { auth: true,  fn: (u, p) => legacyAddProject_(u, p) },
  saveDailyLog:    { auth: true,  fn: (u, p) => legacySaveDailyLog_(u, p) },
  saveSupportJob:  { auth: true,  fn: (u, p) => legacySaveSupportJob_(u, p) },
  saveGlobalItem:  { auth: true,  fn: (u, p) => legacySaveGlobalItem_(u, p) },
  markStage:       { auth: true,  fn: (u, p) => legacyMarkStage_(u, p.projectId, p.idx) },
  undoStage:       { auth: true,  fn: (u, p) => legacyUndoStage_(u, p.projectId, p.idx) },

  // ---- new: PROJECT_MASTER / WBS / IRREGULAR_JOB ----
  addProjectMaster:   { auth: true, fn: (u, p) => addProjectMaster_(u, p) },
  listProjectMaster:  { auth: true, fn: (u, p) => ({ ok: true, projects: listProjectMaster_(p.type) }) },
  addWbsItem:         { auth: true, fn: (u, p) => addWbsItem_(u, p) },
  listWbs:            { auth: true, fn: (u, p) => ({ ok: true, wbs: listWbsForParent_(p.parentType, p.parentId) }) },
  addIrregularJob:    { auth: true, fn: (u, p) => addIrregularJob_(u, p) },
  listIrregularJobs:  { auth: true, fn: (u, p) => ({ ok: true, jobs: listIrregularJobs_(p.category) }) },
  seedIrregularJobWbs:{ auth: true, fn: (u, p) => ({ ok: true, wbs: seedIrregularJobWbs_(u, p.jobId) }) },

  // ---- new: RESOURCE / ASSIGNMENT / CAPACITY ----
  addResource:        { auth: true, fn: (u, p) => addResource_(u, p) },
  listResources:      { auth: true, fn: () => ({ ok: true, resources: listResources_() }) },
  addAssignment:      { auth: true, fn: (u, p) => addAssignment_(u, p) },
  getResourceCapacity:{ auth: true, fn: (u, p) => ({ ok: true, capacity: getResourceCapacitySummary_(p.resourceId) }) },

  // ---- new: ORGANIZATION ----
  addOrgNode:         { auth: true, fn: (u, p) => addOrgNode_(u, p) },
  listOrgTree:        { auth: true, fn: () => ({ ok: true, tree: listOrgTree_() }) },
  addPosition:        { auth: true, fn: (u, p) => addPosition_(u, p) },
  listPositions:      { auth: true, fn: () => ({ ok: true, positions: listPositionsWithVacancy_() }) },
  assignResourceToPosition: { auth: true, fn: (u, p) => assignResourceToPosition_(u, p) },

  // ---- new: MP PLANNING (management-baseline gated) ----
  getMpPlanningView:  { auth: true, fn: (u, p) => ({ ok: true, view: getMpPlanningView_(p.fiscalYear) }) },
  setMpBaseline:      { auth: true, fn: (u, p) => setMpBaseline_(u, p) },

  // ---- new: SCENARIO / PREVIEW ----
  addScenario:        { auth: true, fn: (u, p) => addScenario_(u, p) },
  listScenarios:      { auth: true, fn: () => ({ ok: true, scenarios: listScenarios_() }) },
  previewDemand:      { auth: true, fn: (u, p) => previewDemand_(p) },

  // ---- new: REPORTS / AUDIT ----
  logReportGenerated: { auth: true, fn: (u, p) => logReportGenerated_(u, p.type, p.period) },
  listReportHistory:  { auth: true, fn: () => ({ ok: true, history: listReportHistory_() }) },
  listAuditLog:        { auth: true, fn: (u, p) => {
      if (!isManagementRole_(u.role)) throw new AuthError_('Audit log hanya untuk management');
      return { ok: true, log: listAuditLog_(toNumber_(p.limit, 100)) };
  } }
};

function dispatch_(action, params, token) {
  const route = ROUTES_[action];
  if (!route) return { ok: false, message: 'Unknown action: ' + action };

  let user = null;
  if (route.auth) {
    try {
      user = requireAuth_(token);
    } catch (e) {
      return { ok: false, authError: true, message: e.message };
    }
  }

  try {
    return route.fn(user, params || {});
  } catch (e) {
    if (e && e.authError) return { ok: false, authError: true, message: e.message };
    return { ok: false, message: e && e.message ? e.message : String(e) };
  }
}
