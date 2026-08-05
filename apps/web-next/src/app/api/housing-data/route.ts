import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";

/** Housing live data — requires Qlik/eRezLife secrets (not PLACEHOLDER). */
export async function GET(req: Request) {
  if (!currentUserEmail(req)) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const qlik = process.env.QLIK_API_KEY || "";
  if (!qlik || qlik === "PLACEHOLDER") {
    return NextResponse.json(
      {
        error:
          "Housing data sources not configured. Set QlikApiKey / ErezlifeApiKey via sst secret set.",
      },
      { status: 503 },
    );
  }
  // Full Qlik Engine fetch lives in services/api (Python); wire when secrets are real.
  return NextResponse.json(
    { error: "Housing live proxy: use Python housing service or configure Qlik in Next route." },
    { status: 501 },
  );
}
