-- Retries must not duplicate a click; immutable historical records are unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS audit_records_interface_event ON audit_records (source,"entityType","entityId") WHERE source='Interface';
