import { withAuditRequest } from "@/lib/audit-request";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accountAccessStatus } from "@/lib/building-status";
import { missingLoginConfiguration, loginErrorDiagnostic } from "@/lib/login-diagnostics";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

async function handlePOST(request: Request) {
  try {
    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 }); }

    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!userId || !password) {
      return NextResponse.json({ ok: false, message: "User ID and password are required." }, { status: 400 });
    }

    const missing = missingLoginConfiguration(process.env);
    if (missing.length) {
      console.error("LOGIN_CONFIGURATION_MISSING", { missing });
      return NextResponse.json({ ok: false, message: "Sign-in is not configured on this server. Please contact the administrator." }, { status: 503 });
    }

    const user = await prisma.user.findUnique({ where: { userId } });
    if (!user || user.password !== password) {
      return NextResponse.json({ ok: false, message: "User ID or password is incorrect." }, { status: 401 });
    }

    const access = await accountAccessStatus(user);
    if (!access.active) {
      return NextResponse.json({ ok: false, message: access.message }, { status: 403 });
    }

    const response = NextResponse.json({
      ok: true,
      message: "Signed in successfully.",
      redirectTo: "/dashboard",
      role: user.role,
    });
    response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return response;
  } catch (error) {
    const diagnostic = loginErrorDiagnostic(error);
    console.error("LOGIN_FAILED", diagnostic);
    return NextResponse.json({ ok: false, message: "Unable to sign in. Please try again.", reference: diagnostic.reason }, { status: 500 });
  }
}

export const POST = withAuditRequest(handlePOST);
