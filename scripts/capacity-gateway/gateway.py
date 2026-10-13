"""LAN gateway: SQLite capacity checks, crash-safe outbox, cloud reconciliation."""
import argparse, contextlib, datetime as dt, hmac, json, logging, pathlib, sqlite3, ssl, threading, time, urllib.request, urllib.parse, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def utc(ms=None):
    return dt.datetime.fromtimestamp((ms if ms is not None else time.time()*1000)/1000,dt.timezone.utc).isoformat()
def millis(value):
    return int(dt.datetime.fromisoformat(value.replace("Z","+00:00")).timestamp()*1000) if value else 0

class Ledger:
    def __init__(self,path):
        self.path=str(path)
        with self.db() as c:
            c.executescript("""PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS settings(serial TEXT PRIMARY KEY, manifest TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS cards(building TEXT,card TEXT,pool TEXT,category TEXT,company TEXT,allowed INTEGER,inside INTEGER,access_ms INTEGER,PRIMARY KEY(building,card));
              CREATE TABLE IF NOT EXISTS cooldown(serial TEXT,reader TEXT,last_ms INTEGER,PRIMARY KEY(serial,reader));
              CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,serial TEXT,building TEXT,event TEXT);
            """)
    @contextlib.contextmanager
    def db(self):
        c=sqlite3.connect(self.path,timeout=10);c.row_factory=sqlite3.Row
        try:
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
    def acknowledge(self,ids):
        with self.db() as c:c.executemany('DELETE FROM outbox WHERE id=?',[(i,) for i in ids])
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
            prior=c.execute('SELECT last_ms FROM cooldown WHERE serial=? AND reader=?',(serial,reader)).fetchone()
            if prior and now-prior['last_ms']<1000:return finish('DUPLICATE','Duplicate scan: reader pauses for 1 second')
            c.execute('INSERT OR REPLACE INTO cooldown VALUES (?,?,?)',(serial,reader,now))
            if not row:return finish('DENIED','RFID card is not registered')
            direction=m['directions'].get(reader,'DISABLED')
            if direction not in ['ENTRY','EXIT','ENTRY_EXIT']:return finish('DENIED','Reader purpose is not configured for access')
            enter=direction=='ENTRY' or direction=='ENTRY_EXIT' and not row['inside']
            if enter and row['inside']:return finish('DUPLICATE','Duplicate entry: vehicle is already inside')
            if not enter:
                if not row['inside']:return finish('IGNORED','Vehicle is already outside')
                return finish('EXIT','Exit allowed by local gateway',False)
            if now>=millis(m['leaseUntil']):return finish('DENIED','Offline permissions expired; restore internet connection')
            if not row['allowed']:return finish('DENIED','RFID card is blocked or inactive')
            counts=c.execute('SELECT pool,company,category,COUNT(*) n FROM cards WHERE building=? AND inside=1 GROUP BY pool,company,category',(b,)).fetchall()
            total=sum(r['n'] for r in counts)+m.get('visitorInside',0)
            owners=sum(r['n'] for r in counts if r['pool']=='owner')
            company_total=sum(r['n'] for r in counts if r['pool']=='company')+m.get('companyVisitorInside',0)
            if total>=m['limits']['total']:return finish('DENIED','Building parking allocation is full')
            if row['pool']=='owner' and owners>=m['limits']['owner']:return finish('DENIED','Owner Parking allocation is full')
            if row['pool']=='company':
                company=next((r for r in m['companies'] if r['id']==row['company']),None)
                occupied=sum(r['n'] for r in counts if r['company']==row['company'] and r['category']==row['category'])
                limit=company['ownerParkingAllocation' if row['category']=='OWNER' else 'employeeParkingAllocation'] if company else 0
                if not company or not company['enabled'] or occupied>=limit or company_total>=m['limits']['company']:return finish('DENIED','Company parking allocation is full')
            return finish('ENTRY','Entry allowed by local gateway',True)

