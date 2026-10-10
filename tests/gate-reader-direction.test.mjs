import test from "node:test";
import assert from "node:assert/strict";
import { gateReaderDirection, parseGateConfig, serializeGateConfig } from "../src/lib/gate-config.ts";
test("Separate entry and exit assignments never alternate on the exit reader", () => {
  const gate = parseGateConfig(serializeGateConfig("ENTRY_EXIT", "input-A", "input-B"));
  assert.equal(gateReaderDirection(gate, "input-A"), "ENTRY");
  for (let scan = 0; scan < 5; scan++) assert.equal(gateReaderDirection(gate, "input-B"), "EXIT");
  assert.equal(gateReaderDirection(gate, "unassigned"), "SELECT");
});
test("A reader explicitly assigned to both directions may alternate", () => {
  const gate = parseGateConfig(serializeGateConfig("ENTRY_EXIT", "input-A", "input-A"));
  assert.equal(gateReaderDirection(gate, "input-A"), "ENTRY_EXIT");
});
test("Directed and unconfigured gates retain their rules", () => {
  assert.equal(gateReaderDirection(parseGateConfig(serializeGateConfig("EXIT", "B")), "B"), "EXIT");
  assert.equal(gateReaderDirection(parseGateConfig(serializeGateConfig("ENTRY", "A")), "A"), "ENTRY");
  assert.equal(gateReaderDirection(parseGateConfig("SELECT"), "A"), "SELECT");
});
