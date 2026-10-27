const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript");
function fixture(){
 const reader={id:"r",deviceNumber:"reader",enabled:true,buildingId:"building",mode:"ENTRY_EXIT"};
 const owner={id:"owner",buildingId:"building",isInside:true,lastAccessAt:new Date(Date.now()-10000),lastAccessDevice:"reader",rfidBlocked:false};
 const state={reader,owner,events:[],previous:null,query:null,direction:"ENTRY",policy:{enabled:true,parkingLimitsEnabled:true,antiPassbackEnabled:true}};
 const tx={$queryRaw:async()=>[],rfidReader:{upsert:async()=>reader,findMany:async()=>state.outputs||[]},rfidEvent:{
  findFirst:async({where})=>{state.query=where;return state.previous&&state.previous.readerId===where.readerId&&state.previous.action!=="DUPLICATE"&&state.previous.createdAt>where.createdAt.gt?state.previous:null;},
  create:async({data})=>{state.events.push(data);return {id:"event"}}},
  building:{findUniqueOrThrow:async()=>state.policy},
  vehicle:{findUnique:async()=>null},buildingOwnerVehicle:{findUnique:async()=>owner,update:async({data})=>Object.assign(owner,data)},
  gate:{findMany:async()=>state.gates||[{direction:state.direction+"::READER::r"}]},
 };
 const cache={};function load(name){
  if(cache[name])return cache[name];const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync("src/lib/"+name+".ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,Date,console,require(id){
   if(id==="@/lib/prisma")return{prisma:{$transaction:async fn=>fn(tx)}};
   if(id==="@/lib/building-parking")return{lockBuildingParking:async()=>{},ParkingError:class extends Error{}};
   if(id==="@/lib/session")return{};
   if(id.startsWith("@/lib/"))return load(id.slice(6));return require(id);
  }});return cache[name]=module.exports;
 }
 const access=load("rfid-access");return{state,scan:(extra={})=>access.processReaderScan({deviceNumber:"reader",decodedResult:"8336774",...extra})};
}
test("Any card scan within one second on the same reader is duplicate and does not change occupancy",async()=>{
 const f=fixture();f.state.previous={readerId:"r",action:"ENTRY",cardNo:"different-card",createdAt:new Date()};
 const r=await f.scan();assert.equal(r.code,"0001");assert.equal(f.state.events[0].action,"DUPLICATE");assert.equal(f.state.owner.isInside,true);assert.equal(f.state.events[0].ownerVehicleId,undefined);
});
test("Repeated entry after cooldown remains duplicate until an exit",async()=>{
 const f=fixture();await f.scan();assert.equal(f.state.events[0].action,"DUPLICATE");assert.match(f.state.events[0].message,/already inside/);assert.equal(f.state.owner.isInside,true);
});
test("Exit on another reader is not blocked by an entry reader's pause",async()=>{
 const f=fixture();f.state.direction="EXIT";f.state.previous={readerId:"other",action:"ENTRY",createdAt:new Date()};
 f.state.owner.lastAccessAt=new Date();f.state.owner.lastAccessDevice="other";
 const r=await f.scan();assert.equal(r.code,"0000");assert.equal(f.state.events[0].action,"EXIT");assert.equal(f.state.owner.isInside,false);
});
test("Ignored duplicate attempts do not extend the pause",async()=>{
 const f=fixture();f.state.direction="EXIT";f.state.previous={readerId:"r",action:"DUPLICATE",createdAt:new Date()};
 assert.equal((await f.scan()).code,"0000");assert.equal(f.state.query.action.not,"DUPLICATE");
});

