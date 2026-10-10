const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const vm = require("node:vm");
function fixture() {
  const owner = {id:"owner",buildingId:"building",createdAt:new Date("2026-01-01"),lastAccessAt:null,isInside:false};
  const event = {id:"history",action:"HISTORY",deviceNumber:"80M236-A"};
  let updates=0, online=null;
  const tx = {
    $queryRaw: async()=>[],
    rfidReader:{findUnique:async()=>({buildingId:"building"})},
    rfidEvent:{findUnique:async()=>event,findFirst:async()=>online,update:async({data})=>Object.assign(event,data)},
    buildingOwnerVehicle:{findUnique:async()=>owner,update:async({data})=>{updates++;Object.assign(owner,data);}},
    vehicle:{findUnique:async()=>null},
  };
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync("src/lib/cloudc-history-reconcile.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,Date,console,require(id){
    if(id.endsWith("building-parking"))return{lockBuildingParking:async()=>{}};
    return{};
  }});
  const packet={Serial:"80M236",type:"100",EventType:"11",Card:"8336774"};
  return {owner,event,packet,run:(time=new Date("2026-10-10T12:00:00Z"))=>module.exports.reconcileHistory(tx,"history",packet,time),updates:()=>updates,setOnline:()=>{online={id:"online"};}};
}
test("Offline entry updates shared vehicle state and creates one successful activity",async()=>{
 const f=fixture();await f.run();assert.equal(f.owner.isInside,true);assert.equal(f.event.action,"ENTRY");assert.equal(f.event.code,"0000");await f.run();assert.equal(f.updates(),1);
});
test("Exit updates outside state; an older entry cannot overwrite it",async()=>{
 const f=fixture();f.owner.isInside=true;f.packet.EventType="10";await f.run();assert.equal(f.owner.isInside,false);
 f.event.action="HISTORY";f.packet.EventType="11";await f.run(new Date("2026-10-10T11:00:00Z"));assert.equal(f.owner.isInside,false);
});
test("Online scan history is linked without double counting or changing occupancy",async()=>{
 const f=fixture();f.setOnline();await f.run();assert.equal(f.event.action,"SYNCED");assert.equal(f.updates(),0);
});
test("Rejected cards, alarms, unknown controllers, missing and future times never change occupancy",async()=>{
 for(const override of [{EventType:"1"},{type:"101"},{Serial:"other"}]){const f=fixture();Object.assign(f.packet,override);await f.run();assert.equal(f.updates(),0);assert.equal(f.event.action,"HISTORY");}
 for(const time of [null,new Date(Date.now()+3600000)]){const f=fixture();await f.run(time);assert.equal(f.updates(),0);}
});
