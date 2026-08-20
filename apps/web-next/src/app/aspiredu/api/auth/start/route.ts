import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { aspireduCallbackUrlFor, aspireduPrivateHeaders, beginAspireduMfa } from "@/lib/aspiredu-auth";

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) return NextResponse.redirect(new URL("/", req.url));
  try {
    return NextResponse.redirect(await beginAspireduMfa(email, aspireduCallbackUrlFor(req)), { headers: aspireduPrivateHeaders });
  } catch {
    return NextResponse.json({ error: "Student-level access is not available for this account" }, { status: 403, headers: aspireduPrivateHeaders });
  }
}
