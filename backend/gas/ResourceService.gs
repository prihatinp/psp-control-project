/**
 * ResourceService.gs — RESOURCE + ASSIGNMENT (PRD §7/§14). ASSIGNMENT is
 * what makes Multi-PIC possible: many ASSIGNMENT rows can point at one
 * wbs_id, each pointing at a different resource_id.
 */

function addResource_(user, payload) {
  const resource = {
    resource_id: payload.resourceId || nextId_('RES'),
    name: payload.name,
    skill: payload.skill || '',
    level: payload.level || '',
    status: payload.status || 'Active',
    weekly_capacity_days: toNumber_(payload.weeklyCapacityDays, 5),
    created_at: nowIso_()
  };
  appendRow_('RESOURCE', resource);
  logAudit_(user.name, 'ADD_RESOURCE', 'RESOURCE', resource.resource_id, { name: resource.name });
  return { ok: true, resource: resource };
}

function listResources_() {
  return readAll_('RESOURCE');
}

function addAssignment_(user, payload) {
  const assignment = {
    assignment_id: nextId_('ASG'),
    wbs_id: payload.wbsId,
    resource_id: payload.resourceId,
    role: payload.role || 'PIC',
    allocated_man_day: toNumber_(payload.allocatedManDay, 0),
    created_at: nowIso_()
  };
  appendRow_('ASSIGNMENT', assignment);
  logAudit_(user.name, 'ADD_ASSIGNMENT', 'ASSIGNMENT', assignment.assignment_id, { wbs_id: payload.wbsId, resource_id: payload.resourceId });
  return { ok: true, assignment: assignment };
}

function listAssignmentsForWbs_(wbsId) {
  return findAll_('ASSIGNMENT', r => String(r.wbs_id) === String(wbsId));
}
