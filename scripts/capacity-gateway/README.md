# Local parking capacity gateway

This optional gateway provides strict shared parking-capacity enforcement on a controller's local network. It is an alternative to controller-native Offline first operation, described in `../../docs/cloudc-offline.md`. TLS 1.2 is supported. Gateway configuration, credentials, certificate key, SQLite ledger and logs live in `%LOCALAPPDATA%\SRTEC\CapacityGateway` and must not be committed.

For strict gateway-only operation, the controller must use **Only Online** when its server is the local gateway. Internet outages do not stop local authorization. If the PC or LAN is unavailable, entry fails closed; native Offline first would bypass shared capacity. Keep the PC powered, on the LAN, and prevent sleep. Do not connect another independent entry controller to the cloud for the same capacity pool: all entry decisions for that pool must share this gateway ledger.

The ledger enforces building total, owner pool, company pool, and company owner/employee limits. Registration inputs forward to the cloud and require internet. Four owner spaces allow any four of five registered cards inside; the fifth is denied until an exit frees a space. Checks and outbox writes are one SQLite transaction, committed with SQLite synchronous=FULL before the relay approval is returned. Restart retains occupancy and unsent scans. The server acknowledges deduplicated event IDs; records are removed from the outbox only after acknowledgement. Cloud snapshots cannot overwrite unsent local changes. Blocked cards cannot enter, but known inside cards can exit. Cached permissions expire after 24 hours without renewal; entry then stops while exit remains possible.

Administrative manual exits and allocation/block updates reach the gateway after cloud synchronization. During an internet outage, the latest cached limits apply. Native controller memory is not the capacity authority in this setup.

For a gateway installation, configure Windows sign-in startup and keep the PC awake and logged in. Disable gateway startup when switching to direct controller-native operation. Its TLS certificate/key and credential are private to the Windows user. The current controller configuration is backed up in the private runtime directory.

Run: `python gateway.py --config PATH_TO_PRIVATE_CONFIG`. Test: `python -m unittest discover -s scripts/capacity-gateway -p 'test*.py'`.

After installation, test online and with only the **internet** disconnected: enter four different cards, deny the fifth, exit one, then allow the fifth. Do not unplug the controller-to-PC LAN for an internet-outage test.

## Enforcing shared parking limits

Use **Only Online** with the controller pointed at its authorized local gateway when shared parking limits must be enforced. The local gateway remains the authorization source during an internet outage. Controller-to-gateway LAN connectivity is required.

**Offline first** can authorize stored cards before the gateway checks occupancy. It must not be used when strict shared building, owner, or company capacity enforcement is required.

A configuration correction must preserve existing occupancy. If occupancy already exceeds the configured limit, record actual exits or use the approved manual-exit workflow before permitting new entries. Do not reset counts or delete history to hide overbooking.

Deploying the website does not configure a physical controller or start a local gateway. Keep installation-specific addresses, credentials, certificates, configuration backups and occupancy data outside Git.

## Internet outage storage and recovery

Keep the controller-to-gateway LAN connected while disconnecting only internet/WAN. Entry and exit decisions use the cached parking limits and the local SQLite ledger; they never wait for cloud upload. The gateway PC stores scans on disk, not in controller memory. The latest cached permissions remain valid for their 24-hour lease; expired entry permissions fail closed while known inside cards may exit.

Upload retries resume automatically when internet returns. The same persisted event IDs are retried, and the website deduplicates them before acknowledgement. Only explicitly acknowledged events leave the disk queue. Partial acknowledgements, lost responses, and gateway restarts retain all remaining events. Uploaded gateway scans appear in Offline Sync and reconcile the website's vehicle status and activity. The local /health queued field reports the entire disk queue, including records beyond a single 20-event upload batch.

The outage-recovery tests exercise real local HTTP relay replies with a failing cloud connection, capacity denial and release after exit, disk persistence across gateway restart, automatic upload recovery, and partial/lost acknowledgements. Tests use synthetic cards and do not operate real relays.

## Testing without unplugging LAN

When router/WAN access is unavailable, restart the single existing gateway helper with `--offline-test-seconds 180` in addition to its usual private `--config` argument. This pauses only that process's outbound cloud requests for three minutes. The controller and PC keep their LAN connection, real allowed scans still receive local relay approvals, and scan records accumulate in the normal disk queue. This is a simulated gateway cloud outage; it does not disable the PC's internet connection.

The pause expires automatically, after which normal retries upload the queued records. `/health` exposes `offlineTestRemainingSeconds` so the test window can be verified. The maximum is 300 seconds. This option is not added to startup configuration; a normal restart uses zero pause. Do not run a second helper on the same port. No relay pulse is generated merely by starting the test; physical card scans exercise the normal rules.

## Optional native fallback when controller LAN is unplugged

When standalone entry/exit is explicitly preferred over shared capacity enforcement during controller disconnection, enable `native_fallback` in the private gateway configuration and select controller **Online first**, retaining the local gateway as its server. Keep HTTP Keep-Alive off on the tested firmware. This option is disabled by default; it is not the strict Only Online configuration above.

While the gateway responds, its local capacity ledger authorizes scans. If the controller cannot obtain online authorization, its firmware can fall back to stored card permissions. Shared capacity limits are not guaranteed in that situation, even if some network access remains available. Stored permissions expire unless renewed while connected. Native anti-passback and other saved controller rules still apply; verify an online-entry/offline-exit sequence on the physical hardware.

A separate gateway worker forwards native memory acknowledgements to the application's existing heartbeat handler and caches only validated card/timezone memory commands. Controller heartbeat keys are echoed locally and never reused from delayed cloud responses. Relay/alarm/fire commands are not forwarded by this worker. Cloud latency does not block local capacity decisions or heartbeat replies.

After reconnection, native history is forwarded for durable website storage. Verified native entry/exit codes update the local gateway occupancy before the controller history acknowledgement is returned; stale history cannot overwrite a newer local scan. Unknown event codes never change occupancy. Uploaded native history and gateway records remain separate and are deduplicated by the existing website handlers.

## Building access switches

Admin and Super Admin: Settings > Limit enable/disable or Settings > Anti-passback. Super Admin selects a building; Admin manages the assigned building. Both roles can independently save Parking limits enabled and Anti-passback enabled; new and existing buildings default to both enabled. Disabling limits bypasses capacity checks for building, owner, company/category and visitor pools without changing allocation values or clearing occupancy. Blocked, inactive, unknown and expired credentials retain their validation. Disabling anti-passback permits repeated directional scans after the reader cooldown, with one occupied space per tracked card rather than an extra space per repeat. Single-use visitor QR restrictions remain independent.

Connected gateways receive these switches in their permission manifest and persist them for internet outages. An unplugged controller uses its last acknowledged native anti-passback timezone setting; the memory planner includes that switch in its fingerprint and queues an updated timezone on reconnection. The parking-limit switch does not implement an undocumented standalone capacity counter. Native fallback still cannot guarantee capacity when controller-to-gateway connectivity is lost.

For an existing database, apply `prisma/add-building-access-policy.sql` before starting the new app. Normal builds also add the fields through the project's Prisma schema push.
