-- Append-only evidence, independent of application entities and cascade deletion.
CREATE TABLE IF NOT EXISTS audit_records (
 id bigserial PRIMARY KEY,
 "recordedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 "occurredAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
 source text NOT NULL,
 category text NOT NULL,
 action text NOT NULL,
 "entityType" text,
 "entityId" text,
 "buildingId" text,
 "buildingName" text,
 "companyName" text,
 "superAdminId" text,
 actor text NOT NULL DEFAULT 'System / device',
 "actorRole" text,
 result text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_records_time ON audit_records ("recordedAt" DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_records_scope ON audit_records ("superAdminId", id DESC);
CREATE INDEX IF NOT EXISTS audit_records_category ON audit_records (category, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS audit_records_import ON audit_records (source,"entityType","entityId") WHERE source = 'Historical import';

CREATE OR REPLACE FUNCTION audit_redact(value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE output jsonb; k text; v jsonb;
BEGIN
 IF value IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(value) = 'object' THEN
  output := '{}'::jsonb;
  FOR k,v IN SELECT * FROM jsonb_each(value) LOOP
   IF k ~* '(password|token|secret|authorization|cookie|qrdata|qrcode|privatekey|cmdvalue|payload|raw|packet|manifest|cards)' THEN
    output := output || jsonb_build_object(k,'[REDACTED]');
   ELSE output := output || jsonb_build_object(k,audit_redact(v)); END IF;
  END LOOP;
  RETURN output;
 ELSIF jsonb_typeof(value) = 'array' THEN
  SELECT coalesce(jsonb_agg(audit_redact(item)),'[]'::jsonb) INTO output FROM jsonb_array_elements(value) item;
  RETURN output;
 END IF;
 RETURN value;
END $$;

CREATE OR REPLACE FUNCTION audit_capture_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; current_row jsonb; row_data jsonb; changed text[]; bid text; cid text; sid text;
 bname text; cname text; eid text; event_category text; event_action text; outcome text; happened timestamptz;
BEGIN
 IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD); END IF;
 IF TG_OP <> 'DELETE' THEN current_row := to_jsonb(NEW); END IF;
 row_data := coalesce(current_row,previous);
 SELECT array_agg(key ORDER BY key) INTO changed FROM (
  SELECT key FROM jsonb_object_keys(coalesce(previous,'{}'::jsonb) || coalesce(current_row,'{}'::jsonb)) key
  WHERE previous->key IS DISTINCT FROM current_row->key
 ) changes;
 -- Do not turn routine heartbeats and updatedAt-only writes into activity.
 IF TG_OP = 'UPDATE' AND NOT EXISTS (SELECT 1 FROM unnest(changed) k WHERE k NOT IN
 ('updatedAt','lastSeenAt','lastGatewaySeenAt','lastIp','readerIp','tcpConnected','lastContactAt','lastSyncedAt')) THEN RETURN NEW; END IF;
 eid := coalesce(row_data->>'id',row_data->>'serial',row_data->>'deviceNumber');
 bid := row_data->>'buildingId'; cid := row_data->>'companyId';
 IF TG_TABLE_NAME='buildings' THEN bid:=row_data->>'id'; bname:=row_data->>'name'; sid:=row_data->>'superAdminId'; END IF;
 IF TG_TABLE_NAME='companies' THEN cid:=row_data->>'id'; cname:=row_data->>'name'; END IF;
 IF bid IS NULL AND cid IS NOT NULL THEN SELECT "buildingId",name INTO bid,cname FROM companies WHERE id=cid; END IF;
 IF bid IS NULL AND row_data->>'readerId' IS NOT NULL THEN SELECT "buildingId" INTO bid FROM rfid_readers WHERE id=row_data->>'readerId'; END IF;
 IF bid IS NULL AND row_data->>'serial' IS NOT NULL THEN SELECT "buildingId" INTO bid FROM rfid_readers WHERE "deviceNumber"=(row_data->>'serial')||'-A'; END IF;
 IF bid IS NOT NULL AND bname IS NULL THEN SELECT name,"superAdminId" INTO bname,sid FROM buildings WHERE id=bid; END IF;
 IF cname IS NULL AND cid IS NOT NULL THEN SELECT name INTO cname FROM companies WHERE id=cid; END IF;
 IF TG_TABLE_NAME='users' AND row_data->>'role'='SUPER_ADMIN' THEN sid:=coalesce(row_data->>'createdBySuperAdminId',row_data->>'id'); END IF;
 -- Preserve scope when a parent was already cascade-deleted.
 IF sid IS NULL THEN SELECT "superAdminId","buildingId","buildingName","companyName" INTO sid,bid,bname,cname
 FROM audit_records WHERE "entityType"=TG_TABLE_NAME AND "entityId"=eid AND "superAdminId" IS NOT NULL ORDER BY id DESC LIMIT 1; END IF;
 event_category := CASE
  WHEN TG_TABLE_NAME IN ('rfid_events','cloudc_history') THEN 'Access scans'
  WHEN TG_TABLE_NAME IN ('rfid_readers','gates','cloudc_offline','cloudc_commands','local_access_gateways') THEN 'Devices and gates'
  WHEN TG_TABLE_NAME LIKE 'manual_exit%' THEN 'Manual exits'
  WHEN TG_TABLE_NAME IN ('users','user_id_reservations') THEN 'Accounts and permissions'
  WHEN TG_TABLE_NAME IN ('rfid_enrollments','entity_identities') THEN 'Card registration'
  WHEN TG_TABLE_NAME IN ('employees','vehicles','building_owner_vehicles','visitors') THEN 'Employees and vehicles'
  ELSE 'Buildings and companies' END;
 event_action := TG_OP; outcome := 'Success'; happened:=clock_timestamp();
 IF TG_TABLE_NAME='rfid_events' AND TG_OP='INSERT' THEN
  event_action:=coalesce(row_data->>'action',TG_OP); outcome:=coalesce(row_data->>'message',row_data->>'code','Recorded');
  happened:=coalesce((row_data->>'createdAt')::timestamptz,happened);
 END IF;
 INSERT INTO audit_records(source,category,action,"entityType","entityId","buildingId","buildingName","companyName","superAdminId",result,"occurredAt",details)
 VALUES('Database',event_category,event_action,TG_TABLE_NAME,eid,bid,bname,cname,sid,outcome,happened,
 jsonb_build_object('before',audit_redact(previous),'after',audit_redact(current_row),'changedFields',to_jsonb(changed),'transactionId',txid_current()::text));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION audit_prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit records are append-only; updates, deletion and truncation are forbidden.' USING ERRCODE='42501'; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='audit_records_immutable') THEN
  CREATE TRIGGER audit_records_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_records FOR EACH STATEMENT EXECUTE FUNCTION audit_prevent_mutation();
 END IF;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['users','buildings','companies','company_departments','employees','vehicles','building_owner_vehicles','gates','visitors','rfid_readers','rfid_enrollments','rfid_events','entity_identities','user_id_reservations','cloudc_offline','cloudc_commands','cloudc_history','manual_exit_notifications','manual_exit_notification_reads','local_access_gateways'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='audit_capture_'||tab) THEN
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_capture_change()','audit_capture_'||tab,tab);
  END IF;
 END LOOP;
END $$;

-- Label retained history honestly; do not invent past actors or prior values.
INSERT INTO audit_records(source,category,action,"entityType","entityId","buildingId","buildingName","companyName","superAdminId",result,"occurredAt",details)
SELECT 'Historical import','Access scans',e.action,'rfid_events',e.id,e."buildingId",b.name,c.name,b."superAdminId",e.message,e."createdAt",
 jsonb_build_object('after',audit_redact(to_jsonb(e)),'note','Existing scan history; original actor and before values were not recorded.')
FROM rfid_events e LEFT JOIN buildings b ON b.id=e."buildingId" LEFT JOIN companies c ON c.id=e."companyId"
WHERE NOT EXISTS (SELECT 1 FROM audit_records a WHERE a.source='Database' AND a."entityType"='rfid_events' AND a."entityId"=e.id)
ON CONFLICT DO NOTHING;
