/**
 * CapacityService.gs — shared Resource & Capacity Engine (PRD §2/§17.5):
 * every stream's Man-Day rolls up through ASSIGNMENT so Irregular Job load
 * is never invisible next to External/Internal load. Foundation-level
 * rollup only; skill-weighted optimization is a later phase.
 */

function getResourceLoad_(resourceId, fromDate, toDate) {
  const assignments = findAll_('ASSIGNMENT', r => String(r.resource_id) === String(resourceId));
  const wbsById = {};
  readAll_('WBS').forEach(w => { wbsById[w.wbs_id] = w; });

  let totalManDay = 0;
  assignments.forEach(a => {
    const wbs = wbsById[a.wbs_id];
    if (!wbs) return;
    const wStart = wbs.start_date ? new Date(wbs.start_date) : null;
    if (fromDate && wStart && wStart < new Date(fromDate)) return;
    if (toDate && wStart && wStart > new Date(toDate)) return;
    totalManDay += toNumber_(a.allocated_man_day, 0);
  });
  return totalManDay;
}

function getResourceCapacitySummary_(resourceId) {
  const resource = findOne_('RESOURCE', r => String(r.resource_id) === String(resourceId));
  if (!resource) throw new Error('Resource tidak ditemukan: ' + resourceId);
  const weeklyCapacity = toNumber_(resource.weekly_capacity_days, 5);
  const loadThisWeek = getResourceLoad_(resourceId, weekStart_(), weekEnd_());
  return {
    resourceId: resourceId,
    name: resource.name,
    weeklyCapacityDays: weeklyCapacity,
    loadedManDayThisWeek: loadThisWeek,
    utilizationPct: weeklyCapacity ? Math.round((loadThisWeek / weeklyCapacity) * 100) : 0
  };
}

function weekStart_() {
  const d = new Date(); d.setDate(d.getDate() - 7); return d;
}
function weekEnd_() {
  return new Date();
}