class Gateway:
    def __init__(self,config):
        self.config=config;self.ledger=Ledger(config['database']);self.contact=None;self.stop=threading.Event();self.last_sync_error=None
    def cloud(self,path,data=None,controller=False):
        headers={'Content-Type':'application/json'}
        if not controller:headers['x-gateway-token']=self.config['gateway_token']
        request=urllib.request.Request(self.config['cloud_base']+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
        with urllib.request.urlopen(request,timeout=15) as response:return response.read()
    def sync(self):
        while not self.stop.is_set():
            try:
                pending=self.ledger.pending(self.config['serial'])
                result=json.loads(self.cloud('/api/rfid/local-gateway/events',{'events':pending,'contactAt':self.contact}))
                if not result.get('ok'):raise ValueError('Cloud synchronization rejected')
                acknowledged=set(result.get('acknowledged',[])) & {r['id'] for r in pending};self.ledger.acknowledge(acknowledged)
                if not self.ledger.pending(self.config['serial']):
                    m=json.loads(self.cloud('/api/rfid/local-gateway/config'))
                    if not m.get('ok') or m['serial']!=self.config['serial']:raise ValueError('Invalid controller configuration')
                    self.ledger.snapshot(m)
                self.last_sync_error=None
            except Exception as error:
                self.last_sync_error=type(error).__name__
                logging.warning('Cloud unavailable (%s); retaining local capacity ledger',type(error).__name__)
            self.stop.wait(5)
    def handler(self):
        gateway=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                if self.path=='/health':
                    self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'ok':True,'cloudError':gateway.last_sync_error,'queued':len(gateway.ledger.pending(gateway.config['serial'])),'controllerContact':gateway.contact}).encode());return
                self.do_POST()
            def do_POST(self):
                try:
                    path=urllib.parse.urlsplit(self.path);query=urllib.parse.parse_qs(path.query)
                    if not hmac.compare_digest(query.get('token',[''])[0],gateway.config['controller_token']):self.send_response(403);self.end_headers();return
                    if self.client_address[0]!=gateway.config['controller_ip']:self.send_response(403);self.end_headers();return
                    size=int(self.headers.get('Content-Length','0'))
                    if size>4096:raise ValueError('Oversized packet')
                    packet=json.loads(self.rfile.read(size)) if size else {k:v[0] for k,v in query.items()}
                    if str(packet.get('Serial','')).strip()!=gateway.config['serial']:raise ValueError('Wrong controller')
                    gateway.contact=utc()
                    if path.path.endswith('RequestStatus'):
                        if not str(packet.get('Key','')).isdigit():raise ValueError('Missing heartbeat key')
                        fields={'Key':str(packet['Key'])}
                    elif str(packet.get('type',packet.get('Type',''))) in ['100','101']:
                        raw=gateway.cloud('/api/AcsDataApi/RequestCardEvent?'+urllib.parse.urlencode({'token':gateway.config['controller_token']}),packet,True)
                        self.send_response(200);self.send_header('Content-Type','text/plain');self.end_headers();self.wfile.write(raw);return
                    elif str(packet.get('type',packet.get('Type','')))=='0' and str(packet.get('Reader')) in ['0','1']:
                        if gateway.ledger.direction(gateway.config['serial'],str(packet['Reader']))=='REGISTER':
                            raw=gateway.cloud('/api/AcsDataApi/RequestCardEvent?'+urllib.parse.urlencode({'token':gateway.config['controller_token']}),packet,True)
                            self.send_response(200);self.send_header('Content-Type','text/plain');self.end_headers();self.wfile.write(raw);return
                        result=gateway.ledger.scan(gateway.config['serial'],str(packet['Reader']),str(packet.get('Card','')))
                        fields={'AcsRes':'1' if result['allowed'] else '0','Reader':str(packet['Reader']),'ActIndex':str(packet['Reader']),'Time':'1','Card':str(packet.get('Card','')),'Note':result['message'][:31]}
                    else:fields={'AcsRes':'0'}
                    self.send_response(200);self.send_header('Content-Type','text/plain');self.end_headers();self.wfile.write(('DATA='+json.dumps(fields,separators=(',',':'))).encode())
                except Exception as error:
                    logging.warning('Gateway request failed (%s)',type(error).__name__)
                    try:self.send_response(200);self.end_headers();self.wfile.write(b'DATA={"AcsRes":"0"}')
                    except OSError:pass
        return Handler

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    config=json.loads(pathlib.Path(args.config).read_text(encoding='utf-8-sig'))
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(message)s',filename=config.get('log'))
    gateway=Gateway(config);threading.Thread(target=gateway.sync,daemon=True).start()
    server=ThreadingHTTPServer((config.get('bind','0.0.0.0'),config.get('port',8765)),gateway.handler())
    if config.get('certificate'):
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(config['certificate'],config['private_key']);server.socket=context.wrap_socket(server.socket,server_side=True)
    try:server.serve_forever()
    finally:gateway.stop.set();server.server_close()
if __name__=='__main__':main()
