# Cloud Plus TypeC Python integration

The parking frontend and backend use TypeScript/JavaScript with Next.js and Node.js.
The optional `scripts/cloudc-gateway.py` adds a Python transport for the vendor's
binary TCP protocol. It uses Python's standard library plus your local CloudC SDK;
Twisted and the desktop demo are not required.

## What the supplied demo does

- `main.py` starts a TCP server on port 8001.
- `NetWork.py` uses Twisted to receive binary packets and the CloudC package to
  interpret heartbeats, scan requests, card records and alarms. Its sample request
  handler always sets `open = 1`, approving every request.
- `MyForm.py` provides a Tkinter window with sample controls for doors, reader locks,
  clocks, enrollment, displays and alarms. Several buttons contain hardcoded demo data.
- `CloudCPython.code-workspace` is editor configuration.
- `PhotoConsole.exe` and the DLLs support vendor photo functionality; the gateway
  does not invoke them. Card/QR access does not need those binaries.

The existing `scripts/rfid-tcp.mjs` expects text such as `vgdecoderresult=...`.
The supplied Python SDK instead expects binary packets with a seven-byte header,
payload length, XOR checksum and end marker. These listeners are different protocols.

## Gateway behavior

The gateway accepts approved reader IPs, verifies controller serials, handles split
and combined TCP packets, answers SDK heartbeats and decodes card/RS232/Base64 QR
requests (types 0, 1 and 9). It sends scans to authenticated `/api/rfid/cloudc`.
That endpoint checks the reader's TCP session and uses the existing parking access
logic, including visitor tokens, enrollment, blocked cards and parking limits.
Only a `0000` decision produces a binary allow reply; failures produce denial.
It reports connection status through `/api/rfid/tcp` and preserves TCP status when
processing scans. Unsupported request types are denied. Historical card/alarm records
are ignored and are not imported. Remote door controls and device configuration from
the demo are not exposed by this integration.

## Setup on Windows

1. Register/configure the reader in the parking app with connection type TCP, its
   actual IP, building and entry/exit mode. Enable it when ready for use.
2. Copy `config/cloudc-readers.example.json` to `config/cloudc-readers.json`. Fill in
   the matching app device number, IP and six-character controller serial reported
   by the SDK. The app device number may differ from the SDK serial.
3. Run the Next.js app with `RFID_GATEWAY_TOKEN` configured. Use the same secret for
   the gateway. The Python process reads process environment variables, not `.env`.
4. In PowerShell, from the project root:

```powershell
$env:CLOUDC_SDK_PATH = 'D:\Cloud Plus TypeC SDK(1) (1)\Cloud Plus TypeC demo\CloudC-TCPServer-Python'
$env:RFID_GATEWAY_TOKEN = '<same secret as parking backend>'
$env:RFID_APP_URL = 'http://127.0.0.1:3000'
$env:CLOUDC_TCP_HOST = '<this computer LAN IP>'
$env:CLOUDC_TCP_PORT = '8001'
python scripts/cloudc-gateway.py
```

5. Configure the controller's TCP server destination to this computer's LAN IP and
   port 8001 using the vendor utility. Do not run the demo on that same port.
   Keep this listener on the reader network; configure the local firewall as needed.
6. Verify an authorized scan allows entry, an unknown/blocked scan denies entry,
   visitor QR tokens work, backend outages deny access, and reader status updates.

Protocol tests use synthetic SDK-format packets. Actual controller/relay behavior
requires this hardware check before relying on the integration.
