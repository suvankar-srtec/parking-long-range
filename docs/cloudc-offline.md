# Cloud C automatic offline verification

For controller-native operation, set **Access Check = Offline first** and configure the controller to contact the application server directly over HTTPS. Registered cards must be synchronized and acknowledged in controller memory before testing. The powered controller can then authorize stored cards and pulse its entry/exit outputs without a LAN connection. **Online first** is a different mode: it tries server authorization before falling back to stored permissions.

The memory is shared by reader inputs A and B. The Super Admin-only **Offline Sync** page shows uploaded native controller history alongside gateway records, labeled by source. Native offline decisions follow saved controller permissions and input settings. Verify both physical entry and exit behavior after changing operating modes.

Only cards already present in controller memory can be verified offline. Where app-managed card-memory sync is enabled, wait until all applicable grant/revocation commands are acknowledged; creating a website record alone is not proof of a stored controller grant. Unknown cards cannot be checked against the website while disconnected. A powered-off controller cannot verify cards.

Current website card blocks, parking capacity and live occupancy cannot be checked while disconnected. Reconnecting uploads controller card/alarm history, which is durably saved and deduplicated before acknowledgement. History is not replayed as a fresh authorization. On verified controller 80M236, successful native entry code 11 and exit code 10 reconcile registered vehicle occupancy and activity. Invalid cards and alarms do not change occupancy. Repeated uploads are deduplicated, online scan copies are linked, and older scans cannot override newer vehicle status. Existing successful history is repaired in batches on authenticated heartbeats.

To test: verify a stored card while connected, disconnect internet while retaining power and reader wiring, scan that card, then reconnect and inspect uploaded history. Confirm controller Offline/Online settings and actual relay behavior on the hardware. Existing QR functionality and online Cloud C authorization remain available.

The earlier opt-in memory-command backend is retained for compatibility with any previously configured installation; its reserved-memory configuration is not automatically enabled or changed by this UI. It is separate from the controller's native offline verification.

## Automatic registered-card synchronization

Controller 80M236 is automatically initialized on authenticated HTTP heartbeats using a locally verified empty card range, zero-based indices 10000-10099, and unused timezone index 1. Existing SDK sample cards and other timezones are retained. No clear-all command or manual form is used. Other controllers require an inventory check before an automatic memory profile is added; their unused slots are never guessed.

Registered numeric RFID cards for the controller's enabled building are copied through persisted C1 commands. Blocked/deleted cards are upserted into their app-managed slots with zero time-zone permissions. This denies access even if an old slot was already cleared and avoids a rejected deletion blocking the synchronization queue. Changes are checked once per minute while connected; card validity renews hourly and expires after 24 hours without renewal. The current profile tracks up to 100 distinct card numbers. Both inputs must be enabled, in the same enabled building, and assigned access gates. Either input can be Entry or Exit. Registration inputs pause grants because offline memory is shared.

Offline Sync shows queued/failed commands and the last controller acknowledgement. Wait for zero pending commands and no errors, then verify the cards in the controller Cards list before disconnecting power-free network connectivity for a test. Offline scanning follows the controller's local direction settings; the cloud's live parking capacity and occupancy cannot be enforced offline. Website blocks cannot reach a disconnected controller until reconnect or permission expiry.

## Native offline anti-passback

The app-managed time zone enables native APB using Access bit 7 (0x81 combines APB with Card identification). This was verified on controller 80M236 by an acknowledged heartbeat command and reading the enabled APB checkbox back from its time-zone page. Time-zone renewals preserve APB; the memory-plan version forces existing profiles to receive the updated setting. Test physically: entry once, another entry without exit must refuse, exit, then entry again. Offline Sync retains the controller?s original scan history, including older repeated entries that occurred before APB was enabled.

## Online entry followed by offline exit

On 80M236, registered vehicles can enter online only after their offline memory plan has been acknowledged without pending/failed commands. Until then the scan is denied without changing occupancy, with a visible memory-sync reason. Online exits and already-inside decisions continue through normal authorization. The controller remains powered in Online first mode and uses its native APB time zone when the server is unreachable. Offline exits reconcile the website after reconnection. The SDK documents no separate setter for a card?s inside/outside APB state; validate the actual online-entry/offline-exit sequence physically rather than fabricating a relay operation to force that state.

## Online-first transition diagnostics

Online first is retained with the existing 1.5-second verification wait and five-second heartbeat interval. Stored-history backfill runs with Next.js after() after the heartbeat response; it no longer delays the controller?s key/command acknowledgement. Slow HTTP handlers log CLOUDC_HTTP_SLOW with elapsed milliseconds and stage, without tokens or card numbers. Native firmware connection detection remains separate from the configured per-scan wait; a physical network-loss test is required to measure the transition.

## Native offline reconnection and capacity limitations

Keep the controller powered while disconnecting only its network for a native offline test. Test entry and exit using synchronized cards, reconnect the network, and verify the uploaded records. The server saves and deduplicates each native history record before returning its original record index as acknowledgement. Failed saves must not be acknowledged, so the controller can retry. Uploaded records remain available on the website; acknowledgement retires the controller's pending upload through its firmware protocol rather than issuing a blanket memory-clear command.

Native Offline first does not guarantee shared building, owner or company parking limits. It can admit stored cards before the server checks occupancy, including while internet access is available. Strict shared limits require the local gateway architecture documented in `scripts/capacity-gateway/README.md`, with Only Online authorization against that gateway and working controller-to-gateway LAN connectivity.

A native Offline first installation does not use the capacity gateway as its authorization server. Stop the unused gateway helper and disable its automatic startup when switching to direct native operation. Retain its database and private configuration for rollback. Firmware settings are changed locally; a GitHub push or website deployment alone does not change a physical controller's mode.
