import { redirect } from "next/navigation";
import { canAccessReport } from "@/lib/access";
import { CoachingDenied, TeamPicker } from "@/components/athletics/CoachingHub";
import { isCoachingLeadership, visibleSports } from "@/lib/reports/athletics-coaching/access";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";

export const dynamic = "force-dynamic";

export default async function CoachingOverviewPage() {
  const email = await coachingSessionEmail();
  if (!email) redirect("/");
  if (!canAccessReport(email, "athletics-coaching") || !isCoachingLeadership(email)) {
    return <CoachingDenied message="Coaching overview is limited to athletics leadership." />;
  }
  return (
    <TeamPicker
      sports={visibleSports(email)}
      title="Coaching overview"
      description="Department rollup is not available yet. Open a team dashboard. Fundraising, enrollment, and academic numbers will appear here later."
    />
  );
}
