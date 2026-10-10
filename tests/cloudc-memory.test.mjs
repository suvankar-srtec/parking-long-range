import test from "node:test";
import assert from "node:assert/strict";
import { cardCommand, deleteCardCommand, timezoneCommand, historyIdentity } from "../src/lib/cloudc-memory-protocol.ts";

test("Card and deletion frames exactly match vendor Python SDK", () => {
  const frame = cardCommand(100, "8336774", 0, new Date("2026-10-10T07:30:00Z"), new Date("2026-10-11T07:30:00Z"), 330);
  assert.equal(frame, "0200C100003F0064000086357F00000000000000000000000000000000000000000000000000000000FFFFFFFF01001A0A0A0D001A0A0B0D00000000000000000000000000005403");
  assert.equal(deleteCardCommand(100), "02001500000400000000647703");
});
test("Boundary card IDs and slot ranges fail closed", () => {
  const now = new Date(), until = new Date(now.getTime()+3600000);
  for (const card of ["0", "4294967296", "RFID123", "-1"]) assert.throws(() => cardCommand(1, card, 0, now, until));
  assert.throws(() => cardCommand(60000, "1", 0, now, until));
  assert.throws(() => cardCommand(1, "1", 16, now, until));
  assert.throws(() => cardCommand(1, "1", 0, now, now));
});
test("Timezone has a valid frame checksum and excludes passwords", () => {
  const frame = Buffer.from(timezoneCommand(0,new Date("2026-10-11T13:00:00Z")), "hex");
  assert.equal(frame.reduce((a,b)=>a^b,0),3);
  assert.equal(frame[13],1); // Single card identification.
});
test("History identities deduplicate retransmissions but keep reused indices on different dates", () => {
  const packet = {Serial:"80M236",type:"100",IndexEvent:"12",EventTime:"2026-10-10 13:00:00"};
  assert.equal(historyIdentity(packet,330).time.toISOString(),"2026-10-10T07:30:00.000Z");
  assert.equal(historyIdentity(packet).key,historyIdentity({...packet}).key);
  assert.notEqual(historyIdentity(packet).key,historyIdentity({...packet,EventTime:"2026-10-11 13:00:00"}).key);
  assert.throws(()=>historyIdentity({...packet,EventTime:"bad"}));
});
