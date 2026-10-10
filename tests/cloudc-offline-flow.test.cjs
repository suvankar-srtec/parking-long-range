const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function fixture() {
  const serial = "80M236";
  const state = { config: { serial, enabled: true, slotStart: 100, slotCount: 10, timezone: 0,
    utcOffsetMinutes: 0, slots: [], fingerprint: "", plannedAt: null, checkedAt: null }, commands: [], cards: ["8336774"], rolesValid: true };
  const gate = { direction: "ENTRY_EXIT::ENTRY_READER::a::EXIT_READER::b" };
  const tx = {
    $executeRaw: async () => {},
    cloudCOffline: {
      findUnique: async () => structuredClone(state.config),
      update: async ({data}) => Object.assign(state.config, data),
    },
    rfidReader: { findMany: async () => ["a","b"].map(id => ({id,enabled:true,buildingId:"building",mode:state.rolesValid ? "ENTRY_EXIT":"REGISTER",building:{enabled:true,gates:[gate]}})) },
    vehicle: { findMany: async () => state.cards.map(rfidCardNo=>({rfidCardNo})) },
    buildingOwnerVehicle: { findMany: async () => [] },
    cloudCCommand: {
      createMany: async ({data}) => { for (const row of data) state.commands.push({...row,id:state.commands.length+1,status:"PENDING",attempts:0,sentAt:null}); },
      findFirst: async ({where}) => state.commands.find(c=>c.status===where.status) || null,
      count: async ({where}) => state.commands.filter(c=>c.status===where.status).length,
      update: async ({where,data}) => { const row = state.commands.find(c=>c.id===where.id); const {attempts,...rest}=data; Object.assign(row,rest); if(attempts) row.attempts+=attempts.increment; },
      updateMany: async ({where,data}) => { for(const row of state.commands) if(where.status.in.includes(row.status)) Object.assign(row,data); },
    },
  };
  const prisma = {...tx,$transaction:async fn=>fn(tx)};
  const cache = {};
  function load(name) {
    if(cache[name]) return cache[name];
    const file = path.join(__dirname,"../src/lib/",name+".ts");
    const code = ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const module = {exports:{}};
    vm.runInNewContext(code,{module,exports:module.exports,Buffer,Date,Set,console,require(id){
      if(id==="@/lib/building-parking") return {ParkingError: class extends Error {}};
      if(id==="@/lib/prisma") return {prisma};
      if(id.startsWith("@/lib/")) return load(id.slice(6));
      return require(id);
    }});
    return cache[name]=module.exports;
  }
  return {state,tx,serial,...load("cloudc-offline")};
}

test("Memory queue advances only after matching successful controller acknowledgement", async () => {
  const f=fixture(); await f.planOffline(f.tx,f.serial,true);
  const first=await f.offlineHeartbeat({Serial:f.serial,IndexCmd:"0",CmdOK:"1"});
  assert.equal(Buffer.from(first.CmdValue,"hex")[2],0x0d);
  const stale=await f.offlineHeartbeat({Serial:f.serial,IndexCmd:"999",CmdOK:"1"});
  assert.equal(stale.IndexCmd,first.IndexCmd);
  assert.equal(f.state.commands[0].status,"PENDING");
  const second=await f.offlineHeartbeat({Serial:f.serial,IndexCmd:first.IndexCmd,CmdOK:"1"});
  assert.equal(Buffer.from(second.CmdValue,"hex")[2],0xc1);
  assert.equal(f.state.commands[0].status,"ACKNOWLEDGED");
});

test("Disabling sync supersedes queued grants and preserves revocations across retries", async () => {
  const f=fixture(); await f.planOffline(f.tx,f.serial,true);
  f.state.config.enabled=false;
  await f.planOffline(f.tx,f.serial,true);
  let pending=f.state.commands.filter(c=>c.status==="PENDING");
  assert.equal(pending.length,1);
  assert.equal(Buffer.from(pending[0].frame,"hex")[2],0x15);
  await f.planOffline(f.tx,f.serial,true);
  pending=f.state.commands.filter(c=>c.status==="PENDING");
  assert.equal(pending.length,1);
  assert.equal(Buffer.from(pending[0].frame,"hex").readUInt32BE(7),100);
});

test("Changing an input to registration revokes stored permissions rather than granting access", async () => {
  const f=fixture(); await f.planOffline(f.tx,f.serial,true);
  f.state.rolesValid=false;
  await f.planOffline(f.tx,f.serial,true);
  const pending=f.state.commands.filter(c=>c.status==="PENDING");
  assert.equal(pending.length,1);
  assert.equal(Buffer.from(pending[0].frame,"hex")[2],0x15);
  assert.match(f.state.config.lastError,/paused/);
});

test("Unacknowledged command stops the queue after bounded retries", async () => {
  const f=fixture(); await f.planOffline(f.tx,f.serial,true);
  f.state.commands[0].attempts=3;
  f.state.commands[0].sentAt=new Date(Date.now()-11000);
  const result=await f.offlineHeartbeat({Serial:f.serial,IndexCmd:"0",CmdOK:"0"});
  assert.equal(Object.keys(result).length,0);
  assert.equal(f.state.commands[0].status,"FAILED");
  assert.match(f.state.config.lastError,/did not acknowledge/);
});