test("Anti-passback can be disabled independently of capacity",async()=>{ const f=fixture();f.state.policy.antiPassbackEnabled=false;assert.equal((await f.scan()).code,"0000");assert.equal(f.state.owner.isInside,true);assert.equal(f.state.events[0].action,"ENTRY"); });
test("An outside vehicle exits again when anti-passback is disabled",async()=>{ const f=fixture();f.state.policy.antiPassbackEnabled=false;f.state.owner.isInside=false;f.state.direction="EXIT";assert.equal((await f.scan()).code,"0000");assert.equal(f.state.owner.isInside,false); });
test("Disabling limits preserves anti-passback",async()=>{ const f=fixture();f.state.policy.parkingLimitsEnabled=false;assert.equal((await f.scan()).code,"0001");assert.equal(f.state.events[0].action,"DUPLICATE"); });
test("Disabling limits allows a new registered entry without querying capacities",async()=>{ const f=fixture();f.state.policy.parkingLimitsEnabled=false;f.state.owner.isInside=false;assert.equal((await f.scan()).code,"0000");assert.equal(f.state.owner.isInside,true); });

test("UHF entry mapped beside Cloud+ B uses relay A and blocks repeated entry",async()=>{const f=fixture();f.state.reader.readerProtocol="UHF_MM";f.state.reader.mode="ENTRY";f.state.owner.isInside=false;f.state.policy.parkingLimitsEnabled=false;f.state.outputs=[{id:"a",deviceNumber:"80M236-A"},{id:"b",deviceNumber:"80M236-B"}];f.state.gates=[{direction:"ENTRY_EXIT::ENTRY_READER::r::EXIT_READER::b"}];const input={relayControllerSerial:"80M236",expectedMode:"ENTRY"};const first=await f.scan(input);assert.equal(first.code,"0000");assert.equal(first.relay.index,0);assert.equal(first.relay.serial,"80M236");const second=await f.scan(input);assert.equal(second.code,"0001");assert.equal(second.relay,undefined)});

test("UHF assigned to entry never toggles to exit in combined-purpose mode",async()=>{const f=fixture();f.state.reader.readerProtocol="UHF_MM";f.state.reader.mode="ENTRY_EXIT";f.state.owner.isInside=false;f.state.policy.parkingLimitsEnabled=false;f.state.outputs=[{id:"a",deviceNumber:"80M236-A"},{id:"b",deviceNumber:"80M236-B"}];f.state.gates=[{direction:"ENTRY_EXIT::ENTRY_READER::r::EXIT_READER::b"}];const input={relayControllerSerial:"80M236",expectedMode:"ENTRY_EXIT"};assert.equal((await f.scan(input)).action,"ENTRY");const again=await f.scan(input);assert.equal(again.code,"0001");assert.equal(f.state.owner.isInside,true);assert.equal(again.relay,undefined)});

test("UHF general Entry/Exit purpose cannot override an entry-only gate lane",async()=>{const f=fixture();f.state.reader.readerProtocol="UHF_MM";f.state.reader.mode="ENTRY_EXIT";f.state.owner.isInside=true;f.state.outputs=[{id:"a",deviceNumber:"80M236-A"},{id:"b",deviceNumber:"80M236-B"}];f.state.gates=[{direction:"ENTRY_EXIT::ENTRY_READER::r::EXIT_READER::b"}];const result=await f.scan({relayControllerSerial:"80M236",expectedMode:"ENTRY_EXIT"});assert.equal(result.code,"0001");assert.equal(result.relay,undefined);assert.equal(f.state.owner.isInside,true);assert.match(result.message,/already inside/)});
test("UHF general Entry/Exit purpose cannot override an exit-only gate lane",async()=>{const f=fixture();f.state.reader.readerProtocol="UHF_MM";f.state.reader.mode="ENTRY_EXIT";f.state.owner.isInside=false;f.state.outputs=[{id:"a",deviceNumber:"80M236-A"},{id:"b",deviceNumber:"80M236-B"}];f.state.gates=[{direction:"ENTRY_EXIT::ENTRY_READER::a::EXIT_READER::r"}];const result=await f.scan({relayControllerSerial:"80M236",expectedMode:"ENTRY_EXIT"});assert.equal(result.code,"0001");assert.equal(result.relay,undefined);assert.equal(f.state.owner.isInside,false);assert.match(result.message,/already outside/)});
