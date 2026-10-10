import test from "node:test";
import assert from "node:assert/strict";
import { cloudReply, parseCloudPacket } from "../src/lib/cloudc-protocol.ts";
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
