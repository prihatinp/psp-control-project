/**
 * IrregularJobService.gs — PRD §1/§3/§4. Categories come from CONFIG
 * (IRREGULAR_JOB_CATEGORIES), never hard-coded, so Admin can add
 * "Other configurable categories" without a code change.
 */

function addIrregularJob_(user, payload) {
  const allowed = getConfigList_('IRREGULAR_JOB_CATEGORIES', ['Capacity Up', 'Komarigoto Produksi', 'Quality Up']);
  if (allowed.indexOf(payload.category) === -1) {
    throw new Error('Kategori tidak dikenal. Kategori terdaftar: ' + allowed.join(', ') + ' (edit di sheet CONFIG untuk menambah).');
  }
  const job = {
    job_id: nextId_('IRJ'),
    category: payload.category,
    requestor: payload.requestor,
    area: payload.area || '',
    problem: payload.problem,
    priority: payload.priority || 'Medium',
    status: 'PIPELINE',
    pic_resource_id: payload.picResourceId || '',
    estimated_mp: toNumber_(payload.estimatedMp, 0),
    estimated_need_day: toNumber_(payload.estimatedNeedDay, 0),
    request_date: payload.requestDate || nowIso_(),
    created_at: nowIso_()
  };
  appendRow_('IRREGULAR_JOB', job);
  logAudit_(user.name, 'ADD_IRREGULAR_JOB', 'IRREGULAR_JOB', job.job_id, { category: job.category });
  return { ok: true, job: job };
}

function listIrregularJobs_(filter) {
  return findAll_('IRREGULAR_JOB', filter ? (r => r.category === filter) : null);
}

/** Default 8-step WBS template per PRD §4 — editable per category later; this seeds the standard sequence for a new job. */
const IRREGULAR_JOB_WBS_TEMPLATE_ = [
  'Receive / Register Request', 'Observe / Analyze Problem', 'Concept / Countermeasure',
  'Design / Prepare', 'Build / Implement', 'Trial / Verify',
  'Standardize / Documentation', 'Close & Record Lesson Learned'
];

function seedIrregularJobWbs_(user, jobId) {
  return IRREGULAR_JOB_WBS_TEMPLATE_.map((activity, i) =>
    addWbsItem_(user, { parentType: 'IRREGULAR_JOB', parentId: jobId, activity: (i + 1) + '. ' + activity }).wbs
  );
}
