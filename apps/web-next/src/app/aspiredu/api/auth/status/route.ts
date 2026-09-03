import { NextResponse } from "next/server";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";

export async function GET(_req?: Request) {
  return NextResponse.json(
    { error: "Use sign-in authenticator at /auth/mfa" },
    { status: 410, headers: aspireduPrivateHeaders },
  );
}
