/**
 * Config.gs — Script Properties access + the CONFIG sheet (runtime-editable
 * settings). Nothing here is a secret; secrets live only in Script
 * Properties and are never written to a sheet or committed to source.
 */

function getScriptProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing Script Property "' + key + '". Set it in Apps Script → Project Settings → Script Properties. See backend/README.md.');
  return v;
}

function getConfigValue_(key, fallback) {
  const row = findOne_('CONFIG', r => r.config_key === key);
  return row ? row.value : fallback;
}

function getConfigList_(key, fallback) {
  const raw = getConfigValue_(key, null);
  if (!raw) return fallback || [];
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

/** Seed rows written by setupSchema() the first time CONFIG is created. Values are all meant to be edited by Admin afterwards, never hard-coded in service code. */
const DEFAULT_CONFIG_ROWS_ = [
  { config_key: 'IRREGULAR_JOB_CATEGORIES', value: 'Capacity Up,Komarigoto Produksi,Quality Up', note: 'Comma-separated. PRD §1: additional categories must be configurable, not hard-coded.' },
  { config_key: 'OT_CURRENT_REF_HOURS_PER_MONTH_PER_MP', value: '56', note: 'Management historical OT reference (PRD §8).' },
  { config_key: 'OT_TARGET_REF_HOURS_PER_MONTH_PER_MP', value: '16', note: 'Management target OT reference (PRD §8).' },
  { config_key: 'SUPPORT_CAPACITY_MANDAY_PER_WEEK', value: '60', note: 'Legacy Komarigoto/PICA weekly capacity ceiling, preserved from the existing app.' },
  { config_key: 'DEMAND_STATUS_LIST', value: 'PIPELINE,SCENARIO,COMMITTED', note: 'Lifecycle for new demand (PRD §14/§17.14).' }
];
