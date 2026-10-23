const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/rfid-display.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports});
test('Uploaded native controller history is Offline regardless of current connectivity',()=>{
 assert.equal(mod.exports.scanEventType({id:'cloudc-history-abc',deviceNumber:'80M236-A'}),'Offline');
});
test('Live gateway and direct reader records are Online',()=>{
 for(const id of ['local-gateway-abc','direct-reader-event']) assert.equal(mod.exports.scanEventType({id,deviceNumber:'80M236-B'}),'Online');
});
test('Manual exits do not claim to be controller scans',()=>{
 assert.equal(mod.exports.scanEventType({id:'manual-exit',deviceNumber:'MANUAL'}),null);
});
