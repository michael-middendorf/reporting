import { notFound, redirect } from "next/navigation";
import { canAccessReport } from "@/lib/access";
import { CoachingBands, CoachingDenied } from "@/components/athletics/CoachingHub";
import { canAccessSport } from "@/lib/reports/athletics-coaching/access";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";

export const dynamic = "force-dynamic";
import { sportByKey } from "@/lib/reports/athletics-coaching/sports";

export default async function CoachingTeamPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport: sportKey } = await params;
  const sport = sportByKey[sportKey];
  if (!sport) notFound();

  const email = await coachingSessionEmail();
  if (!email) redirect("/");
  if (!canAccessReport(email, "athletics-coaching") || !canAccessSport(email, sport.key)) {
    return <CoachingDenied message="You do not have access to this team dashboard." />;
  }
  return <CoachingBands sportKey={sport.key} sportLabel={sport.label} />;
}
