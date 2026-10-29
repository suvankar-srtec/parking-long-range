import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { readAudit } from "@/lib/audit-report";
export async function GET(request: Request) {
 const user = await getCurrentUser();
 if (!user) return NextResponse.json({message:"Sign in required."},{status:401});
 if (user.role !== "SUPER_ADMIN") return NextResponse.json({message:"Super Admin access required."},{status:403});
 try { const params=new URL(request.url).searchParams; params.delete("before"); const rows=await readAudit(user,params,null);
 return NextResponse.json({rows},{headers:{"Cache-Control":"no-store"}});
 } catch { return NextResponse.json({message:"Unable to load audit records. Check the filters and try again."},{status:400}); }
}
