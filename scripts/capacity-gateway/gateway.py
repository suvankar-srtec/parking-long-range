"""LAN gateway: SQLite capacity checks, crash-safe outbox, cloud reconciliation."""
import argparse, hashlib, contextlib, datetime as dt, hmac, json, logging, pathlib, re, sqlite3, ssl, threading, time, urllib.request, urllib.parse, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def utc(ms=None):
    return dt.datetime.fromtimestamp((ms if ms is not None else time.time()*1000)/1000,dt.timezone.utc).isoformat()
def millis(value):
    return int(dt.datetime.fromisoformat(value.replace("Z","+00:00")).timestamp()*1000) if value else 0

def scan_reply(packet,result):
    output='0' if result.get('action')=='ENTRY' else '1' if result.get('action')=='EXIT' else str(packet['Reader'])
    return {'AcsRes':'1' if result['allowed'] else '0','Reader':str(packet['Reader']),'ActIndex':output,'Time':'1','Card':str(packet.get('Card','')),'Note':result['message'][:31]}

class Ledger:
    def __init__(self,path):
        self.path=str(path)
        with self.db() as c:
            c.executescript("""PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS settings(serial TEXT PRIMARY KEY, manifest TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS cards(building TEXT,card TEXT,pool TEXT,category TEXT,company TEXT,allowed INTEGER,inside INTEGER,access_ms INTEGER,PRIMARY KEY(building,card));
              CREATE TABLE IF NOT EXISTS cooldown(serial TEXT,reader TEXT,last_ms INTEGER,PRIMARY KEY(serial,reader));
              CREATE TABLE IF NOT EXISTS presentations(serial TEXT,reader TEXT,card TEXT,last_ms INTEGER,PRIMARY KEY(serial,reader,card));
              CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,serial TEXT,building TEXT,event TEXT);
              CREATE TABLE IF NOT EXISTS controller_history(id TEXT PRIMARY KEY,serial TEXT,packet TEXT);
            """)
    @contextlib.contextmanager
    def db(self):
        c=sqlite3.connect(self.path,timeout=10);c.row_factory=sqlite3.Row
        try:
            # Persist the occupancy change and queued event before approving a relay.
            c.execute('PRAGMA synchronous=FULL')
            c.execute("BEGIN IMMEDIATE");yield c;c.commit()
        except Exception:c.rollback();raise
        finally:c.close()
    def snapshot(self,manifest):
        with self.db() as c:
            b=manifest['buildingId']
            if c.execute('SELECT 1 FROM outbox WHERE building=? LIMIT 1',(b,)).fetchone():return False
            c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',(manifest['serial'],json.dumps(manifest)))
            c.execute('UPDATE cards SET allowed=0 WHERE building=?',(b,))
            seen=set()
            for card in manifest['cards']:
                key=card['cardNo']
                if key in seen:raise ValueError('Ambiguous card identifier')
                seen.add(key);old=c.execute('SELECT * FROM cards WHERE building=? AND card=?',(b,key)).fetchone();at=millis(card.get('lastAccessAt'))
                inside=int(card['isInside']) if not old or at>=old['access_ms'] else old['inside']
                c.execute('INSERT OR REPLACE INTO cards VALUES (?,?,?,?,?,?,?,?)',(b,key,card['pool'],card['category'],card.get('companyId'),int(card['allowed']),inside,max(at,old['access_ms'] if old else 0)))
            return True
    def direction(self,serial,reader):
        with self.db() as c:
            row=c.execute('SELECT manifest FROM settings WHERE serial=?',(serial,)).fetchone()
            return json.loads(row['manifest'])['directions'].get(reader,'DISABLED') if row else 'DISABLED'
    def pending(self,serial):
        with self.db() as c:return [json.loads(r['event']) for r in c.execute('SELECT event FROM outbox WHERE serial=? ORDER BY rowid LIMIT 20',(serial,))]
    def pending_count(self,serial):
        with self.db() as c:return c.execute('SELECT COUNT(*) FROM outbox WHERE serial=?',(serial,)).fetchone()[0]
    def acknowledge(self,ids):
        with self.db() as c:c.executemany('DELETE FROM outbox WHERE id=?',[(i,) for i in ids])
    def save_controller_history(self,packet):
        kind=str(packet.get('type',packet.get('Type','')))
        index='IndexEvent' if kind=='100' else 'IndexAlarm' if kind=='101' else None
        if index is None or not str(packet.get(index,'')).isdigit():raise ValueError('Invalid controller history index')
        raw=json.dumps(packet,sort_keys=True,separators=(',',':'))
        identity=hashlib.sha256(raw.encode()).hexdigest()
        with self.db() as c:c.execute('INSERT OR IGNORE INTO controller_history VALUES (?,?,?)',(identity,str(packet['Serial']),raw))
        return {index:str(packet[index])}
    def history_pending(self,serial):
        with self.db() as c:return [(row['id'],json.loads(row['packet'])) for row in c.execute('SELECT id,packet FROM controller_history WHERE serial=? ORDER BY rowid LIMIT 20',(serial,))]
    def history_count(self,serial):
        with self.db() as c:return c.execute('SELECT COUNT(*) FROM controller_history WHERE serial=?',(serial,)).fetchone()[0]
    def history_acknowledge(self,identity):
        with self.db() as c:c.execute('DELETE FROM controller_history WHERE id=?',(identity,))
    def reconcile_native_history(self,packet,utc_offset_minutes=0):
        # Only these successful movement codes are verified on this controller.
        if str(packet.get('Serial'))!='80M236' or str(packet.get('type',packet.get('Type')))!='100':return
        event=str(packet.get('EventType'))
        if event not in ('10','11'):return
        try:
            raw=str(packet.get('EventTime',''))
            date=dt.datetime.strptime(raw,'%Y%m%d%H%M%S') if re.fullmatch(r'\d{14}',raw) else dt.datetime.fromisoformat(raw.replace('/','-').replace('Z','+00:00'))
            if date.tzinfo is None:date=date.replace(tzinfo=dt.timezone(dt.timedelta(minutes=utc_offset_minutes)))
            at=int(date.timestamp()*1000)
            if at>int(time.time()*1000)+300000:return
        except (ValueError,OverflowError):return
        with self.db() as c:
            row=c.execute('SELECT manifest FROM settings WHERE serial=?',(packet['Serial'],)).fetchone()
            if row:
                building=json.loads(row['manifest'])['buildingId']
                c.execute('UPDATE cards SET inside=?,access_ms=? WHERE building=? AND card=? AND access_ms<?',
                          (int(event=='11'),at,building,str(packet.get('Card','')),at))
    def scan(self,serial,reader,card,now=None):
        now=int(time.time()*1000) if now is None else now
        with self.db() as c:
            stored=c.execute('SELECT manifest FROM settings WHERE serial=?',(serial,)).fetchone()
            if not stored:return {'allowed':False,'message':'Gateway configuration unavailable','action':'DENIED'}
            m=json.loads(stored['manifest']);b=m['buildingId'];row=c.execute('SELECT * FROM cards WHERE building=? AND card=?',(b,card)).fetchone()
            def finish(action,message,inside=None):
                event={'id':'local-gateway-'+str(uuid.uuid4()),'reader':reader,'cardNo':card,'time':utc(now),'action':action,'message':message}
                if inside is not None:c.execute('UPDATE cards SET inside=?,access_ms=? WHERE building=? AND card=?',(int(inside),now,b,card))
                c.execute('INSERT INTO outbox VALUES (?,?,?,?)',(event['id'],serial,b,json.dumps(event)))
                return {'allowed':action in ['ENTRY','EXIT'],'action':action,'message':message}
            if m['directions'].get(reader)=='ENTRY_EXIT':
                prior_tag=c.execute('SELECT last_ms FROM presentations WHERE serial=? AND reader=? AND card=?',(serial,reader,card)).fetchone()
                c.execute('INSERT OR REPLACE INTO presentations VALUES (?,?,?,?)',(serial,reader,card,now))
                if prior_tag and now-prior_tag['last_ms']<3000:return finish('DUPLICATE','Repeated tag read ignored; remove tag for 3 seconds')
            prior=c.execute('SELECT last_ms FROM cooldown WHERE serial=? AND reader=?',(serial,reader)).fetchone()
            if prior and now-prior['last_ms']<1000:return finish('DUPLICATE','Duplicate scan: reader pauses for 1 second')
            c.execute('INSERT OR REPLACE INTO cooldown VALUES (?,?,?)',(serial,reader,now))
            if not row:return finish('DENIED','RFID card is not registered')
            direction=m['directions'].get(reader,'DISABLED')
            if direction not in ['ENTRY','EXIT','ENTRY_EXIT']:return finish('DENIED','Reader purpose is not configured for access')
            enter=direction=='ENTRY' or direction=='ENTRY_EXIT' and not row['inside']
            if enter and row['inside'] and m.get('antiPassbackEnabled',True):return finish('DUPLICATE','Duplicate entry: vehicle is already inside')
            if not enter:
                if not row['inside'] and m.get('antiPassbackEnabled',True):return finish('IGNORED','Vehicle is already outside')
                return finish('EXIT','Exit allowed by local gateway',False)
            if now>=millis(m['leaseUntil']):return finish('DENIED','Offline permissions expired; restore internet connection')
            if not row['allowed']:return finish('DENIED','RFID card is blocked or inactive')
            if not m.get('parkingLimitsEnabled',True) or row['inside']:
                return finish('ENTRY','Entry allowed by local gateway',True)
            counts=c.execute('SELECT pool,company,category,COUNT(*) n FROM cards WHERE building=? AND inside=1 GROUP BY pool,company,category',(b,)).fetchall()
            total=sum(r['n'] for r in counts)+m.get('visitorInside',0)
            owners=sum(r['n'] for r in counts if r['pool']=='owner')
            company_total=sum(r['n'] for r in counts if r['pool']=='company')+m.get('companyVisitorInside',0)
            if total>=m['limits']['total']:return finish('DENIED','Building parking allocation is full')
            if row['pool']=='owner' and owners>=m['limits']['owner']:return finish('DENIED','Allocation full')
            if row['pool']=='company':
                company=next((r for r in m['companies'] if r['id']==row['company']),None)
                occupied=sum(r['n'] for r in counts if r['company']==row['company'] and r['category']==row['category'])
                limit=company['ownerParkingAllocation' if row['category']=='OWNER' else 'employeeParkingAllocation'] if company else 0
                if not company or not company['enabled'] or occupied>=limit or company_total>=m['limits']['company']:return finish('DENIED','Company parking allocation is full')
            return finish('ENTRY','Entry allowed by local gateway',True)

