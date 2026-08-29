/**
 * OrganizationService.gs — ORG_NODE / POSITION / POSITION_ASSIGNMENT
 * (PRD §5/§6/§7). Organization must never be hard-coded: branches are
 * rows, not code. Current HC is always derived by counting active
 * POSITION_ASSIGNMENT rows, never trusted as a stored/stale number.
 */

function addOrgNode_(user, payload) {
  const node = {
    node_id: nextId_('ORG'),
    parent_node_id: payload.parentNodeId || '',
    name: payload.name,
    type: payload.type || 'Team',
    display_order: toNumber_(payload.displayOrder, 0)
  };
  appendRow_('ORG_NODE', node);
  logAudit_(user.name, 'ADD_ORG_NODE', 'ORG_NODE', node.node_id, { name: node.name, parent: node.parent_node_id });
  return { ok: true, node: node };
}

function listOrgTree_() {
  const nodes = readAll_('ORG_NODE');
  const byParent = {};
  nodes.forEach(n => {
    const key = n.parent_node_id || '';
    (byParent[key] = byParent[key] || []).push(n);
  });
  function build(parentId) {
    return (byParent[parentId] || [])
      .sort((a, b) => toNumber_(a.display_order) - toNumber_(b.display_order))
      .map(n => Object.assign({}, n, { children: build(n.node_id) }));
  }
  return build('');
}

function addPosition_(user, payload) {
  const position = {
    position_id: nextId_('POS'),
    org_node_id: payload.orgNodeId,
    title: payload.title,
    required_skill: payload.requiredSkill || '',
    ideal_hc: toNumber_(payload.idealHc, 1)
  };
  appendRow_('POSITION', position);
  logAudit_(user.name, 'ADD_POSITION', 'POSITION', position.position_id, { title: position.title, org_node_id: position.org_node_id });
  return { ok: true, position: position };
}

/** Current HC + Vacancy are always computed, never stored, so they can't drift from the assignment data. */
function listPositionsWithVacancy_() {
  const positions = readAll_('POSITION');
  const assignments = readAll_('POSITION_ASSIGNMENT');
  return positions.map(p => {
    const currentHc = assignments.filter(a => String(a.position_id) === String(p.position_id) && !a.end_date).length;
    const idealHc = toNumber_(p.ideal_hc, 0);
    const gap = idealHc - currentHc;
    return Object.assign({}, p, {
      current_hc: currentHc,
      gap: gap,
      display: gap > 0 ? 'VACANT' : 'Filled'
    });
  });
}

function assignResourceToPosition_(user, payload) {
  const assignment = {
    pos_assign_id: nextId_('PA'),
    position_id: payload.positionId,
    resource_id: payload.resourceId,
    start_date: payload.startDate || nowIso_(),
    end_date: ''
  };
  appendRow_('POSITION_ASSIGNMENT', assignment);
  logAudit_(user.name, 'ASSIGN_POSITION', 'POSITION_ASSIGNMENT', assignment.pos_assign_id, { position_id: payload.positionId, resource_id: payload.resourceId });
  return { ok: true, assignment: assignment };
}
