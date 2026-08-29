/**
 * phase5.1-test.js — Phase 5.1: Reporting Calibration & Hardening.
 * Validates the fixes/additions made on top of the Phase 5 reporting
 * engine: Customer/Country/Plant separation, project health calibration,
 * risk engine audit (including the primaryReasonKey mismatch fix and the
 * new "missing Man-Day" rule), management baseline distinctness, manpower
 * scenario mutation-safety, workload reconciliation, the customer-facing
 * data contract, reporting-period edge cases, and Data Quality
 * integration on the dashboard.
 * Run with: node backend/production/test/phase5.1-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createMockGasContext } = require('./mock-gas-v2');

const PROD_DIR = path.join(__dirname, '..');
const LOAD_ORDER = ['Code.gs', 'ProjectMaster.gs', 'WbsWorkload.gs', 'Organization.gs', 'Reporting.gs'];

function freshContext() {
  const mockGlobals = createMockGasContext({ SS_ID: 'mock-ss', HMAC_SECRET: 'test-secret' });
  const context = vm.createContext(mockGlobals);
  LOAD_ORDER.forEach(file => vm.runInContext(fs.readFileSync(path.join(PROD_DIR, file), 'utf-8'), context, { filename: file }));
  return { mockGlobals, context };
}
function post(context, action, body, token) {
  const payload = Object.assign({ action }, body || {});
  if (token) payload.token = token;
  return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
}

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  ok  -', label); }
  catch (e) { failed++; console.error('  FAIL -', label, '\n       ', e.message); }
}

function daysFromToday(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function todayStr() { return daysFromToday(0); }
function configRow(mockGlobals, key) {
  const rows = mockGlobals.__SHEETS.Config.rows;
  const keyIdx = rows[0].indexOf('Key'), valIdx = rows[0].indexOf('Value');
  const idx = rows.findIndex(r => r[keyIdx] === key);
  return { rows, idx, valIdx };
}
function setProjectMasterCell(mockGlobals, projectId, headerName, value) {
  const rows = mockGlobals.__SHEETS.PROJECT_MASTER.rows;
  const colIdx = rows[0].indexOf(headerName);
  const rowIdx = rows.findIndex(r => r[0] === projectId);
  rows[rowIdx][colIdx] = value;
}
function setWbsCell(mockGlobals, wbsId, headerName, value) {
  const rows = mockGlobals.__SHEETS.WBS.rows;
  const colIdx = rows[0].indexOf(headerName);
  const rowIdx = rows.findIndex(r => r[0] === wbsId);
  rows[rowIdx][colIdx] = value;
}

/* ================================================================
 *  PART 1/2 — CUSTOMER / COUNTRY / PLANT DATA MODEL
 * ================================================================ */
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  console.log('=== PART 1/2: Customer / Country / Plant data model ===');

  check('1. PROJECT_MASTER migration: an already-provisioned 26-column sheet gets Country appended, idempotently, without touching existing data', () => {
    const OLD_HEADERS = ['ID', 'Type', 'No', 'Name', 'Customer', 'Plant', 'Category', 'Priority', 'Complexity', 'Status', 'IntakeDate', 'TargetDate', 'FiscalYear', 'RfqNo', 'RfqDate', 'QuotationStatus', 'QuotationDate', 'NegotiationStatus', 'PoNo', 'PoDate', 'PIC', 'Note', 'CreatedBy', 'CreatedAt', 'UpdatedAt', 'LegacyProjectId'];
    const existingRow = ['pm_existing', 'EXTERNAL', '', 'Old Row', 'Cust', 'Plant1', '', '', '', 'PO', '2026-01-01', '2026-12-31', '2026', '', '', '', '', '', '', '', 'PIC1', '', 'user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ''];
    mockGlobals.__SHEETS.PROJECT_MASTER = { rows: [OLD_HEADERS.slice(), existingRow.slice()] };
    context.ensureProjectMasterCountryColumn_();
    const rows = mockGlobals.__SHEETS.PROJECT_MASTER.rows;
    assert.strictEqual(rows[0][rows[0].length - 1], 'Country');
    assert.deepStrictEqual(rows[1].slice(0, existingRow.length), existingRow, 'pre-existing row must be byte-identical');
    const lenAfterFirst = rows[0].length;
    context.ensureProjectMasterCountryColumn_(); // idempotent re-run
    assert.strictEqual(mockGlobals.__SHEETS.PROJECT_MASTER.rows[0].length, lenAfterFirst, 'must not add Country twice');
  });

  // Reset to a clean, fully-set-up state for the rest of this block.
  const fresh = freshContext();
  fresh.context.setupSpreadsheet();
  const token2 = post(fresh.context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  const pWithCountry = post(fresh.context, 'addProjectMaster', {
    type: 'EXTERNAL', name: 'With Country', customer: 'Musashi', country: 'Vietnam', plant: 'Musashi Vietnam Plant 1',
    pic: 'Sukiyo', status: 'PO', targetDate: daysFromToday(300)
  }, token2).project;
  const pNoCountry = post(fresh.context, 'addProjectMaster', {
    type: 'EXTERNAL', name: 'No Country', customer: 'Musashi', pic: 'Wardiyono', status: 'EXECUTION', targetDate: daysFromToday(300)
  }, token2).project;

  check('2. Customer, Country and Plant are three distinct, independently-set fields (not derived from each other)', () => {
    assert.strictEqual(pWithCountry.customer, 'Musashi');
    assert.strictEqual(pWithCountry.country, 'Vietnam');
    assert.strictEqual(pWithCountry.plant, 'Musashi Vietnam Plant 1');
    assert.notStrictEqual(pWithCountry.country, pWithCountry.customer);
    assert.notStrictEqual(pWithCountry.country, pWithCountry.plant);
  });
  check('3. Country is never invented: a project with no Country supplied stays empty, not guessed from Customer/Plant', () => {
    assert.strictEqual(pNoCountry.country, '');
  });
  check('4. updateProjectMaster can set Country independently without touching Customer/Plant', () => {
    const updated = post(fresh.context, 'updateProjectMaster', { id: pNoCountry.id, country: 'India' }, token2).project;
    assert.strictEqual(updated.country, 'India');
    assert.strictEqual(updated.customer, 'Musashi');
  });
  check('5. groupedBy.customer and groupedBy.country are genuinely separate buckets (Phase 5 bug: country used to alias customer)', () => {
    const ext = post(fresh.context, 'getExternalWeeklyReport', {}, token2);
    assert.ok(ext.groupedBy.customer, 'customer'); // 'Musashi' should be one customer bucket
    assert.strictEqual(ext.groupedBy.customer['Musashi'], 2);
    assert.strictEqual(ext.groupedBy.country['Vietnam'], 1);
    assert.strictEqual(ext.groupedBy.country['India'], 1); // updated above
    assert.notStrictEqual(JSON.stringify(ext.groupedBy.customer), JSON.stringify(ext.groupedBy.country));
  });
  check('6. Country is a plain descriptive field, present in BOTH the internal and customer-facing external report rows', () => {
    const ext = post(fresh.context, 'getExternalWeeklyReport', {}, token2);
    const internalRow = ext.projects.find(p => p.projectName === 'With Country');
    const customerRow = ext.customerFacingProjects.find(p => p.projectName === 'With Country');
    assert.strictEqual(internalRow.country, 'Vietnam');
    assert.strictEqual(customerRow.country, 'Vietnam');
  });
  check('7. Executive Dashboard globalSupport reports byCustomer and byCountry as separate breakdowns', () => {
    const dash = post(fresh.context, 'getExecutiveDashboard', {}, token2);
    const byCustomer = {}; dash.globalSupport.byCustomer.forEach(c => byCustomer[c.customer] = c.count);
    const byCountry = {}; dash.globalSupport.byCountry.forEach(c => byCountry[c.country] = c.count);
    assert.strictEqual(byCustomer['Musashi'], 2);
    assert.strictEqual(byCountry['Vietnam'], 1);
    assert.strictEqual(byCountry['India'], 1);
  });
}

/* ================================================================
 *  PART 3 — PROJECT HEALTH CALIBRATION (one fixture per color)
 * ================================================================ */
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  console.log('\n=== PART 3: Project Health calibration (GREEN/YELLOW/ORANGE/RED/GRAY) ===');

  // GREEN — healthy, on-schedule, allocated (low, non-overloading Man-Day).
  const green = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Green Case', customer: 'C', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(400) }, token).project.id;
  const greenWbs = post(context, 'createWBS', { projectId: green, name: 'W', startDate: todayStr(), skill: 'Mechanical Design', progress: 10 }, token).wbs.id;
  post(context, 'saveResourceAllocation', { wbsId: greenWbs, engineer: 'Sukiyo', role: 'PIC', planManDay: 1 }, token);

  // YELLOW (WATCH) — no WBS at all, otherwise complete data, far target date.
  const yellow = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'Yellow Case (no WBS)', pic: 'Muharir', status: 'EXECUTION', targetDate: daysFromToday(400) }, token).project.id;

  // ORANGE (AT RISK) — progress behind schedule, isolated from every other flag.
  const orange = post(context, 'addProjectMaster', {
    type: 'INTERNAL', name: 'Orange Case (behind schedule)', pic: 'Fajar Sani', status: 'EXECUTION',
    intakeDate: daysFromToday(-200), targetDate: daysFromToday(200)
  }, token).project.id;
  const orangeWbs = post(context, 'createWBS', { projectId: orange, name: 'W', startDate: todayStr(), skill: 'Electrical / PLC', progress: 0 }, token).wbs.id;
  post(context, 'saveResourceAllocation', { wbsId: orangeWbs, engineer: 'Fajar Sani', role: 'PIC', planManDay: 1 }, token);

  // RED (CRITICAL) — overdue, not completed.
  const red = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Red Case (overdue)', customer: 'C', pic: 'Muharir', status: 'EXECUTION', targetDate: daysFromToday(-30) }, token).project.id;

  // GRAY — ON HOLD, otherwise unremarkable.
  const gray = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'Gray Case (on hold)', pic: 'Sukiyo', status: 'ON HOLD', targetDate: daysFromToday(400) }, token).project.id;
  const grayWbs = post(context, 'createWBS', { projectId: gray, name: 'W', startDate: todayStr(), skill: 'Mechanical Design', progress: 50 }, token).wbs.id;
  post(context, 'saveResourceAllocation', { wbsId: grayWbs, engineer: 'Sukiyo', role: 'PIC', planManDay: 1 }, token);

  const risks = post(context, 'getProjectRisks', {}, token).risks;
  function riskFor(id) { return risks.find(r => r.projectId === id); }

  check('GREEN: healthy allocated project, no reason needed', () => {
    const r = riskFor(green);
    assert.strictEqual(r.health, 'GREEN');
    assert.strictEqual(r.riskLevel, 'NORMAL');
    assert.strictEqual(r.primaryReasonKey, null);
    assert.strictEqual(r.primaryReason, null);
  });
  check('YELLOW (WATCH): missing WBS is the deterministic, documented reason', () => {
    const r = riskFor(yellow);
    assert.strictEqual(r.health, 'YELLOW');
    assert.strictEqual(r.riskLevel, 'WATCH');
    assert.strictEqual(r.primaryReasonKey, 'noWbs');
    assert.ok(r.primaryReason && r.primaryReason.length > 0);
  });
  check('ORANGE (AT RISK): progress behind schedule is the deterministic, documented reason', () => {
    const r = riskFor(orange);
    assert.strictEqual(r.health, 'ORANGE');
    assert.strictEqual(r.riskLevel, 'AT RISK');
    assert.strictEqual(r.primaryReasonKey, 'progressBehind');
    assert.ok(r.primaryReason.indexOf('Progress tertinggal') === 0);
  });
  check('RED (CRITICAL): overdue + not completed is the deterministic, documented reason (matches PROJECT_HEALTH_MODEL.md)', () => {
    const r = riskFor(red);
    assert.strictEqual(r.health, 'RED');
    assert.strictEqual(r.riskLevel, 'CRITICAL');
    assert.strictEqual(r.primaryReasonKey, 'overdue');
    assert.strictEqual(r.primaryReason, 'Target date terlewati, status belum COMPLETED');
  });
  check('GRAY: ON HOLD always renders GRAY regardless of the underlying cascade level, with a clear reason', () => {
    const r = riskFor(gray);
    assert.strictEqual(r.health, 'GRAY');
    assert.strictEqual(r.primaryReasonKey, 'onHold');
    assert.strictEqual(r.primaryReason, 'Project berstatus ON HOLD');
  });
  check('every non-NORMAL risk carries a non-empty primaryReason and primarySource (no color without a stated reason)', () => {
    risks.filter(r => r.riskLevel !== 'NORMAL').forEach(r => {
      assert.ok(r.primaryReason && r.primaryReason.length > 0, r.projectName + ' missing primaryReason');
      assert.ok(r.primarySource && r.primarySource.length > 0, r.projectName + ' missing primarySource');
    });
  });
  check('the system never claims AI/prediction anywhere in the risk output (deterministic rule engine only)', () => {
    const dump = JSON.stringify(risks).toLowerCase();
    assert.ok(dump.indexOf('ai') === -1 || !/\bai\b/.test(dump), 'no "AI" wording in risk output');
    assert.ok(dump.indexOf('predict') === -1, 'no "predict" wording in risk output');
  });
}