class Gateway:
    def __init__(self,config):
        self.config=config;self.ledger=Ledger(config['database']);self.contact=None;self.stop=threading.Event();self.last_sync_error=None;self.last_scan_reply=None;self.scan_ready=threading.Event();self.last_config_error=None
        self.cloud_paused_until=0
        self.native_lock=threading.Lock();self.native_ready=threading.Event()
        self.native_packet=None;self.native_command={};self.native_error=None
    def pause_cloud_for_test(self,seconds):
        if not isinstance(seconds,int) or isinstance(seconds,bool) or not 0<=seconds<=300:
            raise ValueError('Offline test must last between 0 and 300 seconds')
        self.cloud_paused_until=time.monotonic()+seconds
    def offline_test_remaining(self):
        return max(0,int(self.cloud_paused_until-time.monotonic()+0.999))
    def cloud(self,path,data=None,controller=False):
        if time.monotonic()<self.cloud_paused_until:
            raise OSError('Temporary offline test: cloud requests paused; local authorization remains active')
        headers={'Content-Type':'application/json'}
        if not controller:headers['x-gateway-token']=self.config['gateway_token']
        request=urllib.request.Request(self.config['cloud_base']+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
        with urllib.request.urlopen(request,timeout=15) as response:return response.read()
    def native_heartbeat_fields(self,packet):
        self.contact=utc()
        if not self.config.get('native_fallback'):return {}
        with self.native_lock:
            self.native_packet={key:str(packet[key]) for key in ('Serial','Key','IndexCmd','CmdOK') if key in packet}
            command=dict(self.native_command)
        self.native_ready.set()
        # Do not execute an already acknowledged command while the cloud catches up.
        if command.get('IndexCmd')==str(packet.get('IndexCmd')) and str(packet.get('CmdOK'))=='1':return {}
        return command
    def sync_native_memory_once(self):
        with self.native_lock:packet=dict(self.native_packet) if self.native_packet else None
        # Cached memory-sync packets are not proof of a live controller.
        if not packet or not self.contact or not 0 <= time.time()*1000-millis(self.contact) <= 15000:return
        raw=self.cloud('/api/AcsDataApi/RequestStatus?'+urllib.parse.urlencode({'token':self.config['controller_token']}),packet,True).decode()
        response=json.loads(raw[5:] if raw.startswith('DATA=') else raw)
        command={}
        if response.get('CmdValue'):
            index=str(response.get('IndexCmd',''));value=str(response['CmdValue'])
            if not re.fullmatch(r'\d{1,10}',index) or not re.fullmatch(r'[0-9a-fA-F]{18,2048}',value):raise ValueError('Invalid memory command')
            frame=bytes.fromhex(value)
            # Memory updates only: never proxy relay/alarm/fire commands in heartbeats.
            if frame[0]!=2 or frame[-1]!=3 or frame[2] not in (0x0d,0xc1,0x15) or int.from_bytes(frame[5:7],'little')!=len(frame)-9:raise ValueError('Unexpected memory command')
            checksum=0
            for byte in frame[:-2]:checksum^=byte
            if checksum!=frame[-2]:raise ValueError('Invalid memory checksum')
            # Explicit controller fallback override. Gateway decisions still use the
            # building's antiPassbackEnabled policy; only native timezone APB changes.
            if self.config.get('native_anti_passback') is False and frame[2]==0x0d:
                if len(frame)!=21:raise ValueError('Unexpected timezone command length')
                updated=bytearray(frame);updated[13]&=0x7f
                updated[-2]=0
                for byte in updated[:-2]:updated[-2]^=byte
                value=updated.hex().upper()
            command={'IndexCmd':index,'CmdValue':value}
        with self.native_lock:self.native_command=command
        self.native_error=None
    def sync_native_memory(self):
        while not self.stop.is_set():
            self.native_ready.clear()
            try:self.sync_native_memory_once()
            except Exception as error:
                self.native_error=type(error).__name__
                logging.warning('Native memory synchronization unavailable (%s)',type(error).__name__)
            self.native_ready.wait(5)
    def heartbeat(self):
        # Do not let queued scan uploads or manifest refreshes delay contact reports.
        while not self.stop.is_set():
            if self.contact:
                try:
                    result=json.loads(self.cloud('/api/rfid/local-gateway/events',{'events':[],'contactAt':self.contact}))
                    if not result.get('ok'):raise ValueError('Heartbeat rejected')
                except Exception as error:
                    logging.warning('Cloud heartbeat unavailable (%s)',type(error).__name__)
            self.stop.wait(5)
    def refresh(self):
        while not self.stop.is_set():
            try:
                if not self.ledger.pending(self.config['serial']):
                    m=json.loads(self.cloud('/api/rfid/local-gateway/config'))
                    if not m.get('ok') or m['serial']!=self.config['serial']:raise ValueError('Invalid controller configuration')
                    self.ledger.snapshot(m)
                    self.last_config_error=None
            except Exception as error:
                self.last_config_error=type(error).__name__
                logging.warning('Cloud configuration unavailable (%s)',type(error).__name__)
            self.stop.wait(5)
    def upload_controller_history(self):
        for identity,packet in self.ledger.history_pending(self.config['serial']):
            raw=self.cloud('/api/AcsDataApi/RequestCardEvent?'+urllib.parse.urlencode({'token':self.config['controller_token']}),packet,True)
            response=json.loads(raw.decode().removeprefix('DATA='))
            index='IndexEvent' if str(packet.get('type',packet.get('Type')))=='100' else 'IndexAlarm'
            if str(response.get(index,''))!=str(packet[index]):raise ValueError('Controller history upload not acknowledged')
            self.ledger.history_acknowledge(identity)
    def sync(self):
        while not self.stop.is_set():
            self.scan_ready.clear()
            try:
                pending=self.ledger.pending(self.config['serial'])
                if pending:
                    result=json.loads(self.cloud('/api/rfid/local-gateway/events',{'events':pending,'contactAt':self.contact}))
                    if not result.get('ok'):raise ValueError('Cloud synchronization rejected')
                    acknowledged=set(result.get('acknowledged',[])) & {r['id'] for r in pending}
                    self.ledger.acknowledge(acknowledged)
                    if acknowledged and self.ledger.pending(self.config['serial']):self.scan_ready.set()
                    self.last_sync_error=None
                self.upload_controller_history()
                self.last_sync_error=None
            except Exception as error:
                self.last_sync_error=type(error).__name__
                logging.warning('Cloud unavailable (%s); retaining local capacity ledger',type(error).__name__)
            self.scan_ready.wait(5)
    def handler(self):
        gateway=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            protocol_version='HTTP/1.1'
            def reply(self,raw,status=200,content_type='text/plain'):
                self.send_response(status);self.send_header('Content-Type',content_type)
                self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store')
                self.send_header('Connection','close' if self.close_connection else 'keep-alive');self.end_headers();self.wfile.write(raw);self.wfile.flush()

            def do_GET(self):
                if self.path=='/health':
                    self.reply(json.dumps({'ok':True,'cloudError':gateway.last_sync_error,'configError':gateway.last_config_error,'queued':gateway.ledger.pending_count(gateway.config['serial']),'queuedHistory':gateway.ledger.history_count(gateway.config['serial']),'controllerContact':gateway.contact,'lastScanReply':gateway.last_scan_reply,'offlineTestRemainingSeconds':gateway.offline_test_remaining(),'nativeFallbackEnabled':bool(gateway.config.get('native_fallback')),'nativeMemoryError':gateway.native_error}).encode(),content_type='application/json');return
                self.do_POST()
            def do_POST(self):
                started=time.monotonic()
                try:
                    path=urllib.parse.urlsplit(self.path);query=urllib.parse.parse_qs(path.query)
                    if not hmac.compare_digest(query.get('token',[''])[0],gateway.config['controller_token']):self.reply(b'',403);return
                    if self.client_address[0]!=gateway.config['controller_ip']:self.reply(b'',403);return
                    size=int(self.headers.get('Content-Length','0'))
                    if size>4096:raise ValueError('Oversized packet')
                    packet=json.loads(self.rfile.read(size)) if size else {k:v[0] for k,v in query.items()}
                    if str(packet.get('Serial','')).strip()!=gateway.config['serial']:raise ValueError('Wrong controller')
                    gateway.contact=utc()
                    if path.path.endswith('RequestStatus'):
                        if not str(packet.get('Key','')).isdigit():raise ValueError('Missing heartbeat key')
                        fields={'Key':str(packet['Key'])}
                        fields.update(gateway.native_heartbeat_fields(packet))
                    elif str(packet.get('type',packet.get('Type',''))) in ['100','101']:
                        # Acknowledge only after a durable local commit. Never wait
                        # for WAN/cloud on the controller's history connection.
                        fields=gateway.ledger.save_controller_history(packet)
                        gateway.ledger.reconcile_native_history(packet,gateway.config.get('controller_utc_offset_minutes',0))
                        self.reply(('DATA='+json.dumps(fields,separators=(',',':'))).encode())
                        gateway.scan_ready.set()
                        logging.info('Controller history saved locally; type=%s',str(packet.get('type',packet.get('Type'))))
                        return
                    elif str(packet.get('type',packet.get('Type','')))=='0' and str(packet.get('Reader')) in ['0','1']:
                        if gateway.ledger.direction(gateway.config['serial'],str(packet['Reader']))=='REGISTER':
                            raw=gateway.cloud('/api/AcsDataApi/RequestCardEvent?'+urllib.parse.urlencode({'token':gateway.config['controller_token']}),packet,True)
                            self.reply(raw);return
                        result=gateway.ledger.scan(gateway.config['serial'],str(packet['Reader']),str(packet.get('Card','')))
                        fields=scan_reply(packet,result)
                    else:fields={'AcsRes':'0'}
                    self.reply(('DATA='+json.dumps(fields,separators=(',',':'))).encode())
                    if str(packet.get('type',packet.get('Type','')))=='0':
                        gateway.last_scan_reply={'at':utc(),'reader':str(packet.get('Reader')),'allowed':fields.get('AcsRes')=='1','output':fields.get('ActIndex'),'seconds':fields.get('Time'),'elapsedMs':round((time.monotonic()-started)*1000,1),'reportedStatus':str(packet.get('Status',''))}
                        gateway.scan_ready.set()
                        logging.info('Scan reply: reader=%s allowed=%s elapsedMs=%s status=%s',gateway.last_scan_reply['reader'],gateway.last_scan_reply['allowed'],gateway.last_scan_reply['elapsedMs'],gateway.last_scan_reply['reportedStatus'])
                except Exception as error:
                    logging.warning('Gateway request failed (%s)',type(error).__name__)
                    try:self.reply(b'DATA={"AcsRes":"0"}')
                    except OSError:pass
        return Handler

class ConcurrentTLSServer(ThreadingHTTPServer):
    """Perform TLS negotiation in each worker, never in the accept loop."""
    daemon_threads=True
    def process_request_thread(self,request,client_address):
        try:
            request.settimeout(5)
            secure=self.tls_context.wrap_socket(request,server_side=True)
        except (OSError,ssl.SSLError):
            request.close()
            return
        super().process_request_thread(secure,client_address)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True)
    parser.add_argument('--offline-test-seconds',type=int,default=0,help='Temporarily pause only cloud requests, for 0-300 seconds; LAN stays active')
    args=parser.parse_args()
    if not 0<=args.offline_test_seconds<=300:parser.error('--offline-test-seconds must be between 0 and 300')
    config=json.loads(pathlib.Path(args.config).read_text(encoding='utf-8-sig'))
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(message)s',filename=config.get('log'))
    gateway=Gateway(config);gateway.pause_cloud_for_test(args.offline_test_seconds)
    threading.Thread(target=gateway.sync,daemon=True).start();threading.Thread(target=gateway.heartbeat,daemon=True).start();threading.Thread(target=gateway.refresh,daemon=True).start()
    if config.get('native_fallback'):threading.Thread(target=gateway.sync_native_memory,daemon=True).start()
    server_class=ConcurrentTLSServer if config.get('certificate') else ThreadingHTTPServer
    server=server_class((config.get('bind','0.0.0.0'),config.get('port',8765)),gateway.handler())
    if config.get('certificate'):
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(config['certificate'],config['private_key']);server.tls_context=context
    try:server.serve_forever()
    finally:gateway.stop.set();server.server_close()
if __name__=='__main__':main()
