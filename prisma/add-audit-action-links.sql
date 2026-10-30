CREATE INDEX IF NOT EXISTS audit_records_entity ON audit_records ("entityType","entityId");
CREATE INDEX IF NOT EXISTS audit_records_request ON audit_records ((details->>'requestId')) WHERE source='Application';
