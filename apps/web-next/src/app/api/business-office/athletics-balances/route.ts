import { NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/auth";
import { financeScope, financeScopeAllowsSport } from "@/lib/reports/business-office/access";
import {
  ATHLETICS_FINANCE_DATASET,
  ATHLETICS_FINANCE_META_KEY,
  ATHLETICS_FINANCE_SOURCE,
  buildAthleticsBalances,
  rowsForScope,
  type FinanceMeta,
  type FinanceRow,
} from "@/lib/reports/business-office/athletics-finance";
import { canonicalSportKey } from "@/lib/reports/athletics-coaching/sports";
import { isMissingSource, loadSourceRowsOptional, readJson } from "@/lib/sources";

export const dynamic = "force-dynamic";

export type AthleticsFinanceData = { rows: FinanceRow[]; meta: FinanceMeta };

async function defaultReadAthleticsFinance(): Promise<AthleticsFinanceData | null> {
  const loaded = await loadSourceRowsOptional<FinanceRow>(
    ATHLETICS_FINANCE_SOURCE,
    ATHLETICS_FINANCE_DATASET,
  );
  if (!loaded) return null;
  try {
    const meta = await readJson<FinanceMeta>(ATHLETICS_FINANCE_META_KEY);
    return { rows: loaded.rows, meta };
  } catch (error) {
    if (isMissingSource(error)) return null;
    throw error;
  }
}

/** Test seam. Production reads sources/athletics-finance/ from the data bucket. */
export const athleticsFinanceData = {
  read: defaultReadAthleticsFinance,
};

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const email = currentUserEmail(req);
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const scope = financeScope(email);
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const sportParam = (url.searchParams.get("sport") || "").trim();
  let sportKey: string | null = null;
  if (sportParam) {
    sportKey = canonicalSportKey(sportParam);
    if (!sportKey) {
      return NextResponse.json({ error: "Unknown sport" }, { status: 400 });
    }
    if (!financeScopeAllowsSport(scope, sportKey)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const data = await athleticsFinanceData.read();
    if (!data) {
      return NextResponse.json(
        { error: "Athletics finances are not published yet." },
        { status: 503, headers: NO_STORE },
      );
    }
    const scoped = rowsForScope(data.rows, scope);
    const payload = buildAthleticsBalances(scoped, data.meta, scope, sportKey);
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (error) {
    console.error("athletics-balances: load failed", error);
    return NextResponse.json(
      { error: "Unable to load athletics finances" },
      { status: 503, headers: NO_STORE },
    );
  }
}
