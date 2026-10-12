import test from "node:test";
import assert from "node:assert/strict";
import {readerStatus,readerServerClockOffset} from "../src/lib/reader-status.ts";
const now=Date.parse("2026-10-12T10:00:00Z");
const reader={connectionType:"HTTP",tcpConnected:false,lastGatewaySeenAt:null,lastSeenAt:new Date(now-5000).toISOString(),heartbeatSeconds:5,enabled:true,buildingId:"building"};
test("Idle readers with fresh heartbeats stay online despite browser clock drift",()=>{
 for(const drift of [-120000,120000]){const browserNow=now+drift;const offset=readerServerClockOffset(new Date(now).toISOString(),browserNow);assert.equal(readerStatus(reader,browserNow+offset).tone,"online");}
});
test("Missing heartbeats still go offline with a corrected browser clock",()=>{
 const browserNow=now+120000;const offset=readerServerClockOffset(new Date(now).toISOString(),browserNow);
 assert.equal(readerStatus({...reader,lastSeenAt:new Date(now-20000).toISOString()},browserNow+offset).tone,"offline");
});
test("Clock adjustment advances normally between refreshes and tolerates absent server times",()=>{
 const offset=readerServerClockOffset(new Date(now).toISOString(),now+120000);
 assert.equal(readerStatus(reader,now+120000+12000+offset).tone,"offline");
 assert.equal(readerServerClockOffset(),0);assert.equal(readerServerClockOffset("bad"),0);
});