/* ================================================================
 *  PART 4 — RISK ENGINE AUDIT (one isolated test per rule + the
 *  primaryReasonKey mismatch regression + duplicate-record check)
 * ================================================================ */
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  console.log('\n=== PART 4: Risk Engine audit (per-rule isolation) ===');

  check('overdue logic: target date in the past, status not COMPLETED/CANCELLED', () => {
    const id = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Overdue', customer: 'C', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(-10) }, token).project.id;
    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.flags.overdue, true);
    assert.strictEqual(r.riskLevel, 'CRITICAL');
  });
  check('overdue logic does NOT fire once a project is COMPLETED (closed projects are exempt)', () => {
    const id = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Overdue Completed', customer: 'C', pic: 'Sukiyo', status: 'PO', targetDate: daysFromToday(-10) }, token).project.id;
    post(context, 'updateProjectMaster', { id, status: 'COMPLETED' }, token);
    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.flags.overdue, false);
    assert.strictEqual(r.riskLevel, 'NORMAL');
  });
  check('stale update logic: no update for longer than REPORTING_STALE_DAYS', () => {
    const id = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'Stale', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(400) }, token).project.id;
    const old = new Date(); old.setDate(old.getDate() - 20);
    setProjectMasterCell(mockGlobals, id, 'UpdatedAt', old.toISOString());
    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.flags.noRecentUpdate, true);
  });
  check('ON HOLD logic: forces health GRAY even though the level cascade still runs underneath', () => {
    const id = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'OnHold', pic: 'Sukiyo', status: 'ON HOLD', targetDate: daysFromToday(400) }, token).project.id;
    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.health, 'GRAY');
    assert.strictEqual(r.reasonKeys.indexOf('onHold') !== -1, true);
  });
  check('missing WBS logic', () => {
    const id = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'NoWbs', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(400) }, token).project.id;
    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.flags && r.reasonKeys.indexOf('noWbs') !== -1, true);
  });
  check('missing Man-Day logic: WBS has an allocation, but it totals zero Plan Man-Day (distinct from "no allocation at all")', () => {
    const id = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'ZeroMD', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(400) }, token).project.id;
    const wbsId = post(context, 'createWBS', { projectId: id, name: 'W', startDate: todayStr(), skill: 'Mechanical Design' }, token).wbs.id;
    post(context, 'saveResourceAllocation', { wbsId, engineer: 'Sukiyo', role: 'PIC', planManDay: 0 }, token);
    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.flags.missingManDay, true);
    assert.strictEqual(r.reasonKeys.indexOf('wbsWithoutAllocation') === -1, true, 'must not also fire wbsWithoutAllocation — it DOES have an allocation row');
    assert.strictEqual(r.riskLevel, 'WATCH');
  });
  check('engineer overload logic', () => {
    const id = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Overload', customer: 'C', pic: 'Iqbal Fauzan', status: 'EXECUTION', targetDate: daysFromToday(400) }, token).project.id;
    const wbsId = post(context, 'createWBS', { projectId: id, name: 'W', startDate: todayStr(), skill: 'Mechanical Design' }, token).wbs.id;
    post(context, 'saveResourceAllocation', { wbsId, engineer: 'Iqbal Fauzan', role: 'PIC', planManDay: 5 }, token);
    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.reasonKeys.indexOf('overloadedEngineer') !== -1, true);
    assert.strictEqual(r.riskLevel, 'AT RISK');
  });
  check('PO approaching target logic: status PO/EXECUTION within PROJECT_AT_RISK_DAYS but not yet critical', () => {
    const id = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'PoApproaching', customer: 'C', pic: 'Muhammad Zidan Arrizik', status: 'PO', targetDate: daysFromToday(10) }, token).project.id;
    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.reasonKeys.indexOf('poApproaching') !== -1, true);
    assert.strictEqual(r.riskLevel, 'AT RISK');
  });
  check('missing critical data logic: reachable via updateProjectMaster clearing PIC (creation itself requires PIC+TargetDate)', () => {
    const id = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'MissingCritical', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(400) }, token).project.id;
    post(context, 'updateProjectMaster', { id, pic: '' }, token);
    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.reasonKeys.indexOf('missingCriticalData') !== -1, true);
  });
  check('no duplicate identical risk records: exactly one risk object per project, ever', () => {
    const list = post(context, 'projectMasterList', {}, token).projects;
    const risks = post(context, 'getProjectRisks', {}, token).risks;
    assert.strictEqual(risks.length, list.length);
    const seen = {};
    risks.forEach(r => { assert.ok(!seen[r.projectId], 'duplicate risk for ' + r.projectId); seen[r.projectId] = true; });
    // calling it twice must be fully deterministic, not accumulating anything
    const risksAgain = post(context, 'getProjectRisks', {}, token).risks;
    assert.strictEqual(risksAgain.length, risks.length);
  });
  check('every risk record contains Project, Risk Level, Reason, Source, Target Date, Current Status', () => {
    const risks = post(context, 'getProjectRisks', {}, token).risks;
    risks.forEach(r => {
      assert.ok(r.projectId && r.projectName !== undefined, 'Project');
      assert.ok(r.riskLevel, 'Risk Level');
      assert.ok(Array.isArray(r.riskReasons), 'Reason');
      assert.ok('primarySource' in r, 'Source');
      assert.ok('targetDate' in r, 'Target Date');
      assert.ok('status' in r, 'Current Status');
    });
  });
  check('REGRESSION FIX: recommendedAction matches the reason that actually determined riskLevel, not just the first flag evaluated', () => {
    // A project that is BOTH noRecentUpdate (WATCH-tier, evaluated first in
    // source order) AND overloadedEngineer (the AT-RISK-tier flag that
    // actually wins the cascade). Before the fix, reasonKeys[0] would have
    // picked noRecentUpdate and shown the wrong recommended action.
    const id = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Mismatch', customer: 'C', pic: 'Wardiyono', status: 'EXECUTION', targetDate: daysFromToday(400) }, token).project.id;
    const wbsId = post(context, 'createWBS', { projectId: id, name: 'W', startDate: todayStr(), skill: 'Mechanical Design' }, token).wbs.id;
    post(context, 'saveResourceAllocation', { wbsId, engineer: 'Wardiyono', role: 'PIC', planManDay: 5 }, token);
    const old = new Date(); old.setDate(old.getDate() - 20);
    setProjectMasterCell(mockGlobals, id, 'UpdatedAt', old.toISOString());
    setWbsCell(mockGlobals, wbsId, 'UPDATED_AT', old.toISOString());

    const r = post(context, 'getProjectRisks', {}, token).risks.find(x => x.projectId === id);
    assert.strictEqual(r.riskLevel, 'AT RISK');
    assert.ok(r.reasonKeys.indexOf('noRecentUpdate') !== -1 && r.reasonKeys.indexOf('overloadedEngineer') !== -1, 'fixture must trigger both flags');
    assert.strictEqual(r.primaryReasonKey, 'overloadedEngineer', 'the AT-RISK-tier flag must win, not whichever was evaluated first');

    const attention = post(context, 'getProjectsNeedAttention', {}, token).projects.find(x => x.projectId === id);
    assert.strictEqual(attention.recommendedAction, 'Evaluasi ulang beban kerja engineer, pertimbangkan bantuan tambahan');
    assert.notStrictEqual(attention.recommendedAction, 'Minta update terbaru dari PIC', 'must not show the WATCH-tier action for an AT-RISK project');
  });
}

