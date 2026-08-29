/**
 * LegacyCompatService.gs — the remaining existing-frontend actions that
 * don't belong under ProjectService: Daily Update, Komarigoto/PICA
 * (SupportJobs), and Global Support. Same Phase 1A caveat as
 * ProjectService.gs applies — sheet/column names are reconstructed from
 * the client contract in js/app.js, not copied from verified server
 * source.
 */

function legacySaveDailyLog_(user, payload) {
  const projects = readAll_('Projects');
  const project = projects.find(p => p.id === payload.projectId);
  if (!project) throw new Error('Project tidak ditemukan');

  const log = {
    projectNo: project.no,
    date: payload.date,
    engineer: payload.engineer,
    stage: payload.stage,
    plan: payload.plan,
    actual: payload.actual,
    problem: payload.problem || '-',
    next: payload.next || '-'
  };
  appendRow_('DailyLogs', log);

  const updatedProject = updateById_('Projects', 'id', payload.projectId, {
    progressStage: Math.max(toNumber_(project.progressStage), toNumber_(payload.stage))
  });

  logAudit_(user.name, 'SAVE_DAILY_LOG', 'PROJECT', payload.projectId, { date: log.date, engineer: log.engineer });
  return { ok: true, log: log, project: updatedProject };
}

function legacySaveSupportJob_(user, payload) {
  const job = {
    date: payload.date,
    type: payload.type,
    line: payload.line,
    pic: payload.pic,
    manDay: payload.manDay,
    desc: payload.desc
  };
  appendRow_('SupportJobs', job);
  logAudit_(user.name, 'SAVE_SUPPORT_JOB', 'SUPPORT_JOB', payload.line + '@' + payload.date, { type: job.type, manDay: job.manDay });
  return { ok: true, job: job };
}

function legacySaveGlobalItem_(user, payload) {
  const item = {
    country: payload.country,
    flag: payload.flag || '🌏',
    pic: payload.pic,
    status: payload.status,
    item: payload.item
  };
  appendRow_('GlobalSupport', item);
  logAudit_(user.name, 'SAVE_GLOBAL_ITEM', 'GLOBAL_SUPPORT', payload.country, { item: item.item, status: item.status });
  return { ok: true, item: item };
}
