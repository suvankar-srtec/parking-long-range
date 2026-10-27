# UHF network bridge

Admin and Super Admin select Registration, Entry, Exit, or Entry / Exit. UHF readers do not require QR configuration. Registration captures full EPCs only during active enrollment. Access scans use website capacity and anti-passback checks, then operate the existing same-building Cloud+ gate without changing wired reader assignments.

Private JSON settings: host, port, device_number, app_url, reader_token, log, relay_claims (SQLite path), controller {host, serial, username, password}. Keep credentials outside the repository. Run python bridge.py --config PRIVATE_PATH. Close the vendor demo first.

Held tags are suppressed; each fresh authorization is durably claimed before sending a timed relay command. Uncertain commands are never retried. Website failure denies UHF access; standalone UHF offline capacity enforcement is not provided. Cloud+ fallback remains separate.

For reversed physical relay wiring, set controller.relay_map to [1, 0]. Default [0, 1] preserves normal output order. This maps logical controller outputs to HTTP door outputs without changing parking direction.
