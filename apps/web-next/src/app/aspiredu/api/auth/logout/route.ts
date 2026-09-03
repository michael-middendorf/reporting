import { NextResponse } from "next/server";
import {
  aspireduPrivateHeaders,
  aspireduSessionClearCookieHeaders,
  endAspireduMfa,
} from "@/lib/aspiredu-auth";

export async function POST(req: Request) {
  await endAspireduMfa(req);
  const response = NextResponse.json({ ok: true }, { headers: aspireduPrivateHeaders });
  for (const cookie of aspireduSessionClearCookieHeaders()) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}
