const test=require("node:test"),assert=require("node:assert/strict"),ts=require("typescript"),fs=require("node:fs"),vm=require("node:vm");
function fixture(fail=false){
 const state={callbacks:[],reconciled:0,errors:[]};const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync("src/lib/cloudc-http.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,Response,URL,performance,console:{error:(...args)=>state.errors.push(args),warn:()=>{}},require(id){
  if(id==="next/server")return{after:callback=>state.callbacks.push(callback)};
  if(id==="@/lib/cloudc-history-reconcile")return{reconcileStoredHistory:async()=>{state.reconciled++;if(fail)throw Error("Backfill failed");}};
  if(id==="@/lib/prisma")return{prisma:{rfidReader:{updateMany:async()=>({count:2})}}};
  if(id==="@/lib/rfid-http")return{validReaderToken:()=>true};
  if(id==="@/lib/rfid-reader")return{readReaderBody:request=>request.text()};
  if(id==="@/lib/rfid-access")return{};
  if(id==="@/lib/cloudc-protocol")return{parseCloudPacket:raw=>JSON.parse(raw),cloudInputDevice:(serial,input)=>serial+(input==="0"?"-A":"-B"),cloudReply:fields=>"DATA="+JSON.stringify(fields)};
  if(id==="@/lib/cloudc-offline")return{offlineHeartbeat:async()=>({IndexCmd:"123",CmdValue:"frame"})};
  return require(id);
 }});
 return{state,handle:()=>module.exports.handleCloudHttp(new Request("http://test/api?token=test",{method:"POST",body:JSON.stringify({Serial:"80M236",Key:"321"})}),true)};
}
test("Heartbeat returns key and queued command before history backfill runs",async()=>{
 const f=fixture();const response=await f.handle();assert.equal(response.status,200);assert.deepEqual(JSON.parse((await response.text()).slice(5)),{Key:"321",IndexCmd:"123",CmdValue:"frame"});
 assert.equal(f.state.reconciled,0);assert.equal(f.state.callbacks.length,1);await f.state.callbacks[0]();assert.equal(f.state.reconciled,1);
});
test("Background history failure cannot turn a heartbeat into rejection",async()=>{
 const f=fixture(true);assert.equal((await f.handle()).status,200);await f.state.callbacks[0]();assert.equal(f.state.errors[0][0],"CLOUDC_HISTORY_RECONCILE_FAILED");
});
