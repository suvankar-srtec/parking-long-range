const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript");
function fixture(){
 const reader={id:"r",deviceNumber:"reader",enabled:true,buildingId:"building",mode:"ENTRY_EXIT"};
 const owner={id:"owner",buildingId:"building",isInside:true,lastAccessAt:new Date(Date.now()-10000),lastAccessDevice:"reader",rfidBlocked:false};
 const state={reader,owner,events:[],previous:null,query:null,direction:"ENTRY"};
 const tx={$queryRaw:async()=>[],rfidReader:{upsert:async()=>reader},rfidEvent:{
  findFirst:async({where})=>{state.query=where;return state.previous&&state.previous.readerId===where.readerId&&state.previous.action!=="DUPLICATE"&&state.previous.createdAt>where.createdAt.gt?state.previous:null;},
  create:async({data})=>state.events.push(data)},
  building:{findUniqueOrThrow:async()=>({enabled:true})},
  vehicle:{findUnique:async()=>null},buildingOwnerVehicle:{findUnique:async()=>owner,update:async({data})=>Object.assign(owner,data)},
  gate:{findMany:async()=>[{direction:state.direction+"::READER::r"}]},
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
 const access=load("rfid-access");return{state,scan:()=>access.processReaderScan({deviceNumber:"reader",decodedResult:"8336774"})};
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
