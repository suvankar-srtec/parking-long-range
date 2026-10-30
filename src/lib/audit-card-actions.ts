import { Prisma } from "@prisma/client";
// Combine presentation only. The append-only source evidence is never rewritten.
export const auditCardActionsCte = Prisma.sql`WITH card_candidates AS (
 SELECT account.id AS account_id,event.id AS event_id
 FROM audit_records account JOIN audit_records event ON
  event.source='Database' AND event."entityType"='rfid_events' AND event.action IN ('BLOCK','UNBLOCK')
  AND event."buildingId"=account."buildingId"
 WHERE account.source='Application' AND account.result='Success'
 AND account.action LIKE '/api/access-control/card-block/%'
 AND (
  (account.details->>'relatedEventId' IS NOT NULL AND event."entityId"=account.details->>'relatedEventId')
  OR (account.details->>'relatedEventId' IS NULL
   AND account.action='/api/access-control/card-block/' || CASE WHEN event.details #>> '{after,ownerVehicleId}' IS NOT NULL THEN 'owner/' ELSE 'company/' END || coalesce(event.details #>> '{after,ownerVehicleId}',event.details #>> '{after,vehicleId}')
   AND event."recordedAt"<=account."recordedAt"
   AND EXISTS(SELECT 1 FROM audit_records started WHERE started.source='Application' AND started.result='Started'
    AND started.details->>'requestId'=account.details->>'requestId'
    AND started.action=account.action AND started.actor=account.actor AND started."buildingId"=account."buildingId"
    AND started."recordedAt"<=event."recordedAt")
  )
 )
), card_pairs AS (
 SELECT candidate.* FROM card_candidates candidate
 WHERE (SELECT count(*) FROM card_candidates other WHERE other.account_id=candidate.account_id)=1
 AND (SELECT count(*) FROM card_candidates other WHERE other.event_id=candidate.event_id)=1
), audit_display AS (
 SELECT original.id,original."recordedAt",coalesce(event."occurredAt",original."occurredAt") AS "occurredAt",original.source,
 CASE WHEN event.id IS NOT NULL THEN 'Card management' ELSE original.category END AS category,
 CASE WHEN event.action='BLOCK' THEN 'Click > Access Control > Card Block > Block card' || coalesce(' ' || nullif(event.details #>> '{after,cardNo}',''),'')
      WHEN event.action='UNBLOCK' THEN 'Click > Access Control > Card Block > Unblock card' || coalesce(' ' || nullif(event.details #>> '{after,cardNo}',''),'') ELSE original.action END AS action,
 coalesce(event."entityType",original."entityType") AS "entityType",coalesce(event."entityId",original."entityId") AS "entityId",
 original."buildingId",coalesce(original."buildingName",event."buildingName") AS "buildingName",coalesce(original."companyName",event."companyName") AS "companyName",
 coalesce(event."superAdminId",original."superAdminId") AS "superAdminId",original.actor,original."actorRole",
 CASE WHEN event.action='BLOCK' THEN 'RFID card blocked by Admin.' WHEN event.action='UNBLOCK' THEN 'RFID card unblocked by Admin.'
 ELSE replace(original.result,'by Building Admin.','by Admin.') END AS result,
 original.details
 FROM audit_records original LEFT JOIN card_pairs pair ON pair.account_id=original.id
 LEFT JOIN audit_records event ON event.id=pair.event_id
 WHERE NOT EXISTS(SELECT 1 FROM card_pairs hidden WHERE hidden.event_id=original.id)
 AND NOT (original.source='Database' AND original."entityType" IN ('vehicles','building_owner_vehicles')
  AND original.details ? 'changedFields' AND original.details->'changedFields' <@ '["rfidBlocked","updatedAt"]'::jsonb
  AND EXISTS(SELECT 1 FROM card_pairs hidden JOIN audit_records event ON event.id=hidden.event_id
   WHERE event.details->>'transactionId'=original.details->>'transactionId' AND event."buildingId"=original."buildingId"))
)`;
