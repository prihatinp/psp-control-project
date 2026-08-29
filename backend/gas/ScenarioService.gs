/**
 * ScenarioService.gs — deliberately lightweight per locked decision #12.
 * previewDemand_ answers the three questions in PRD §12 (who / how many
 * man-day / is there capacity) from numbers already on the draft, without
 * a simulation/optimization engine.
 */

function addScenario_(user, payload) {
  const scenario = {
    scenario_id: nextId_('SCN'),
    name: payload.name,
    parent_type: payload.parentType || '',
    parent_id: payload.parentId || '',
    assumption: payload.assumption || '',
    resource_option: payload.resourceOption || '',
    projected_mp_impact: toNumber_(payload.projectedMpImpact, 0),
    projected_capacity_impact: toNumber_(payload.projectedCapacityImpact, 0),
    status: 'SCENARIO',
    created_at: nowIso_(),
    created_by: user.name
  };
  appendRow_('SCENARIO', scenario);
  logAudit_(user.name, 'ADD_SCENARIO', 'SCENARIO', scenario.scenario_id, { name: scenario.name });
  return { ok: true, scenario: scenario };
}

function listScenarios_() {
  return readAll_('SCENARIO');
}

/**
 * Pre-commit preview (PRD §15): Man-Day, Required Skill, Resource Loading,
 * Capacity Impact, MP Gap, Schedule Impact — from a draft WBS array the
 * caller supplies, before anything is written to WBS/ASSIGNMENT.
 * payload.wbsDraft: [{ activity, mp, needDay, skill, resourceId? }]
 */
function previewDemand_(payload) {
  const draft = payload.wbsDraft || [];
  const totalManDay = draft.reduce((sum, r) => sum + toNumber_(r.mp) * toNumber_(r.needDay), 0);
  const requiredSkills = [...new Set(draft.map(r => r.skill).filter(Boolean))];

  const resourceLoading = requiredSkills.map(skill => {
    const candidates = findAll_('RESOURCE', r => r.skill === skill && r.status === 'Active');
    const totalCapacity = candidates.reduce((s, r) => s + toNumber_(r.weekly_capacity_days, 5), 0);
    const currentLoad = candidates.reduce((s, r) => s + getResourceLoad_(r.resource_id, weekStart_(), weekEnd_()), 0);
    return { skill, candidateCount: candidates.length, weeklyCapacityDays: totalCapacity, currentLoadManDay: currentLoad, remainingCapacityDays: totalCapacity - currentLoad };
  });

  const capacityImpact = resourceLoading.map(r => ({
    skill: r.skill,
    sufficientCapacity: r.remainingCapacityDays >= (totalManDay / Math.max(requiredSkills.length, 1))
  }));

  const mpGapBySkill = resourceLoading.filter(r => r.candidateCount === 0).map(r => r.skill);

  return {
    ok: true,
    totalManDay,
    requiredSkills,
    resourceLoading,
    capacityImpact,
    mpGap: mpGapBySkill,
    scheduleImpactNote: draft.length ? ('Estimasi ' + draft.length + ' aktivitas, total ' + totalManDay + ' man-day — validasi jadwal detail pada Phase 3 (WBS scheduling).') : 'Tidak ada draft WBS untuk dievaluasi.'
  };
}
