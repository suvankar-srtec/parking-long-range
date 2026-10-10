# Cloud C offline verification

HTTP remains the configured online protocol. The SDK does not document automatic HTTP-to-TCP failover. Internet outage verification uses controller memory; controller and readers must remain powered.

## Enable

Sign in as Super Admin. Assign A to Entry and B to Exit in the same enabled building. Open Device / Reader, then **Offline memory** on input A. Reserve an unused card index range (0-59999, up to 1000 slots) and an unused timezone index (0-15) in the controller. Confirm they are unused: the app writes those slots and that timezone. Do not reuse them in vendor software. The range cannot be changed after initialization. Enter the controller clock offset accurately: NTP timezone 0 means UTC (0 minutes); India is 330 minutes.

Click Enable / retry sync. Wait until pending commands reach zero, no error is shown, and the controller acknowledges commands. Set controller Access Check to Online first. Test a registered card while online, then temporarily disconnect internet (keep power and the reader wiring connected), test locally, reconnect and confirm history upload. A successful queued command is not proof of physical gate movement; test the hardware.

## Behavior

Only numeric 32-bit RFID cards from enabled building/company records and non-placeholder employees are stored. Blocked cards are excluded. Visitors and QR credentials retain their existing online workflow. Commands use the SDK C1 add/update, 15 delete and 0D timezone frames. No clear-all command is sent. Controller memory is shared by A/B, so offline registration or swapped physical directions are not enabled. Changing the roles, building or disabling access queues app-card removal on the next permission check.

Card permissions are checked at most once per minute on heartbeats, renewed hourly, and expire after 24 hours without renewal. Commands are persisted and retried using IndexCmd/CmdOK, and failed acknowledgements stop the queue until retried. Disabling sync queues removal only for slots the app has managed. Wait for acknowledgement: a disconnected controller still has its last stored permissions until deletion or expiry. Any cards already stored manually remain governed by the controller's own configuration.

While offline, current cloud blocks, live occupancy/capacity and app anti-passback cannot be enforced. Do not promise these rules from the memory whitelist. Controller clock accuracy and vendor offline mode settings must be verified on the device.

Card/alarm history is saved durably and deduplicated before returning IndexEvent/IndexAlarm. Activity shows HISTORY records and retains EventType and raw packet (without token) in cloudc_history. History is never replayed through live authorization and does not change parking counts: the supplied SDK does not establish firmware-specific EventType meanings. Occupancy reconciliation remains a separate task once those meanings and sample packets are confirmed.

## Deployment

The existing build runs prisma db push and generates the new models. No additional secret is required; existing RFID_HTTP_TOKEN authenticates controller requests. Offline sync defaults to disabled. Existing QR and online Cloud C routes remain active.
