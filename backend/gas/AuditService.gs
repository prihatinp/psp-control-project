/**
 * AuditService.gs — AUDIT_LOG is a core foundation entity (locked decision
 * #16). Every mutation in every other service calls logAudit_ so there is
 * one durable trail of who changed what, independent of business logic.
 */
function logAudit_(actor, action, entityType, entityId, details) {
  appendRow_('AUDIT_LOG', {
    audit_id: nextId_('AUD'),
    timestamp: nowIso_(),
    actor: actor || 'unknown',
    action: action,
    entity_type: entityType,
    entity_id: entityId,
    details: typeof details === 'string' ? details : JSON.stringify(details || {})
  });
}

function listAuditLog_(limit) {
  const rows = readAll_('AUDIT_LOG');
  rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return limit ? rows.slice(0, limit) : rows;
}