/* ================================================================
 *  PART 5 — MANAGEMENT MANPOWER BASELINE
 * ================================================================ */
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  console.log('\n=== PART 5: Management Manpower Baseline ===');

  check('dashboard distinguishes Current MP, System Required MP, System Indicative Additional MP, Management Baseline, and Management Target MP as five separate fields', () => {
    const dash = post(context, 'getExecutiveDashboard', { periodType: 'month' }, token);
    const m = dash.manpower;
    ['currentMp', 'requiredMp', 'additionalMp', 'managementBaselineMp', 'managementTargetMp'].forEach(f => {
      assert.ok(typeof m[f] === 'number', f + ' must be a number');
    });
    assert.strictEqual(m.managementTargetMp, m.currentMp + m.managementBaselineMp);
    assert.strictEqual(m.requiredMp, m.currentMp + m.additionalMp);
  });
  check('changing Config!MANAGEMENT_BASELINE_ADDITIONAL_MP changes ONLY the reference baseline (and target), never the system calculation', () => {
    const before = post(context, 'getExecutiveDashboard', { periodType: 'month' }, token).manpower;
    const before2 = post(context, 'getManpowerAnalysis', { periodType: 'month' }, token);
    const cfg = configRow(mockGlobals, 'MANAGEMENT_BASELINE_ADDITIONAL_MP');
    cfg.rows[cfg.idx][cfg.valIdx] = '20';
    const after = post(context, 'getExecutiveDashboard', { periodType: 'month' }, token).manpower;
    const after2 = post(context, 'getManpowerAnalysis', { periodType: 'month' }, token);

    assert.strictEqual(after.managementBaselineMp, 20);
    assert.strictEqual(after.managementTargetMp, after.currentMp + 20);
    // everything system-calculated must be untouched by the Config edit
    assert.strictEqual(after.currentMp, before.currentMp);
    assert.strictEqual(after.requiredMp, before.requiredMp);
    assert.strictEqual(after.additionalMp, before.additionalMp);
    assert.strictEqual(after2.indicativeAdditionalMPExact, before2.indicativeAdditionalMPExact);
    assert.strictEqual(after2.idealMP.exact, before2.idealMP.exact);
    assert.strictEqual(after2.currentMpTag, 'CALCULATED');
    assert.strictEqual(after2.managementBaselineTag, 'REFERENCE');
  });
  check('the +8 default is never hard-coded into production logic — it is read from Config every call', () => {
    const src = fs.readFileSync(path.join(PROD_DIR, 'WbsWorkload.gs'), 'utf-8');
    const m = src.match(/getConfigNum_\('MANAGEMENT_BASELINE_ADDITIONAL_MP',\s*(\d+)\)/);
    assert.ok(m, 'must read MANAGEMENT_BASELINE_ADDITIONAL_MP via getConfigNum_');
    assert.strictEqual(m[1], '8', 'the literal 8 here is only the fallback default, not the source of truth');
  });
}

