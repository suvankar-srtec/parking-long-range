"""Cloud Plus TypeC binary TCP gateway. Uses the locally installed vendor SDK."""
import asyncio
import contextlib
import datetime
import importlib
import json
import os
from pathlib import Path
import sys
import urllib.request
import uuid


def valid_frame(frame):
    checksum = 0
    for value in frame:
        checksum ^= value
    return len(frame) >= 9 and frame[0] == 2 and frame[-1] == 3 and checksum == 3


async def read_frame(stream):
    header = await asyncio.wait_for(stream.readexactly(7), 30)
    size = int.from_bytes(header[5:7], "little")
    if header[0] != 2 or size > 4096:
        raise ValueError("Invalid CloudC header")
    frame = header + await asyncio.wait_for(stream.readexactly(size + 2), 5)
    if not valid_frame(frame):
        raise ValueError("Invalid CloudC checksum")
    return frame


def post_json(app, token, path, body):
    request = urllib.request.Request(
        app + path, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "x-gateway-token": token},
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


class Gateway:
    def __init__(self, sdk, readers, app, token):
        self.sdk, self.readers, self.app, self.token = sdk, readers, app, token
        self.sessions = {}

    async def post(self, path, body):
        return await asyncio.to_thread(post_json, self.app, self.token, path, body)

    async def handle(self, stream, writer):
        ip, port = writer.get_extra_info("peername")[:2]
        reader = next((item for item in self.readers if item["readerIp"] == ip), None)
        if reader is None:
            writer.close()
            await writer.wait_closed()
            return
        device = reader["deviceNumber"]
        state = dict(deviceNumber=device, readerIp=ip, sourcePort=port, connectionId=str(uuid.uuid4()))
        controller = self.sdk.ControllerFactory(None).NewController(None)
        previous = self.sessions.get(device)
        if previous:
            previous.close()
        self.sessions[device] = writer
        try:
            result = await self.post("/api/rfid/tcp", dict(state, action="connect"))
            if result.get("ok") is not True:
                raise ValueError("Reader connection rejected")
            while True:
                frame = await read_frame(stream)
                command = frame[2]
                # Never dispatch unsupported biometric/identity requests to vendor helpers.
                if command == 0xE7:
                    if len(frame) < 52:
                        raise ValueError("Short scan request")
                    serial = frame[7:13].decode("ascii").strip("\x00 ")
                    if serial != reader["serial"]:
                        raise ValueError("Controller serial mismatch")
                    allowed = False
                    relay = frame[23] & 1
                    if frame[29] in (0, 1, 9):
                        try:
                            controller.GetControllerData(frame)
                            scan = controller.RequestEvent.Card
                            decision = await self.post("/api/rfid/cloudc", dict(state, decodedResult=scan))
                            allowed = decision.get("code") == "0000"
                        except Exception:
                            print("Scan denied: decoding or parking backend unavailable", flush=True)
                    reply = controller.RequestEvent.ReturnData(
                        int(allowed), relay, 1, "", "", "Allowed" if allowed else "Denied",
                        datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "",
                    )
                elif command == 0x56:
                    if len(frame) < 74:
                        raise ValueError("Short heartbeat")
                    reply, _ = controller.GetControllerData(frame)
                    if controller.HeartStatus.Serial.strip("\x00 ") != reader["serial"]:
                        raise ValueError("Controller serial mismatch")
                else:
                    # Historical card and alarm records are not fresh access requests.
                    continue
                writer.write(bytes(reply))
                await writer.drain()
                await self.post("/api/rfid/tcp", dict(state, action="alive"))
        except (Exception, asyncio.CancelledError):
            print("CloudC connection closed: " + device, flush=True)
        finally:
            if self.sessions.get(device) is writer:
                del self.sessions[device]
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
            with contextlib.suppress(Exception):
                await self.post("/api/rfid/tcp", dict(state, action="disconnect"))


async def main():
    sdk_path = os.environ.get("CLOUDC_SDK_PATH")
    token = os.environ.get("RFID_GATEWAY_TOKEN")
    if not sdk_path or not token:
        raise ValueError("Set CLOUDC_SDK_PATH and RFID_GATEWAY_TOKEN in the process environment")
    sys.path.insert(0, str(Path(sdk_path).resolve()))
    sdk = importlib.import_module("CloudC.CloudC")
    readers = json.loads(Path(os.environ.get("CLOUDC_READERS_FILE", "config/cloudc-readers.json")).read_text())
    if not isinstance(readers, list) or not readers:
        raise ValueError("Configure at least one approved CloudC reader")
    for item in readers:
        if any(not isinstance(item.get(key), str) or not item[key] for key in ("readerIp", "deviceNumber", "serial")):
            raise ValueError("Each reader needs readerIp, deviceNumber and serial")
    if len({item["readerIp"] for item in readers}) != len(readers) or len({item["deviceNumber"] for item in readers}) != len(readers):
        raise ValueError("Reader IPs and device numbers must be unique")
    gateway = Gateway(sdk, readers, os.environ.get("RFID_APP_URL", "http://127.0.0.1:3000").rstrip("/"), token)
    host = os.environ.get("CLOUDC_TCP_HOST", "127.0.0.1")
    port = int(os.environ.get("CLOUDC_TCP_PORT", "8001"))
    server = await asyncio.start_server(gateway.handle, host, port)
    print(f"CloudC gateway listening on {host}:{port}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
