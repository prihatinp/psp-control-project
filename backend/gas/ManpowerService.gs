/**
 * ManpowerService.gs — MP_BASELINE + the Baseline-vs-Calculated view
 * (PRD §8/§9/§18 — the Governance Rule). The management "+8" figure is
 * only ever written by setMpBaseline_, gated by isManagementRole_, and
 * every write is audited. No other function in this codebase may modify
 * MP_BASELINE — the calculation engine only *reads* it to compute
 * variance, per the locked decision "engine must never overwrite the
 * baseline".
 */

function getMpBaseline_(fiscalYear) {
  return findOne_('MP_BASELINE', r => Number(r.fiscal_year) === Number(fiscalYear));
}

function setMpBaseline_(user, payload) {
  if (!isManagementRole_(user.role)) {
    throw new AuthError_('Hanya management yang dapat mengubah MP Baseline');
  }
  const existing = getMpBaseline_(payload.fiscalYear);
  const record = {
    fiscal_year: payload.fiscalYear,
    current_mp: toNumber_(payload.currentMp, 0),
    management_add_mp: toNumber_(payload.managementAddMp, 0),
    ot_current_ref: toNumber_(payload.otCurrentRef, getConfigValue_('OT_CURRENT_REF_HOURS_PER_MONTH_PER_MP', 56)),
    ot_target_ref: toNumber_(payload.otTargetRef, getConfigValue_('OT_TARGET_REF_HOURS_PER_MONTH_PER_MP', 16)),
    approved_by: user.name,
    approved_at: nowIso_()
  };
  if (existing) {
    updateById_('MP_BASELINE', 'fiscal_year', payload.fiscalYear, record);
  } else {
    appendRow_('MP_BASELINE', record);
  }
  logAudit_(user.name, 'SET_MP_BASELINE', 'MP_BASELINE', String(payload.fiscalYear), record);
  return { ok: true, baseline: record };
}

/**
 * Calculated Required MP: a first-pass proxy (sum of estimated MP across
 * open WBS + Irregular Job for the fiscal year). Refine in the Phase 4
 * capacity-engine work — this is intentionally simple for the foundation.
 */
function calculateRequiredMp_(fiscalYear) {
  const wbsMp = findAll_('WBS', r => r.status !== 'COMMITTED_DONE')
    .reduce((sum, r) => sum + toNumber_(r.mp), 0);
  const jobMp = findAll_('IRREGULAR_JOB', r => fiscalYearOf_(r.request_date) === Number(fiscalYear))
    .reduce((sum, r) => sum + toNumber_(r.estimated_mp), 0);
  return wbsMp + jobMp;
}

function getMpPlanningView_(fiscalYear) {
  const baseline = getMpBaseline_(fiscalYear);
  const currentMp = baseline ? toNumber_(baseline.current_mp) : listResources_().filter(r => r.status === 'Active').length;
  const managementAddMp = baseline ? toNumber_(baseline.management_add_mp) : 0;
  const managementIdealMp = currentMp + managementAddMp;
  const calculatedRequiredMp = calculateRequiredMp_(fiscalYear);
  return {
    fiscalYear: fiscalYear,
    currentAvailableMp: currentMp,
    managementAdditionalMp: managementAddMp,
    managementIdealMp: managementIdealMp,
    calculatedRequiredMp: calculatedRequiredMp,
    calculatedGap: calculatedRequiredMp - currentMp,
    managementGap: managementIdealMp - currentMp,
    varianceVsManagement: calculatedRequiredMp - managementIdealMp,
    baselineApproved: !!baseline
  };
}
