# Audit Report

Super Admin menu: `/audit-report`. The table shows all authorized records in one continuous page, without page controls or a 50-record display limit. Primary Super Admin can read all records; other Super Admin accounts can read only records assigned to their scope. Admin, Company and Supervisor accounts cannot access the report or export API.

## Evidence

* Database triggers capture insert/update/delete changes on the twenty business tables, in the same transaction as the change. Each record includes redacted before/after snapshots, changed field names, entity identity, captured building/company/owner scope and transaction ID. Routine heartbeat timestamp changes are suppressed.
* Management API wrappers append Started and completion records, including the signed-in account, role, request ID, endpoint, method, HTTP outcome and reported client IP/user agent. No body, query string, credential or response body is retained. A request interrupted after Started remains visible as incomplete.
* These are separate evidence streams: a database change without an independently recorded actor is labelled System / device. Do not infer that a nearby account action performed a particular database change. Historical actors and before values are not invented.
* Retained RFID history is imported once with source Historical import. Its original scan time and the time it was imported are separate. Newly captured scans retain their original ID, card, action, reader and result. Online/offline is derived from the stored event source, not current device status.
* Report Excel/PDF export requests and Audit CSV downloads are recorded. Downloads are capped at 10,000 records per export; narrow filters for larger histories.

## Integrity and deployment

`prisma/add-audit-report.sql` is additive and repeatable. It is included in the existing deployment build after schema provisioning. Never use `npm run build` merely for local compilation because that script performs database changes; use the Next CLI directly.

Audit rows have no entity foreign keys and are not cascaded away. A database trigger rejects UPDATE, DELETE and TRUNCATE on audit_records, including empty statements. There are no application edit/delete endpoints or controls. Password/token/secret/QR payload fields are recursively redacted. Application mutation intent is persisted before executing its handler; database capture failures roll back the corresponding database operation.

This protects records against application operations, not a database owner who can alter schema or disable triggers. Protection against a privileged database operator requires separately administered immutable storage/backups. No external immutable archive is configured here.

## Checks

* `node --test tests/audit-report.test.cjs`: rollback-only database fixtures verify redaction, atomic before/after, deletion evidence, trigger coverage and update/delete/truncate rejection.
* `node tests/audit-report.browser.cjs`: requires localhost:3000; checks authentication, role/scope restrictions, real rows, navigation, dialog/Escape, search, audited CSV download and mobile layout. It does not alter parking data.
