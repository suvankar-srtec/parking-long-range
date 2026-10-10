import { handleCloudHttp } from "@/lib/cloudc-http";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleCloudHttp(request, false); }
export const GET = POST;
