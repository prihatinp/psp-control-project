/**
 * mock-gas.js — minimal in-memory fakes for the handful of Apps Script
 * globals backend/gas/*.gs relies on (SpreadsheetApp, PropertiesService,
 * Utilities, ContentService, Logger). Good enough to smoke-test the pure
 * logic locally; it is NOT a substitute for running the real code inside
 * an actual Apps Script project against a real Sheet before deployment.
 *
 * Modeled directly on real Sheets semantics: a sheet is just rows of
 * cells — row 0 becomes the "header" row only because Repository.gs
 * writes it there with appendRow(headers); there is no separate
 * headers/rows split (an earlier version of this mock had one and it
 * silently broke every row written after a fresh getOrCreateSheet_ call).
 */
const crypto = require('crypto');

function createMockGasContext(scriptProps) {
  const SHEETS = {};

  function sheetObj(name) {
    return {
      appendRow(row) { SHEETS[name].rows.push(row.slice()); },
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
    insertSheet(name) { SHEETS[name] = { rows: [] }; return sheetObj(name); }
  };

  return {
    __SHEETS: SHEETS,
    SpreadsheetApp: { openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (scriptProps[k] !== undefined ? scriptProps[k] : null) }) },
    Logger: { log: (...args) => console.log('[GAS Logger]', ...args) },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(s) { return { _content: s, setMimeType() { return this; }, getContent() { return this._content; } }; }
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
      }
    }
  };
}

module.exports = { createMockGasContext };
