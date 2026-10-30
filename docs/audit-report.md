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

## Summary-only display
The report and CSV return summary fields only. The Details column and popup are removed. Before/after snapshots remain in append-only storage but are not included in report API responses or CSV downloads.

## Interaction records
Started intents remain in immutable storage but are excluded from the report and CSV. Authenticated interface clicks are recorded separately as Interface activity, with predefined action labels, account, role, scoped building and a normalized page. Menu/button activations, checkbox/radio clicks, input focus clicks and select changes are supported. Typed values, arbitrary DOM labels, target URLs/query strings, personal entity IDs and passwords are never sent by the tracker. Login outcomes remain covered by login auditing. Click records describe client-reported interactions; they do not prove a database change or successful authorization. Delivery requires the browser and server to be available; clicks are batched and retried in memory, with a beacon on leaving the page. Duplicate event IDs are rejected by a unique index.

Interaction rows display the category Activity, including retained Interface activity records. Click descriptions include a readable menu/submenu path; navigation clicks use their destination menu, and other controls use the originating screen. Internal route placeholders are not displayed.

Click descriptions use `Click > Menu > Submenu > Action`, for example `Click > Settings > Anti-passback > Save access settings`. A click describes the requested action, not proof of a successful save; the account action outcome is recorded separately. Older generic button records end with Action not recorded because the original button name was not captured.

## Card block/unblock grouping
Successful account actions and their corresponding BLOCK/UNBLOCK database event display as one Card management row with the acting Admin and outcome. New requests pass the exact event ID via a request-local context. Retained records are paired only when the same card entity and Started/completion request window yield a one-to-one match. Ambiguous or failed requests remain separate. Matching rfidBlocked-only database updates in that transaction are hidden from presentation; unrelated updates are retained. Original rows remain append-only and unchanged. Wording is normalized to Admin in displayed historical messages.

The audit list refreshes its data silently every 10 seconds, preserving the page and scroll position. Concurrent refreshes do not overlap. Combined card block/unblock descriptions include the recorded RFID card number.
