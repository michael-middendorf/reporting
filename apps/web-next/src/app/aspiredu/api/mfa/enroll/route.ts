import { NextResponse } from "next/server";
import { aspireduPrivateHeaders } from "@/lib/aspiredu-auth";

export async function POST() {
  return NextResponse.json(
    { error: "Use first-time enroll at /api/auth/mfa/enroll" },
    { status: 410, headers: aspireduPrivateHeaders },
  );
}