/* ================================================================
 *  PART 6 — MANPOWER SCENARIO: SIMULATION-ONLY, ZERO MUTATION
 * ================================================================ */
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  console.log('\n=== PART 6: Manpower Scenario audit ===');

  check('CURRENT/+1/+2/+4/+8 scenarios never mutate Team, ORG_STRUCTURE, PROJECT_MASTER, or RESOURCE_ALLOCATION', () => {
    // Seed a bit of real data first so the sheets are non-trivial.
    post(context, 'createOrgNode', { name: 'Root Section', idealHeadcount: 5 }, token);
    const pid = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'Scn', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(100) }, token).project.id;
    const wbsId = post(context, 'createWBS', { projectId: pid, name: 'W', startDate: todayStr(), skill: 'Mechanical Design' }, token).wbs.id;
    post(context, 'saveResourceAllocation', { wbsId, engineer: 'Sukiyo', role: 'PIC', planManDay: 2 }, token);

    const watch = ['Team', 'ORG_STRUCTURE', 'PROJECT_MASTER', 'RESOURCE_ALLOCATION'];
    function snapshot() { const s = {}; watch.forEach(n => s[n] = JSON.stringify(mockGlobals.__SHEETS[n].rows)); return s; }
    const before = snapshot();
    const res = post(context, 'getManpowerScenario', { periodType: 'month' }, token);
    assert.strictEqual(res.scenarios.length, 5);
    const after = snapshot();
    watch.forEach(n => assert.strictEqual(after[n], before[n], n + ' must be byte-identical after a scenario simulation'));
  });
}

