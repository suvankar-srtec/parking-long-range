const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const moduleResult = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/rfid-visits.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: moduleResult.exports, module: moduleResult });
const { pairVisitScans } = moduleResult.exports;
const scan = (id, action, at, extra = {}) => ({ id, entityKey:'owner:1', cardNo:'123', code:'0000', action, createdAt:`2026-10-24T${at}:00.000Z`, deviceNumber:action === 'EXIT' ? 'B' : 'A', eventType:'Online', message:'Allowed', vehicle:null, personType:'OWNER', company:null, ...extra });
test('pairs online entry with offline exit despite delayed upload order', () => {
 const rows = pairVisitScans([scan('out','EXIT','10:02',{eventType:'Offline'}),scan('in','ENTRY','10:00')]);
 assert.equal(rows.length,1); assert.equal(rows[0].entry.id,'in'); assert.equal(rows[0].exit.id,'out');
});
test('keeps multiple visits separate and leaves a current visit open', () => {
 const rows=pairVisitScans([scan('1','ENTRY','10:00'),scan('2','EXIT','10:01'),scan('3','ENTRY','10:02')]);
 assert.equal(rows.length,2);assert.equal(rows[0].entry.id,'3');assert.equal(rows[0].exit,null);assert.equal(rows[1].exit.id,'2');
});
test('denied scans cannot close visits; repeated allowed IN does not invent another visit', () => {
 const rows=pairVisitScans([scan('1','ENTRY','10:00'),scan('2','DENIED','10:01',{code:'0001'}),scan('3','ENTRY','10:02'),scan('4','EXIT','10:03')]);
 assert.equal(rows.length,2);assert.equal(rows[0].entry.id,'1');assert.equal(rows[0].exit.id,'4');assert.equal(rows[1].latest.id,'2');
});
test('uses entity identity for manual exits and never mixes visitor QR credentials', () => {
 const rows=pairVisitScans([scan('1','ENTRY','10:00',{entityKey:'visitor:1',cardNo:'VISITOR QR'}),scan('2','ENTRY','10:01',{entityKey:'visitor:2',cardNo:'VISITOR QR'}),scan('3','EXIT','10:02',{entityKey:'visitor:1',cardNo:'',deviceNumber:'MANUAL'})]);
 assert.equal(rows.length,2);assert.equal(rows[0].entry.id,'1');assert.equal(rows[0].exit.id,'3');assert.equal(rows[1].exit,null);
});
test('keeps unmatched exit visible and deduplicates retried event IDs', () => {
 const out=scan('out','EXIT','10:00'); const rows=pairVisitScans([out,out]);
 assert.equal(rows.length,1);assert.equal(rows[0].entry,null);assert.equal(rows[0].exit.id,'out');
});


test('instant search matches either side of a complete visit without splitting it', () => {
 const rows=pairVisitScans([scan('in','ENTRY','10:00',{deviceNumber:'80M236-A'}),scan('out','EXIT','10:01',{deviceNumber:'80M236-B',eventType:'Offline'})]);
 const { filterVisitRows }=moduleResult.exports;
 for(const query of ['80m236-a','  OFFLINE  ','123','exit allowed']) {
  const matches=filterVisitRows(rows,query);
  assert.equal(matches.length,1);assert.equal(matches[0].entry.id,'in');assert.equal(matches[0].exit.id,'out');
 }
 assert.equal(filterVisitRows(rows,'missing').length,0);
 assert.equal(filterVisitRows(rows,'   '),rows);
});
test('search matches employee, vehicle, company and shortened denial text', () => {
 const rows=pairVisitScans([scan('denied','DENIED','10:00',{code:'0001',message:'Owner Parking allocation is full',vehicle:{plateNumber:'WB1234',ownerName:'Alex',department:'Operations'},company:{name:'Digiraptek'}})]);
 for(const query of ['alex','wb1234','operations','digiraptek','allocation full'])assert.equal(moduleResult.exports.filterVisitRows(rows,query).length,1);
});
