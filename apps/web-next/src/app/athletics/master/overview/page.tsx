import { redirect } from "next/navigation";
import { canAccessReport } from "@/lib/access";
import { CoachingDenied } from "@/components/athletics/CoachingHub";
import { visibleOverviewSports } from "@/lib/reports/athletics/overview";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";
import { MasterOverviewClient } from "./MasterOverviewClient";

export const dynamic = "force-dynamic";

export default async function AthleticsMasterOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const email = await coachingSessionEmail();
  if (!email) redirect("/");
  if (!canAccessReport(email, "athletics")) {
    return <CoachingDenied message="You do not have access to Athletics Master." />;
  }
  const sports = visibleOverviewSports(email);
  const { sport } = await searchParams;
  const initial = sports.find((item) => item.key === sport)?.key || sports[0]?.key || "";
  return <MasterOverviewClient sports={sports} initialSport={initial} />;
}
