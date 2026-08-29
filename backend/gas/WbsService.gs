/**
 * WbsService.gs — WBS is shared by PROJECT_MASTER and IRREGULAR_JOB
 * (parent_type/parent_id), per PRD §4/§14. Foundation phase: CRUD +
 * dependency field only; schedule/critical-path logic is a later phase.
 */

function addWbsItem_(user, payload) {
  if (['PROJECT_MASTER', 'IRREGULAR_JOB'].indexOf(payload.parentType) === -1) {
    throw new Error('parentType harus PROJECT_MASTER atau IRREGULAR_JOB');
  }
  const item = {
    wbs_id: nextId_('WBS'),
    parent_type: payload.parentType,
    parent_id: payload.parentId,
    activity: payload.activity,
    detail: payload.detail || '',
    plan_date: payload.planDate || '',
    do_date: payload.doDate || '',
    mp: toNumber_(payload.mp, 0),
    need_day: toNumber_(payload.needDay, 0),
    man_day: toNumber_(payload.manDay, 0),
    start_date: payload.startDate || '',
    end_date: payload.endDate || '',
    depends_on: payload.dependsOn || '',
    status: payload.status || 'PIPELINE',
    created_at: nowIso_()
  };
  appendRow_('WBS', item);
  logAudit_(user.name, 'ADD_WBS', 'WBS', item.wbs_id, { parent: payload.parentType + ':' + payload.parentId, activity: item.activity });
  return { ok: true, wbs: item };
}

function listWbsForParent_(parentType, parentId) {
  return findAll_('WBS', r => r.parent_type === parentType && String(r.parent_id) === String(parentId));
}
