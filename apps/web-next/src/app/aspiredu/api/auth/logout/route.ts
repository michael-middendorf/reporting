import { NextResponse } from "next/server";
import {
  aspireduPrivateHeaders,
  clearAspireduSessionCookie,
  endAspireduMfa,
} from "@/lib/aspiredu-auth";

export async function POST(req: Request) {
  await endAspireduMfa(req);
  const response = NextResponse.json({ ok: true }, { headers: aspireduPrivateHeaders });
  response.headers.append("Set-Cookie", clearAspireduSessionCookie());
  return response;
}
