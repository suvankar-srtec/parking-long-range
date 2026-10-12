CREATE TABLE IF NOT EXISTS "manual_exit_notifications" (
 "id" TEXT PRIMARY KEY, "eventId" TEXT UNIQUE, "targetKind" TEXT NOT NULL, "targetId" TEXT NOT NULL, "targetAccessAt" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'PENDING', "approvedById" TEXT, "approvedByName" TEXT, "approvedAt" TIMESTAMP(3), "buildingId" TEXT NOT NULL,
 "buildingName" TEXT NOT NULL, "actorId" TEXT NOT NULL, "actorName" TEXT NOT NULL,
 "vehicleNumber" TEXT NOT NULL, "personName" TEXT NOT NULL, "cardNo" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "manual_exit_notifications_buildingId_createdAt_idx" ON "manual_exit_notifications" ("buildingId", "createdAt");
CREATE TABLE IF NOT EXISTS "manual_exit_notification_reads" (
 "notificationId" TEXT NOT NULL REFERENCES "manual_exit_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "userId" TEXT NOT NULL, "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("notificationId", "userId")
);
CREATE INDEX IF NOT EXISTS "manual_exit_notification_reads_userId_idx" ON "manual_exit_notification_reads" ("userId");
