"""Authenticated UHF enrollment and authorized Cloud+ relay bridge."""
import argparse
import base64
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
import ipaddress
import sqlite3
import uuid
import json
import logging
import pathlib
import socket
import time
import urllib.parse
import urllib.request

from mm_protocol import Frames, auto_read_command, read_command, tag_read


class Presence:
    def __init__(self, absent_seconds=3):
        self.absent_seconds = absent_seconds
        self.seen = {}

    def observe(self, epc, capture_id, now):
        previous = self.seen.get(epc)
        self.seen[epc] = (now, capture_id)
        if len(self.seen) > 1000:
            self.seen = {key: value for key, value in self.seen.items() if now - value[0] < 60}
        return bool(capture_id) and (not previous or previous[1] != capture_id or now - previous[0] >= self.absent_seconds)


def validate_config(config):
    url = urllib.parse.urlsplit(config.get("app_url", ""))
    if url.scheme != "https" and not (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1")):
        raise ValueError("Use HTTPS for the website, or HTTP on localhost only")
    if not config.get("reader_token") or not config.get("device_number", "").startswith("UHF-"):
        raise ValueError("Missing reader token or device number")
    if not 1 <= int(config.get("port", 49152)) <= 65535:
        raise ValueError("Invalid reader port")


class Bridge:
    def __init__(self, config):
        validate_config(config)
        self.config = config
        self.presence = Presence()
        self.capture_id = None
        self.mode = None
        self.access_ready_at = time.monotonic() + 3

    def post(self, action, **fields):
        body = {"action": action, "deviceNumber": self.config["device_number"], "readerIp": self.config["host"], **fields}
        request = urllib.request.Request(self.config["app_url"].rstrip("/") + "/api/rfid/uhf", data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-reader-token": self.config["reader_token"]})
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.load(response)
        if not result.get("ok"):
            raise ValueError("Website rejected reader request")
        return result

    def heartbeat(self, connected):
        result = self.post("heartbeat", connected=connected)
        self.mode = result.get("mode") if connected and result.get("enabled") else None
        capture_id = result.get("captureId") if self.mode == "REGISTER" else None
        if capture_id and capture_id != self.capture_id:
            logging.info("Registration session ready; present one tag")
        self.capture_id = capture_id

    def operate(self, result, request_id):
        if result.get("gateAllowed") is not True:
            return False
        target = self.config.get("controller", {})
        relay = result.get("relay") or {}
        if (result.get("requestId") != request_id or result.get("expiresAt", 0) < time.time() * 1000
                or relay.get("serial") != target.get("serial") or type(relay.get("index")) is not int
                or relay["index"] not in (0, 1) or result.get("action") not in ("ENTRY", "EXIT")
                or not result.get("eventId")):
            raise ValueError("Invalid or expired relay authorization")
        relay_map = target.get("relay_map", [0, 1])
        if not isinstance(relay_map, list) or len(relay_map) != 2 or any(type(value) is not int for value in relay_map) or sorted(relay_map) != [0, 1]:
            raise ValueError("Controller relay_map must contain outputs 0 and 1 once each")
        action_outputs = target.get("action_outputs")
        if action_outputs is not None:
            if not isinstance(action_outputs, dict) or set(action_outputs) != {"ENTRY", "EXIT"} or any(type(value) is not int for value in action_outputs.values()) or sorted(action_outputs.values()) != [0, 1]:
                raise ValueError("action_outputs must assign ENTRY and EXIT to distinct outputs 0 and 1")
            physical_output = action_outputs[result["action"]]
        else:
            physical_output = relay_map[relay["index"]]
        address = ipaddress.ip_address(target["host"])
        if not address.is_private:
            raise ValueError("Controller must have a private LAN address")
        # Claim before sending: an uncertain network result must never be retried.
        with closing(sqlite3.connect(self.config["relay_claims"])) as db:
            db.execute("CREATE TABLE IF NOT EXISTS pulses (event_id TEXT PRIMARY KEY)")
            inserted = db.execute("INSERT OR IGNORE INTO pulses VALUES (?)", (result["eventId"],)).rowcount
            db.commit()
        if not inserted:
            return False
        credentials = base64.b64encode((target["username"] + ":" + target["password"]).encode()).decode()
        request = urllib.request.Request("http://" + str(address) + "/cdor.cgi?open=1&door=" + str(physical_output),
                                         headers={"Authorization": "Basic " + credentials})
        with urllib.request.urlopen(request, timeout=2) as response:
            response.read(4096)
        logging.info("Authorized %s relay command sent to output %s", result["action"], physical_output)
        return True

    def session(self, seconds=None):
        self.access_ready_at = time.monotonic() + 3
        frames = Frames()
        deadline = time.monotonic() + seconds if seconds else float("inf")
        with socket.create_connection((self.config["host"], self.config.get("port", 49152)), timeout=3) as connection:
            connection.settimeout(0.5)
            connection.sendall(read_command(0x81))
            connection.sendall(auto_read_command())
            logging.info("UHF reader connected")
            next_heartbeat = 0
            last_received = time.monotonic()
            next_probe = time.monotonic() + 5
            # Keep draining RF reports while website requests run. Otherwise buffered
            # reports look like newly presented tags after every slow request.
            with ThreadPoolExecutor(max_workers=1) as worker:
                pending = None
                while time.monotonic() < deadline:
                    now = time.monotonic()
                    if pending and pending.done():
                        pending.result()
                        pending = None
                    if now - last_received > 15:
                        raise ConnectionError("Reader stopped responding; reconnecting")
                    if now >= next_probe:
                        connection.sendall(read_command(0x81))
                        next_probe = now + 5
                    if now >= next_heartbeat and pending is None:
                        pending = worker.submit(self.refresh)
                        next_heartbeat = now + 5
                    try:
                        raw = connection.recv(4096)
                    except socket.timeout:
                        continue
                    if not raw:
                        raise ConnectionError("Reader disconnected")
                    for frame in frames.push(raw):
                        last_received = time.monotonic()
                        tag = tag_read(frame)
                        if not tag:
                            continue
                        context = self.capture_id if self.mode == "REGISTER" else "ACCESS"
                        previous = self.presence.seen.get(tag["epc"])
                        observed_at = time.monotonic()
                        if pending is not None:
                            if (previous and previous[1] == context and observed_at - previous[0] < self.presence.absent_seconds) or (self.mode != "REGISTER" and observed_at < self.access_ready_at):
                                self.presence.seen[tag["epc"]] = (observed_at, context)
                            continue
                        submit = self.presence.observe(tag["epc"], context, observed_at)
                        if self.mode != "REGISTER":
                            submit = submit and self.mode in ("ENTRY", "EXIT", "ENTRY_EXIT") and time.monotonic() >= self.access_ready_at and bool(self.config.get("controller"))
                        if submit:
                            pending = worker.submit(self.submit_tag, tag["epc"], self.mode, self.capture_id)

    def refresh(self):
        try:
            self.heartbeat(True)
        except Exception as error:
            self.capture_id = None
            self.mode = None
            logging.warning("Website unavailable (%s)", type(error).__name__)

    def submit_tag(self, epc, mode, capture_id):
        started = time.monotonic()
        try:
            request_id = str(uuid.uuid4())
            result = self.post("scan", epc=epc, captureId=capture_id, mode=mode, requestId=request_id, controllerSerial=self.config.get("controller", {}).get("serial"))
            if mode == "REGISTER":
                if result.get("gateAllowed"):
                    raise ValueError("Enrollment cannot operate a relay")
                logging.info("Registration response: captured=%s (%.2fs)", result.get("captured", False), time.monotonic()-started)
            else:
                if result.get("gateAllowed") and mode != "ENTRY_EXIT" and result.get("action") != mode:
                    raise ValueError("Relay authorization does not match selected reader role")
                self.operate(result, request_id)
                logging.info("Access response: %s (%.2fs)", result.get("message", "Denied"), time.monotonic()-started)
        except Exception as error:
            logging.warning("Scan request failed (%s); present tag again", type(error).__name__)



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--check-seconds", type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.check_seconds <= 300:
        parser.error("Check duration must be 0-300 seconds")
    config = json.loads(pathlib.Path(args.config).read_text(encoding="utf-8-sig"))
    logging.basicConfig(level=logging.INFO, filename=config.get("log"), format="%(asctime)s %(message)s")
    bridge = Bridge(config)
    while True:
        try:
            bridge.session(args.check_seconds or None)
            if args.check_seconds:
                return
        except KeyboardInterrupt:
            return
        except Exception as error:
            bridge.capture_id = None
            logging.warning("UHF connection unavailable (%s); retrying", type(error).__name__)
            try:
                bridge.heartbeat(False)
            except Exception:
                pass
            if args.check_seconds:
                raise
            time.sleep(3)


if __name__ == "__main__":
    main()
