/**
 * SchemaSetup.gs — ADDITIVE migration only.
 *
 * Run setupSchema() once (Apps Script editor → select function → Run) against
 * the target spreadsheet. It creates the Rev D sheets below if and only if
 * they don't already exist, and seeds CONFIG + a root ORG_NODE the first
 * time. It never reads, writes, renames, or deletes any pre-existing sheet
 * (Team / Stages / Phases / Projects / DailyLogs / SupportJobs /
 * GlobalSupport, or whatever the real names turn out to be after Phase 1A).
 *
 * Recommended: point SHEET_ID (Script Property) at a COPY of the production
 * spreadsheet for the first run, not the live one.
 */
function setupSchema() {
  const schemas = {
    PROJECT_MASTER: ['project_id', 'type', 'name', 'customer_or_requestor', 'intake_date', 'target_date', 'priority', 'status', 'lifecycle_stage', 'pic_resource_id', 'fiscal_year', 'created_at', 'created_by'],
    WBS: ['wbs_id', 'parent_type', 'parent_id', 'activity', 'detail', 'plan_date', 'do_date', 'mp', 'need_day', 'man_day', 'start_date', 'end_date', 'depends_on', 'status', 'created_at'],
    IRREGULAR_JOB: ['job_id', 'category', 'requestor', 'area', 'problem', 'priority', 'status', 'pic_resource_id', 'estimated_mp', 'estimated_need_day', 'request_date', 'created_at'],
    RESOURCE: ['resource_id', 'name', 'skill', 'level', 'status', 'weekly_capacity_days', 'created_at'],
    ASSIGNMENT: ['assignment_id', 'wbs_id', 'resource_id', 'role', 'allocated_man_day', 'created_at'],
    ORG_NODE: ['node_id', 'parent_node_id', 'name', 'type', 'display_order'],
    POSITION: ['position_id', 'org_node_id', 'title', 'required_skill', 'ideal_hc'],
    POSITION_ASSIGNMENT: ['pos_assign_id', 'position_id', 'resource_id', 'start_date', 'end_date'],
    MP_BASELINE: ['fiscal_year', 'current_mp', 'management_add_mp', 'ot_current_ref', 'ot_target_ref', 'approved_by', 'approved_at'],
    ANNUAL_LOADING: ['year', 'project_volume', 'mp_actual', 'ratio_mp_per_project', 'ot_hours', 'ot_per_month_per_mp'],
    SCENARIO: ['scenario_id', 'name', 'parent_type', 'parent_id', 'assumption', 'resource_option', 'projected_mp_impact', 'projected_capacity_impact', 'status', 'created_at', 'created_by'],
    WEEKLY_UPDATE: ['update_id', 'parent_type', 'parent_id', 'wbs_id', 'date', 'engineer', 'plan', 'actual', 'problem', 'next_action', 'created_at'],
    REPORT_HISTORY: ['report_id', 'type', 'period', 'generated_at', 'generated_by', 'version'],
    AUDIT_LOG: ['audit_id', 'timestamp', 'actor', 'action', 'entity_type', 'entity_id', 'details'],
    CONFIG: ['config_key', 'value', 'note']
  };

  const created = [];
  Object.keys(schemas).forEach(name => {
    const existedBefore = !!ss_().getSheetByName(name);
    getOrCreateSheet_(name, schemas[name]);
    if (!existedBefore) created.push(name);
  });

  if (created.indexOf('CONFIG') !== -1) {
    DEFAULT_CONFIG_ROWS_.forEach(row => appendRow_('CONFIG', row));
  }
  if (created.indexOf('ORG_NODE') !== -1) {
    appendRow_('ORG_NODE', { node_id: 'ORG-ROOT', parent_node_id: '', name: 'PSP / Division Head', type: 'Divisi', display_order: 0 });
  }

  Logger.log('setupSchema() created: ' + (created.length ? created.join(', ') : '(nothing — all sheets already existed)'));
  return { ok: true, created };
}
