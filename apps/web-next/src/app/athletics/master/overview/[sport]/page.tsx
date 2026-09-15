import { notFound, redirect } from "next/navigation";
import { canAccessReport } from "@/lib/access";
import { AthleticsPage } from "@/components/athletics/AthleticsShell";
import { CoachingDenied } from "@/components/athletics/CoachingHub";
import { MasterOverviewSheet } from "@/components/athletics/MasterOverviewSheet";
import { canSeeOverviewSport } from "@/lib/reports/athletics/overview";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";
import { sportByKey } from "@/lib/reports/athletics-coaching/sports";

export const dynamic = "force-dynamic";

export default async function AthleticsMasterSportOverviewPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport: sportKey } = await params;
  const sport = sportByKey[sportKey];
  if (!sport) notFound();

  const email = await coachingSessionEmail();
  if (!email) redirect("/");
  if (!canAccessReport(email, "athletics") || !canSeeOverviewSport(email, sport.key)) {
    return <CoachingDenied message="You do not have access to this program overview." />;
  }

  return (
    <AthleticsPage title={sport.label} description="Program overview. Stats only.">
      <MasterOverviewSheet sportKey={sport.key} />
    </AthleticsPage>
  );
}
