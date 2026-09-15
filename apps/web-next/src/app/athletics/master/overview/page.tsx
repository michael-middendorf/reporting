import { redirect } from "next/navigation";
import { canAccessReport } from "@/lib/access";
import { CoachingDenied, TeamPicker } from "@/components/athletics/CoachingHub";
import { visibleOverviewSports } from "@/lib/reports/athletics/overview";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";

export const dynamic = "force-dynamic";

export default async function AthleticsMasterOverviewPage() {
  const email = await coachingSessionEmail();
  if (!email) redirect("/");
  if (!canAccessReport(email, "athletics")) {
    return <CoachingDenied message="You do not have access to Athletics Master." />;
  }
  const sports = visibleOverviewSports(email);
  if (sports.length === 1) redirect(`/athletics/master/overview/${sports[0]!.key}`);
  return (
    <TeamPicker
      sports={sports}
      title="Overview"
      description="Pick a sport for recruiting, academics, and fundraising totals. No athlete or gift lists on this sheet."
      sportHref={(key) => `/athletics/master/overview/${key}`}
      sportBlurb="Program stats for recruiting, academics, and fundraising."
    />
  );
}
