/**
 * Utils.gs — shared helpers used across every service.
 */

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function nextId_(prefix) {
  return prefix + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function nowIso_() {
  return new Date().toISOString();
}

function fiscalYearOf_(dateLike) {
  const d = dateLike ? new Date(dateLike) : new Date();
  return d.getFullYear();
}

function toNumber_(v, fallback) {
  const n = Number(v);
  return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}
