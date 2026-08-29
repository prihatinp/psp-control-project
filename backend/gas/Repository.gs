/**
 * Repository.gs — single generic data-access layer over Google Sheets.
 * Every service (existing-compat and new) reads/writes through these
 * functions so schema/column layout has exactly one place to change.
 */

function ss_() {
  return SpreadsheetApp.openById(getScriptProp_('SHEET_ID'));
}

function getSheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: "' + name + '". Run setupSchema() or verify the name in Phase 1A recovery.');
  return sh;
}

/** Idempotent: creates the sheet with a header row only if it does not already exist. Never touches an existing sheet. */
function getOrCreateSheet_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_(name) {
  const sh = getSheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

function appendRow_(name, obj) {
  const sh = getSheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ''));
  sh.appendRow(row);
  return obj;
}

/** Updates the first row whose idField matches idValue with the fields present in patch. Returns the merged row. */
function updateById_(name, idField, idValue, patch) {
  const sh = getSheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf(idField);
  if (idCol === -1) throw new Error('ID field "' + idField + '" not found in sheet "' + name + '"');
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(idValue)) {
      const merged = {};
      headers.forEach((h, c) => {
        const val = patch[h] !== undefined ? patch[h] : values[r][c];
        merged[h] = val;
        sh.getRange(r + 1, c + 1).setValue(val);
      });
      return merged;
    }
  }
  throw new Error('Row not found: ' + idField + '=' + idValue + ' in "' + name + '"');
}

function findOne_(name, predicate) {
  return readAll_(name).find(predicate) || null;
}

function findAll_(name, predicate) {
  const all = readAll_(name);
  return predicate ? all.filter(predicate) : all;
}
