"""Read-only MM UHF reader diagnostic; never authorizes a parking movement."""
import argparse
import json
import socket
import time

from mm_protocol import Frames, read_command, tag_read, auto_read_command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=49152)
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--inventory", action="store_true", help="Request inventory; otherwise only listen for active reports")
    parser.add_argument("--verbose", action="store_true", help="Show raw received packets for protocol diagnostics")
    parser.add_argument("--resume", action="store_true", help="Resume automatic reading on this TCP session using the vendor SDK command")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 1 <= args.seconds <= 300:
        parser.error("Invalid port or capture duration")
    frames = Frames()
    with socket.create_connection((args.host, args.port), timeout=3) as connection:
        connection.settimeout(0.5)
        connection.sendall(read_command(0x81))
        if args.resume:
            connection.sendall(auto_read_command())
        print(json.dumps({"connected": True, "host": args.host, "port": args.port}), flush=True)
        until = time.monotonic() + args.seconds
        next_poll = time.monotonic() + 1
        while time.monotonic() < until:
            if args.inventory and time.monotonic() >= next_poll:
                connection.sendall(read_command(0x20))
                next_poll = time.monotonic() + 1
            try:
                raw = connection.recv(4096)
            except socket.timeout:
                continue
            if not raw:
                break
            if args.verbose:
                print(json.dumps({"receivedHex": raw.hex().upper()}), flush=True)
            for frame in frames.push(raw):
                tag = tag_read(frame)
                if tag:
                    print(json.dumps({"tag": tag}), flush=True)
                elif frame.command == 0x81:
                    print(json.dumps({"baseParameters": frame.data.hex().upper(), "result": frame.result}), flush=True)


if __name__ == "__main__":
    main()
