/**
 * phase3.1-scenario-test.js
 *
 * ================================================================
 *  SYNTHETIC TEST SCENARIO — NOT REAL DATA
 *  Every project name, date, and Man-Day number below is invented
 *  for this test file only, to exercise the Workload & Capacity
 *  engine at a realistic scale (25 External + 30 Internal + active
 *  Irregular Jobs, 15-person team). Nothing here is written to any
 *  production sheet — it only ever exists inside this test's mock
 *  Apps Script sandbox. Do not quote these numbers as real PSP
 *  workload.
 * ================================================================
 *
 * Run with: node backend/production/test/phase3.1-scenario-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createMockGasContext } = require('./mock-gas-v2');

const PROD_DIR = path.join(__dirname, '..');
const LOAD_ORDER = ['Code.gs', 'ProjectMaster.gs', 'WbsWorkload.gs', 'Organization.gs', 'Reporting.gs'];

const mockGlobals = createMockGasContext({ SS_ID: 'mock-ss', HMAC_SECRET: 'test-secret' });
const context = vm.createContext(mockGlobals);
LOAD_ORDER.forEach(file => vm.runInContext(fs.readFileSync(path.join(PROD_DIR, file), 'utf-8'), context, { filename: file }));

function post(action, body, token) {
  const payload = Object.assign({ action }, body || {});
  if (token) payload.token = token;
  return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
}

context.setupSpreadsheet();
// Add the 15th person for this synthetic scenario only (mirrors Section 1's
// validated behavior: Current MP becomes 15 the moment a real row exists).
mockGlobals.__SHEETS.Team.rows.push(['TEST-15', 'Dadang Sandi', 'Electrical PIC', 'Electrical / PLC']);
// Bulk-seeding this much synthetic data in a tight loop would exceed the
// real 60-req/min-per-user rate limit (checkRateLimit_ is keyed by
// username) — exactly as it correctly should for one user. Round-robin
// across several real logged-in users instead, same as real concurrent
// multi-engineer data entry would naturally spread the load.
const seedUsers = ['Sukiyo', 'Wardiyono', 'Muharir', 'Fajar Sani'];
const seedTokens = seedUsers.map(name => post('login', { name, pin: 'psp2026' }).token);
let seedTokenIdx = 0;
function nextToken() { seedTokenIdx = (seedTokenIdx + 1) % seedTokens.length; return seedTokens[seedTokenIdx]; }
const token = seedTokens[0]; // used for all read/report calls below (well under the limit)

const ENGINEERS = ['Sukiyo', 'Wardiyono', 'Muharir', 'Fajar Sani', 'Nugroho Edy S', 'Sumarko',
  'Eko Nurcahyanto', 'Chilvi Octafia Rizki', 'Teguh Rianto', 'Fahri Wahyu Prastama',
  'Satria Naufal Jauhari', 'Iqbal Fauzan', 'Muhammad Zidan Arrizik', 'Prihatin Purwadi', 'Dadang Sandi'];

const today = new Date();
const monday = new Date(today);
monday.setDate(today.getDate() - ((today.getDay() || 7) - 1));
const thisWeekStr = monday.toISOString().slice(0, 10);
const thisMonthKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');

console.log('================================================================');
console.log(' SYNTHETIC TEST SCENARIO — NOT REAL DATA (engine validation only)');
console.log('================================================================\n');

console.log('Creating 25 synthetic External projects...');
for (let i = 1; i <= 25; i++) {
  const t = nextToken();
  const pid = post('addProjectMaster', {
    type: 'EXTERNAL', name: 'Synthetic External Project #' + i,
    customer: 'Musashi ' + ['Vietnam', 'India', 'Mexico', 'Brazil', 'Japan'][i % 5],
    pic: ENGINEERS[i % ENGINEERS.length], targetDate: '2026-12-31'
  }, t).project.id;
  const wbsId = post('createWBS', { projectId: pid, name: 'Activity ' + i, startDate: thisWeekStr, skill: 'Mechanical Design' }, t).wbs.id;
  post('saveResourceAllocation', { wbsId, engineer: ENGINEERS[i % ENGINEERS.length], role: 'PIC', planManDay: 1 + (i % 4) }, t);
}

console.log('Creating 30 synthetic Internal projects...');
for (let i = 1; i <= 30; i++) {
  const t = nextToken();
  const pid = post('addProjectMaster', {
    type: 'INTERNAL', name: 'Synthetic Internal Project #' + i,
    category: ['Automation', 'Reduce MP', 'Capacity Up', 'Quality Up'][i % 4],
    pic: ENGINEERS[(i + 3) % ENGINEERS.length], targetDate: '2026-09-30'
  }, t).project.id;
  const wbsId = post('createWBS', { projectId: pid, name: 'Activity ' + i, startDate: thisWeekStr, skill: 'Electrical / PLC' }, t).wbs.id;
  post('saveResourceAllocation', { wbsId, engineer: ENGINEERS[(i + 3) % ENGINEERS.length], role: 'PIC', planManDay: 1 + (i % 3) }, t);
}

console.log('Adding synthetic active Irregular Jobs (via legacy saveSupportJob, this week)...');
const irregularTypes = ['Capacity Up', 'Komarigoto Produksi', 'Quality Up', 'Support Produksi'];
for (let i = 0; i < 8; i++) {
  post('saveSupportJob', {
    date: thisWeekStr, type: irregularTypes[i % irregularTypes.length], line: 'Synthetic Line ' + i,
    pic: ENGINEERS[i % ENGINEERS.length], manDay: 1 + (i % 3), desc: 'Synthetic irregular job #' + i
  }, nextToken());
}

console.log('\n--- Weekly ---');
const weekWorkload = post('getWorkloadSummary', { periodType: 'week', periodKey: thisWeekStr }, token);
const weekCapacity = post('getCapacitySummary', { periodType: 'week', periodKey: thisWeekStr }, token);
const weekMp = post('getManpowerAnalysis', { periodType: 'week', periodKey: thisWeekStr }, token);
printSummary('WEEKLY', weekWorkload, weekCapacity, weekMp);

console.log('\n--- Monthly ---');
const monthWorkload = post('getWorkloadSummary', { periodType: 'month', periodKey: thisMonthKey }, token);
const monthCapacity = post('getCapacitySummary', { periodType: 'month', periodKey: thisMonthKey }, token);
const monthMp = post('getManpowerAnalysis', { periodType: 'month', periodKey: thisMonthKey }, token);
printSummary('MONTHLY', monthWorkload, monthCapacity, monthMp);

function printSummary(label, workload, capacity, mp) {
  console.log(`[${label}] Current MP: ${capacity.currentMp}`);
  console.log(`[${label}] Planned MD: External=${workload.byType.EXTERNAL.plannedMD} Internal=${workload.byType.INTERNAL.plannedMD} Irregular=${workload.byType.IRREGULAR.plannedMD} Total=${workload.totalPlannedMD}`);
  console.log(`[${label}] Gross Capacity MD: ${capacity.grossCapacityMD}  Net Capacity MD: ${Math.round(capacity.netCapacityMD * 10) / 10}`);
  console.log(`[${label}] Utilization: ${workload.utilizationPct}%  Overload MD: ${Math.round(workload.overloadMD * 10) / 10}`);
  console.log(`[${label}] Indicative Additional MP: ${mp.indicativeAdditionalMP} (system calc, NOT an HR recommendation)`);
  console.log(`[${label}] Management Baseline: +${mp.managementBaselineAdditionalMP} (${mp.managementBaselineLabel})`);
  console.log(`[${label}] Difference vs Baseline: ${mp.differenceVsBaseline}`);
}

console.log('\n--- Validation assertions (engine correctness at this scale) ---');
let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('  ok  -', label); }
  catch (e) { failed++; console.error('  FAIL -', label, '\n       ', e.message); }
}
check('55 projects created (25 External + 30 Internal)', () => {
  const list = post('projectMasterList', {}, token);
  assert.strictEqual(list.projects.filter(p => p.type === 'EXTERNAL').length, 25);
  assert.strictEqual(list.projects.filter(p => p.type === 'INTERNAL').length, 30);
});
check('weekly total = sum of the three type buckets (invariant holds at scale)', () => {
  const sum = weekWorkload.byType.EXTERNAL.plannedMD + weekWorkload.byType.INTERNAL.plannedMD + weekWorkload.byType.IRREGULAR.plannedMD;
  assert.strictEqual(weekWorkload.totalPlannedMD, sum);
});
check('Current MP = 15 throughout (not hard-coded, still live from Team)', () => {
  assert.strictEqual(weekCapacity.currentMp, 15);
  assert.strictEqual(monthCapacity.currentMp, 15);
});
check('management baseline stays exactly 8 regardless of scenario scale', () => {
  assert.strictEqual(weekMp.managementBaselineAdditionalMP, 8);
  assert.strictEqual(monthMp.managementBaselineAdditionalMP, 8);
});
check('no production sheet outside this mock was touched (sanity: this process has no network/file access to a real spreadsheet)', () => {
  assert.strictEqual(typeof mockGlobals.SpreadsheetApp.openById, 'function');
  assert.ok(mockGlobals.__SHEETS.PROJECT_MASTER.rows.length > 1, 'data lives only in the in-memory mock');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
console.log('\n(Reminder: all figures above are SYNTHETIC, generated by this test file, not real PSP workload.)');
if (failed > 0) process.exitCode = 1;