/* ================================================================
 *  PART 7 — WORKLOAD RECONCILIATION (Project + Irregular = Total)
 * ================================================================ */
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  console.log('\n=== PART 7: Workload reconciliation ===');

  function assertReconciles(periodType, periodKey) {
    const w = post(context, 'getWorkloadSummary', periodKey ? { periodType, periodKey } : { periodType }, token);
    const sum = round2(w.byType.EXTERNAL.plannedMD + w.byType.INTERNAL.plannedMD + w.byType.IRREGULAR.plannedMD);
    assert.strictEqual(round2(w.totalPlannedMD), sum, 'PROJECT (External+Internal) + IRREGULAR must equal TOTAL for ' + periodType + '/' + periodKey);
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  check('normal small dataset: one external allocation + one irregular job, same week', () => {
    const pid = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Recon1', customer: 'C', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(100) }, token).project.id;
    const wbsId = post(context, 'createWBS', { projectId: pid, name: 'W', startDate: todayStr(), skill: 'Mechanical Design' }, token).wbs.id;
    post(context, 'saveResourceAllocation', { wbsId, engineer: 'Sukiyo', role: 'PIC', planManDay: 2 }, token);
    post(context, 'saveSupportJob', { date: todayStr(), type: 'Capacity Up', line: 'L1', pic: 'Wardiyono', manDay: 1, desc: 'irregular' }, token);
    assertReconciles('week');
    assertReconciles('month');
  });

  check('multi-project dataset: several external + internal projects with allocations do not double-count or drop MD', () => {
    for (let i = 0; i < 5; i++) {
      const pid = post(context, 'addProjectMaster', { type: i % 2 === 0 ? 'EXTERNAL' : 'INTERNAL', name: 'ReconMulti' + i, customer: 'C', pic: 'Muharir', status: 'EXECUTION', targetDate: daysFromToday(100) }, token).project.id;
      const wbsId = post(context, 'createWBS', { projectId: pid, name: 'W' + i, startDate: todayStr(), skill: 'Mechanical Design' }, token).wbs.id;
      post(context, 'saveResourceAllocation', { wbsId, engineer: 'Muharir', role: 'PIC', planManDay: 1 }, token);
    }
    assertReconciles('week');
    assertReconciles('month');
  });

  check('same engineer allocated to two different WBS rows in the same period: both are summed (no double counting, no dropping)', () => {
    const pid = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'ReconDoubleAlloc', pic: 'Eko Nurcahyanto', status: 'EXECUTION', targetDate: daysFromToday(100) }, token).project.id;
    const wbsA = post(context, 'createWBS', { projectId: pid, name: 'A', startDate: todayStr(), skill: 'Mechanical Design' }, token).wbs.id;
    const wbsB = post(context, 'createWBS', { projectId: pid, name: 'B', startDate: todayStr(), skill: 'Mechanical Design' }, token).wbs.id;
    const before = post(context, 'getWorkloadSummary', { periodType: 'week' }, token).totalPlannedMD;
    post(context, 'saveResourceAllocation', { wbsId: wbsA, engineer: 'Eko Nurcahyanto', role: 'PIC', planManDay: 2 }, token);
    post(context, 'saveResourceAllocation', { wbsId: wbsB, engineer: 'Eko Nurcahyanto', role: 'PIC', planManDay: 3 }, token);
    const after = post(context, 'getWorkloadSummary', { periodType: 'week' }, token).totalPlannedMD;
    assert.strictEqual(round2(after - before), 5, 'both allocations (2 + 3) must be counted, exactly once each');
    assertReconciles('week');
  });

  check('multi-week dataset: an activity distributed across multiple weeks still reconciles in each week and in the month', () => {
    const pid = post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'ReconMultiWeek', customer: 'C', pic: 'Chilvi Octafia Rizki', status: 'EXECUTION', targetDate: daysFromToday(100) }, token).project.id;
    const start = todayStr();
    const end = daysFromToday(20); // spans multiple ISO weeks
    const wbsId = post(context, 'createWBS', { projectId: pid, name: 'MultiWeek', startDate: start, targetDate: end, skill: 'Mechanical Design' }, token).wbs.id;
    post(context, 'saveResourceAllocation', { wbsId, engineer: 'Chilvi Octafia Rizki', role: 'PIC', planManDay: 10 }, token);
    assertReconciles('week'); // current week only sees its own slice
    assertReconciles('month');
  });
}

