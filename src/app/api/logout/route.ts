import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

async function handlePOST(request: Request) {
  const response = request.headers.get("accept")?.includes("application/json")
    ? NextResponse.json({ ok: true, message: "Signed out successfully." })
    : NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", expires: new Date(0),
  });
  return response;
}

export const POST = withAuditRequest(handlePOST);
