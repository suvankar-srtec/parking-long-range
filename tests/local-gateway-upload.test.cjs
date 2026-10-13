const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript");
function fixture(){
 const owner={id:"owner",buildingId:"building",createdAt:new Date("2020-01-01"),lastAccessAt:null,isInside:false};const events=new Map();let requestedDevice=null;
 class ParkingError extends Error{constructor(message,status=400){super(message);this.status=status;}}
 const tx={rfidEvent:{findUnique:async({where})=>events.get(where.id)||null,create:async({data})=>events.set(data.id,data)},buildingOwnerVehicle:{findUnique:async()=>owner,update:async({data})=>Object.assign(owner,data)},vehicle:{findUnique:async()=>null}};
 let transactions=0;const prisma={$transaction:async fn=>{transactions++;return fn(tx);},rfidReader:{findUnique:async({where})=>{requestedDevice=where.deviceNumber;return{buildingId:"building",readerProtocol:"CLOUD_C"};},updateMany:async()=>({count:2})}};
 const module={exports:{}};const code=ts.transpileModule(fs.readFileSync("src/app/api/rfid/local-gateway/events/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,Date,console,require(id){
  if(id==="next/server")return{NextResponse:{json:(body,options)=>Response.json(body,options)}};
  if(id==="@/lib/prisma")return{prisma};if(id==="@/lib/local-gateway")return{authorizeLocalGateway:async request=>{if(request.headers.get('x-gateway-token')!=='test')throw new ParkingError('Unauthorized',403);return{serial:'80M236'};}};
  if(id==="@/lib/rfid-access")return{lockRfid:async()=>{},rfidApiError:e=>Response.json({ok:false},{status:e.status||500})};
  if(id==="@/lib/building-parking")return{ParkingError,lockBuildingParking:async()=>{}};return require(id);
 }});
 const event={id:"local-gateway-00000000-0000-0000-0000-000000000001",reader:"0",cardNo:"123",time:new Date(Date.now()-5000).toISOString(),action:"ENTRY",message:"Entry allowed by local gateway"};
 return{transactions:()=>transactions,owner,events,event,device:()=>requestedDevice,upload:(records,key='test')=>module.exports.POST(new Request('http://test',{method:'POST',headers:{'x-gateway-token':key},body:JSON.stringify({serial:'other-controller',events:records})}))};
}
test("Retrying an upload records exactly one entry and uses the credential-bound controller",async()=>{const f=fixture();assert.equal((await f.upload([f.event,f.event])).status,200);assert.equal(f.events.size,1);assert.equal(f.owner.isInside,true);assert.equal(f.device(),'80M236-A');});
test("Older uploaded exits cannot overwrite a newer vehicle state",async()=>{const f=fixture();await f.upload([f.event]);const old={...f.event,id:'local-gateway-00000000-0000-0000-0000-000000000002',action:'EXIT',time:new Date(Date.now()-100000).toISOString()};await f.upload([old]);assert.equal(f.owner.isInside,true);});
test("Unauthorized requests never record scans",async()=>{const f=fixture();assert.equal((await f.upload([f.event],'wrong')).status,403);assert.equal(f.events.size,0);});
test("Event ID collisions cannot acknowledge another controller's record",async()=>{const f=fixture();f.events.set(f.event.id,{buildingId:'other',deviceNumber:'other-A'});assert.equal((await f.upload([f.event])).status,409);assert.equal(f.owner.isInside,false);});

test("Heartbeat-only reports do not acquire scan reconciliation transactions",async()=>{const f=fixture();assert.equal((await f.upload([])).status,200);assert.equal(f.transactions(),0);assert.equal(f.events.size,0);});
