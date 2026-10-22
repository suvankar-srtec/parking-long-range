# Local parking capacity gateway

This optional gateway provides strict shared parking-capacity enforcement on a controller's local network. It is an alternative to controller-native Offline first operation, described in `../../docs/cloudc-offline.md`. TLS 1.2 is supported. Gateway configuration, credentials, certificate key, SQLite ledger and logs live in `%LOCALAPPDATA%\SRTEC\CapacityGateway` and must not be committed.

The controller must use **Only Online** when its server is the local gateway. Internet outages do not stop local authorization. If the PC or LAN is unavailable, entry fails closed; native Offline first would bypass shared capacity. Keep the PC powered, on the LAN, and prevent sleep. Do not connect another independent entry controller to the cloud for the same capacity pool: all entry decisions for that pool must share this gateway ledger.

The ledger enforces building total, owner pool, company pool, and company owner/employee limits. Registration inputs forward to the cloud and require internet. Four owner spaces allow any four of five registered cards inside; the fifth is denied until an exit frees a space. Checks and outbox writes are one SQLite transaction. Restart retains occupancy and unsent scans. The server acknowledges deduplicated event IDs; records are removed from the outbox only after acknowledgement. Cloud snapshots cannot overwrite unsent local changes. Blocked cards cannot enter, but known inside cards can exit. Cached permissions expire after 24 hours without renewal; entry then stops while exit remains possible.

Administrative manual exits and allocation/block updates reach the gateway after cloud synchronization. During an internet outage, the latest cached limits apply. Native controller memory is not the capacity authority in this setup.

For a gateway installation, configure Windows sign-in startup and keep the PC awake and logged in. Disable gateway startup when switching to direct controller-native operation. Its TLS certificate/key and credential are private to the Windows user. The current controller configuration is backed up in the private runtime directory.

Run: `python gateway.py --config PATH_TO_PRIVATE_CONFIG`. Test: `python -m unittest discover -s scripts/capacity-gateway -p test_gateway.py`.

After installation, test online and with only the **internet** disconnected: enter four different cards, deny the fifth, exit one, then allow the fifth. Do not unplug the controller-to-PC LAN for an internet-outage test.

## Enforcing shared parking limits

Use **Only Online** with the controller pointed at its authorized local gateway when shared parking limits must be enforced. The local gateway remains the authorization source during an internet outage. Controller-to-gateway LAN connectivity is required.

**Offline first** can authorize stored cards before the gateway checks occupancy. It must not be used when strict shared building, owner, or company capacity enforcement is required.

A configuration correction must preserve existing occupancy. If occupancy already exceeds the configured limit, record actual exits or use the approved manual-exit workflow before permitting new entries. Do not reset counts or delete history to hide overbooking.

Deploying the website does not configure a physical controller or start a local gateway. Keep installation-specific addresses, credentials, certificates, configuration backups and occupancy data outside Git.
