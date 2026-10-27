"""MM v1.2 reader framing. No tag writes, GPIO writes, or relay commands."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Frame:
    address: int
    command: int
    result: int
    data: bytes


def read_command(command: int, address: int = 0xffff) -> bytes:
    """Only permit inventory and documented read-only parameter queries."""
    queries = {0x20: 0x00, 0x50: 0x00, 0x52: 0x00, 0x81: 0x32, 0x83: 0x32, 0x85: 0x32}
    if command not in queries or not 1 <= address <= 0xffff:
        raise ValueError("Unsupported query or reader address")
    body = bytes([0x7c, address & 255, address >> 8, command, queries[command], 0])
    return body + bytes([-sum(body) & 255])


class Frames:
    def __init__(self):
        self.buffer = bytearray()

    def push(self, chunk: bytes):
        self.buffer.extend(chunk)
        if len(self.buffer) > 65536:
            self.buffer.clear()
            raise ValueError("Reader receive buffer exceeded")
        result = []
        while self.buffer:
            try:
                start = self.buffer.index(0xcc)
            except ValueError:
                self.buffer.clear()
                break
            del self.buffer[:start]
            if len(self.buffer) < 7:
                break
            size = self.buffer[5] + 7
            if len(self.buffer) < size:
                break
            raw = bytes(self.buffer[:size])
            if sum(raw) & 255:
                del self.buffer[0]
                continue
            del self.buffer[:size]
            result.append(Frame(int.from_bytes(raw[1:3], "little"), raw[3], raw[4], raw[6:-1]))
        return result


def auto_read_command(enabled=True, address=0xffff):
    """Vendor ADComm.ControlAutoReadTags: 0x34 / 0x00 / one Boolean byte."""
    if not 1 <= address <= 0xffff:
        raise ValueError("Invalid reader address")
    body = bytes([0x7c, address & 255, address >> 8, 0x34, 0, 1, int(bool(enabled))])
    return body + bytes([-sum(body) & 255])


def tag_read(frame: Frame):
    if frame.command != 0x20 or frame.result not in (0x02, 0x05):
        return None
    payload = frame.data
    if len(payload) < 6:
        return None  # Includes short inventory completion frames.
    pc = int.from_bytes(payload[1:3], "big")
    epc_size = ((pc >> 11) & 31) * 2
    # IW4A reports include the tag's two-byte CRC between EPC and RSSI.
    # The MM v1.2 example omits it. Never include either CRC in the credential.
    if epc_size == 0 or len(payload) not in (epc_size + 4, epc_size + 6):
        return None
    tag = {"antenna": payload[0], "pc": f"{pc:04X}", "epc": payload[3:3 + epc_size].hex().upper(), "rssi": payload[-1]}
    if len(payload) == epc_size + 6:
        tag["crc"] = payload[3 + epc_size:-1].hex().upper()
    return tag
