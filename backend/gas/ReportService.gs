/**
 * ReportService.gs — foundation-level REPORT_HISTORY logging only.
 * Actual Excel/PPT generation stays where it is today (client-side
 * pptxgenjs) until Phase 7; this just gives every export a persisted
 * record, per PRD §14 (REPORT_HISTORY) and Acceptance Criteria §16.
 */
function logReportGenerated_(user, type, period) {
  const record = {
    report_id: nextId_('RPT'),
    type: type,
    period: period || '',
    generated_at: nowIso_(),
    generated_by: user.name,
    version: 1
  };
  appendRow_('REPORT_HISTORY', record);
  logAudit_(user.name, 'GENERATE_REPORT', 'REPORT_HISTORY', record.report_id, { type: type, period: period });
  return { ok: true, report: record };
}

function listReportHistory_() {
  return readAll_('REPORT_HISTORY');
}