/* ================================================================
 *  PART 8 — CUSTOMER DATA CONTRACT (CUSTOMER_VIEW vs PSP_INTERNAL_VIEW)
 * ================================================================ */
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  console.log('\n=== PART 8: External customer data sanitization ===');

  post(context, 'addProjectMaster', { type: 'EXTERNAL', name: 'Contract Test', customer: 'C', country: 'Vietnam', plant: 'P', pic: 'Sukiyo', status: 'PO', targetDate: daysFromToday(100) }, token);
  const ext = post(context, 'getExternalWeeklyReport', {}, token);

  const CUSTOMER_VIEW_FIELDS = ['customer', 'country', 'plant', 'projectNo', 'projectName', 'pic', 'status', 'overallProgress', 'currentActivity', 'plannedThisWeek', 'actualThisWeek', 'problem', 'nextAction', 'targetDate', 'scheduleStatus', 'remarks'].sort();
  const INTERNAL_ONLY_FIELDS = ['projectId', 'manDayPlanned', 'manDayActual', 'riskLevel'];

  check('CUSTOMER_VIEW contains exactly the documented allowed fields — no more, no less (CUSTOMER_REPORT_DATA_CONTRACT.md)', () => {
    ext.customerFacingProjects.forEach(row => {
      assert.deepStrictEqual(Object.keys(row).sort(), CUSTOMER_VIEW_FIELDS);
    });
  });
  check('PSP_INTERNAL_VIEW contains every CUSTOMER_VIEW field PLUS the internal-only fields', () => {
    ext.projects.forEach(row => {
      CUSTOMER_VIEW_FIELDS.forEach(f => assert.ok(f in row, 'internal view missing ' + f));
      INTERNAL_ONLY_FIELDS.forEach(f => assert.ok(f in row, 'internal view missing internal-only field ' + f));
    });
  });
  check('none of the internal-only fields ever leak into CUSTOMER_VIEW', () => {
    ext.customerFacingProjects.forEach(row => {
      INTERNAL_ONLY_FIELDS.forEach(f => assert.ok(!(f in row), f + ' must never appear in the customer view'));
    });
  });
}

