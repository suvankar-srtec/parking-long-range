# Cloud C automatic offline verification

A powered Cloud C controller configured with Access Check = Online first automatically uses its existing stored card permissions when the online server cannot be reached. This is controller firmware behavior, not an HTTP-to-TCP switch, and does not depend on a website request succeeding.

The memory is shared by reader inputs A and B. The website shows one controller-level explanation to Super Admin; there are no card-slot, timezone, capacity or enable fields in this flow. Online reader purposes remain configurable as before. Offline decisions follow the controller's own saved configuration, which must be tested when physical input purposes are changed.

Only cards already present in controller memory can be verified offline. This UI change does not automatically copy cards registered on the website to the controller. Existing controller cards are not cleared or overwritten by the informational panel. Unknown cards cannot be verified from the website while the controller is disconnected. A powered-off controller cannot verify any cards.

Current website card blocks, parking capacity and live occupancy cannot be checked while disconnected. Reconnecting uploads controller card/alarm history, which is durably saved and deduplicated before acknowledgement. History is not replayed as a fresh authorization and does not automatically reconcile parking occupancy.

To test: verify a stored card while connected, disconnect internet while retaining power and reader wiring, scan that card, then reconnect and inspect uploaded history. Confirm controller Offline/Online settings and actual relay behavior on the hardware. Existing QR functionality and online Cloud C authorization remain available.

The earlier opt-in memory-command backend is retained for compatibility with any previously configured installation; its reserved-memory configuration is not automatically enabled or changed by this UI. It is separate from the controller's native offline verification.
