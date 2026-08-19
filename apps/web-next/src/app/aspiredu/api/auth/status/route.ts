import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { aspireduPrivateHeaders, getAspireduMfaSession } from "@/lib/aspiredu-auth";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  const session = email ? await getAspireduMfaSession(req, email) : null;
  return NextResponse.json({ authenticated: Boolean(session), email: session?.email }, {
    status: session ? 200 : 401,
    headers: aspireduPrivateHeaders,
  });
}