/* ================================================================
 *  PART 9 — REPORTING PERIOD EDGE CASES
 * ================================================================ */
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  console.log('\n=== PART 9: Reporting period edge cases ===');

  check('Monday-Sunday week: every parsed period starts on a Monday and spans exactly 7 days', () => {
    ['2026-W01', '2026-W20', '2026-W52'].forEach(wk => {
      const p = context.parseReportingPeriod_({ week: wk });
      assert.strictEqual(p.startDate.getDay(), 1, wk + ' must start on Monday');
      assert.strictEqual(Math.floor((p.endDate - p.startDate) / 86400000), 6, wk + ' must span 6 full days after Monday (7 days inclusive)');
    });
  });

  check('year crossing: an ISO week 1 whose Monday falls in December of the PREVIOUS year is handled correctly', () => {
    // Find a year where Jan 4 is a Saturday or Sunday — ISO week 1's Monday
    // then necessarily falls in December of the previous year. Computed
    // here, not hand-picked, so this test does not depend on today's date.
    let targetYear = null;
    for (let y = 2015; y <= 2035; y++) {
      const wd = new Date(y, 0, 4).getDay();
      if (wd === 0 || wd === 6) { targetYear = y; break; }
    }
    assert.ok(targetYear, 'test setup: could not find a year with a Dec-crossing ISO week 1 in range');
    const monday = context.isoWeekToMonday_(targetYear + '-W01');
    assert.ok(monday < targetYear + '-01-01', 'ISO week 1 Monday (' + monday + ') must fall before Jan 1 of ' + targetYear);
    assert.ok(monday.slice(0, 4) === String(targetYear - 1), 'must land in December of the previous year');
  });

  check('month crossing: DailyLogs on both sides of a month boundary are correctly filtered and the LATEST one (by date, not insertion order) is picked', () => {
    post(context, 'migrateLegacyProjects', {}, token);
    // 2026-PSP-001 has a real seeded legacy DailyLogs entry; add two more,
    // deliberately inserted out of chronological order, straddling a month
    // boundary, to prove latestLogInPeriod_ sorts by date rather than trusting insertion order.
    const rows = mockGlobals.__SHEETS.DailyLogs.rows;
    const headers = rows[0];
    const legacyProjectIdOf001 = mockGlobals.__SHEETS.PROJECT_MASTER.rows.find(r => r[mockGlobals.__SHEETS.PROJECT_MASTER.rows[0].indexOf('No')] === '2026-PSP-001')
      ? null : null; // computed properly below via API instead of raw index guessing
    const pm = post(context, 'projectMasterList', {}, token).projects.find(p => p.no === '2026-PSP-001');
    // Insert the LATER date first, then the EARLIER date, to prove sorting (not insertion order) decides "latest".
    rows.push(['l_late', pm ? undefined : undefined, '2026-PSP-001', '2026-02-03', 'Wardiyono', 5, 'Plan Feb 3 (later, inserted FIRST)', 'Actual Feb 3', '-', 'Next Feb 3', new Date().toISOString()]);
    rows.push(['l_early', undefined, '2026-PSP-001', '2026-01-28', 'Wardiyono', 5, 'Plan Jan 28 (earlier, inserted SECOND)', 'Actual Jan 28', '-', 'Next Jan 28', new Date().toISOString()]);
    // Fix the ProjectID column (index 1) to the real legacy id looked up from the sheet directly.
    const legacyRows = mockGlobals.__SHEETS.Projects.rows;
    const legacyIdIdx = legacyRows[0].indexOf('ID'), legacyNoIdx = legacyRows[0].indexOf('No');
    const legacyId = legacyRows.find(r => r[legacyNoIdx] === '2026-PSP-001')[legacyIdIdx];
    const pidColIdx = headers.indexOf('ProjectID');
    rows[rows.length - 2][pidColIdx] = legacyId;
    rows[rows.length - 1][pidColIdx] = legacyId;

    const report = post(context, 'getInternalWeeklyReport', { startDate: '2026-01-28', endDate: '2026-02-03' }, token);
    const row = report.projects.find(p => p.projectNo === '2026-PSP-001');
    assert.ok(row, 'migrated project 2026-PSP-001 must be present');
    assert.strictEqual(row.plannedThisWeek, 'Plan Feb 3 (later, inserted FIRST)', 'must pick the chronologically later log, regardless of insertion order');
  });

  check('current week vs previous week return different, non-overlapping ranges', () => {
    const current = context.parseReportingPeriod_({});
    const prevMonday = new Date(current.startDate); prevMonday.setDate(prevMonday.getDate() - 7);
    const prevWeekStr = prevMonday.toISOString().slice(0, 10);
    const previous = context.parseReportingPeriod_({ startDate: prevWeekStr, endDate: new Date(current.startDate.getTime() - 86400000).toISOString().slice(0, 10) });
    assert.ok(previous.endDate < current.startDate, 'previous week must end before current week starts');
  });

  check('a project with NO activity during the selected week still appears in the report, just with empty weekly-detail fields', () => {
    const pid = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'NoActivityThisWeek', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(100) }, token).project.id;
    const before = post(context, 'getInternalWeeklyReport', {}, token).projects.length;
    const row = post(context, 'getInternalWeeklyReport', {}, token).projects.find(p => p.projectId === pid);
    assert.ok(row, 'project must still be listed');
    assert.strictEqual(row.plannedThisWeek, '');
    assert.strictEqual(row.actualThisWeek, '');
    const after = post(context, 'getInternalWeeklyReport', { startDate: '2000-01-01', endDate: '2000-01-02' }, token).projects.length;
    assert.strictEqual(after, before + 0, 'project count must not change just because the period changed');
  });
}

