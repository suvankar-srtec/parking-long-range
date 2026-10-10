import test from "node:test";
import assert from "node:assert/strict";
import { cloudReply, parseCloudPacket, cloudInputDevice } from "../src/lib/cloudc-protocol.ts";
test("Cloud C JSON POST and numeric fields", () => {
  assert.deepEqual(parseCloudPacket('{"Serial":"80M236","Key":123}', 'http://test/api'), {Serial:"80M236",Key:"123"});
});
test("Cloud C GET fields and compact response envelope", () => {
  assert.equal(parseCloudPacket('', 'http://test/api?Serial=80M236&Card=7833127').Card, '7833127');
  assert.equal(cloudReply({Key:"123"}), 'DATA={"Key":"123"}');
  assert.equal(cloudReply({AcsRes:"0"}), 'DATA={"AcsRes":"0"}');
});
test("Malformed packets rejected", () => {
  for (const body of ['[]', 'null', '{', '{"Serial":"bad serial"}', '{"Serial":"ok","Card":{}}']) {
    assert.throws(() => parseCloudPacket(body, 'http://test/api'));
  }
});

test("Padded firmware serial and optional status fields", () => {
  const packet = parseCloudPacket(JSON.stringify({Serial:"80M236  ",Key:"123",Status:null,Flag:true,Extra:{value:1}}), 'http://test/api');
  assert.equal(packet.Serial, '80M236');
  assert.equal(packet.Key, '123');
  assert.equal(parseCloudPacket(JSON.stringify({Serial:"80M236\u0000",Key:123}), 'http://test/api').Serial, '80M236');
  assert.throws(() => parseCloudPacket('{"Serial":null}', 'http://test/api'));
});

test("Separate controller inputs route to independent device identities", () => {
  assert.equal(cloudInputDevice('80M236', '0'), '80M236-A');
  assert.equal(cloudInputDevice('80M236', '1'), '80M236-B');
  for (const input of ['', '2', '-1', 'A']) assert.throws(() => cloudInputDevice('80M236', input));
  assert.throws(() => cloudInputDevice('invalid serial', '0'));
});
