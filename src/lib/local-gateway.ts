import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ParkingError } from "@/lib/building-parking";
export async function authorizeLocalGateway(request: Request) {
  const token = request.headers.get("x-gateway-token") || "";
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ParkingError("Invalid gateway credentials.", 403);
  const gateway = await prisma.localAccessGateway.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
  if (!gateway?.enabled) throw new ParkingError("Gateway disabled or unauthorized.", 403);
  return gateway;
}