/* ================================================================
 *  PART 10 — DATA QUALITY INTEGRATION ON THE DASHBOARD
 * ================================================================ */
{
  const { mockGlobals, context } = freshContext();
  context.setupSpreadsheet();
  const token = post(context, 'login', { name: 'Sukiyo', pin: 'psp2026' }).token;

  console.log('\n=== PART 10: Data Quality integration ===');

  check('a clean dataset reports DATA QUALITY OK with zero issues', () => {
    const dash = post(context, 'getExecutiveDashboard', {}, token);
    assert.strictEqual(dash.dataQuality.status, 'OK');
    assert.strictEqual(dash.dataQuality.totalIssues, 0);
  });
  check('introducing a real data-quality issue flips the dashboard to WARNING, with the exact same count getDataQualityReport itself reports (single source of truth, nothing recomputed)', () => {
    // No PIC on a WBS row is a real, existing MISSING_PIC WARNING check.
    const pid = post(context, 'addProjectMaster', { type: 'INTERNAL', name: 'DQ', pic: 'Sukiyo', status: 'EXECUTION', targetDate: daysFromToday(100) }, token).project.id;
    post(context, 'createWBS', { projectId: pid, name: 'NoPicHere', startDate: todayStr(), skill: 'Mechanical Design' }, token);
    const direct = post(context, 'getDataQualityReport', {}, token);
    const dash = post(context, 'getExecutiveDashboard', {}, token);
    assert.ok(direct.totalIssues > 0);
    assert.strictEqual(dash.dataQuality.status, 'WARNING');
    assert.strictEqual(dash.dataQuality.totalIssues, direct.totalIssues);
    assert.deepStrictEqual(dash.dataQuality.bySeverity, direct.bySeverity);
  });
  check('checking data quality from the dashboard does not modify any source data (read-only, as always)', () => {
    const watch = ['WBS', 'PROJECT_MASTER', 'RESOURCE_ALLOCATION', 'ORG_STRUCTURE'];
    const before = {}; watch.forEach(n => before[n] = JSON.stringify(mockGlobals.__SHEETS[n].rows));
    post(context, 'getExecutiveDashboard', {}, token);
    watch.forEach(n => assert.strictEqual(JSON.stringify(mockGlobals.__SHEETS[n].rows), before[n], n + ' must be unchanged'));
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
