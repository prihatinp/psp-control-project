/**
 * mock-gas-v2.js — Apps Script runtime mock for the REAL production
 * Code.gs + Phase 2's ProjectMaster.gs. Extends the Phase 1 mock with
 * what the real code actually uses and the old scaffold never touched:
 * CacheService, LockService, Session, Utilities.formatDate.
 *
 * Known simplifications (documented, not hidden):
 *  - CacheService here has no real TTL expiry (values persist for the
 *    life of the test process) — fine for testing threshold-crossing
 *    behavior, not for testing real 60-second reset timing.
 *  - LockService.getScriptLock() is a no-op wrapped with call counters
 *    so tests can assert waitLock/releaseLock were called — it does not
 *    provide real mutual exclusion, since these tests run single-threaded.
 *  - Utilities.formatDate only supports the 'yyyy-MM-dd' pattern, the
 *    only one the real code ever uses.
 */
const crypto = require('crypto');

function createMockGasContext(scriptProps) {
  const SHEETS = {};
  const CACHE = {};
  let lockWaitCount = 0, lockReleaseCount = 0;

  function sheetObj(name) {
    return {
      appendRow(row) { SHEETS[name].rows.push(row.slice()); },
      getLastRow() { return SHEETS[name].rows.length; },
      getLastColumn() { return SHEETS[name].rows.length ? SHEETS[name].rows[0].length : 0; },
      setFrozenRows() {},
      getRange(row, col, numRows, numCols) {
        numRows = numRows || 1; numCols = numCols || 1;
        return {
          getValues() {
            const out = [];
            for (let r = 0; r < numRows; r++) {
              const src = SHEETS[name].rows[row - 1 + r] || [];
              out.push(src.slice(col - 1, col - 1 + numCols));
            }
            return out;
          },
          setValue(v) {
            const idx = row - 1;
            if (!SHEETS[name].rows[idx]) SHEETS[name].rows[idx] = [];
            SHEETS[name].rows[idx][col - 1] = v;
          },
          setValues(vals) {
            for (let r = 0; r < vals.length; r++) {
              const idx = row - 1 + r;
              if (!SHEETS[name].rows[idx]) SHEETS[name].rows[idx] = [];
              for (let c = 0; c < vals[r].length; c++) SHEETS[name].rows[idx][col - 1 + c] = vals[r][c];
            }
          }
        };
      },
      getDataRange() {
        return { getValues: () => SHEETS[name].rows.map(r => r.slice()) };
      }
    };
  }

  const ss = {
    getSheetByName(name) { return SHEETS[name] ? sheetObj(name) : null; },
    insertSheet(name) { SHEETS[name] = { rows: [] }; return sheetObj(name); },
    rename() {},
    getSheets() { return Object.keys(SHEETS).map(sheetObj); },
    deleteSheet() {},
    getUrl() { return 'https://mock.sheet.url/'; },
    getId() { return 'mock-ss-id'; }
  };

  function pad2(n) { return String(n).padStart(2, '0'); }

  return {
    __SHEETS: SHEETS,
    __CACHE: CACHE,
    __lockStats: () => ({ waitCount: lockWaitCount, releaseCount: lockReleaseCount }),
    SpreadsheetApp: { openById: () => ss, create: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (scriptProps[k] !== undefined ? scriptProps[k] : null), setProperty: (k, v) => { scriptProps[k] = v; } }) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
    Logger: { log: (...args) => console.log('[GAS Logger]', ...args) },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(s) { return { _content: s, setMimeType() { return this; }, getContent() { return this._content; } }; }
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (CACHE[k] !== undefined ? CACHE[k] : null),
        put: (k, v) => { CACHE[k] = v; },
        remove: (k) => { delete CACHE[k]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { lockWaitCount++; },
        releaseLock: () => { lockReleaseCount++; }
      })
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe(input) {
        const buf = Array.isArray(input) ? Buffer.from(input.map(b => (b < 0 ? b + 256 : b))) : Buffer.from(String(input), 'utf-8');
        return buf.toString('base64url');
      },
      base64DecodeWebSafe(str) { return Array.from(Buffer.from(str, 'base64url')); },
      newBlob(bytes) { return { getDataAsString: () => Buffer.from(bytes).toString('utf-8') }; },
      computeHmacSha256Signature(input, key) {
        const digest = crypto.createHmac('sha256', key).update(input).digest();
        return Array.from(digest).map(b => (b > 127 ? b - 256 : b));
      },
      formatDate(date, tz, fmt) {
        if (fmt !== 'yyyy-MM-dd') throw new Error('mock Utilities.formatDate only supports yyyy-MM-dd, got: ' + fmt);
        return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
      }
    }
  };
}

module.exports = { createMockGasContext };
