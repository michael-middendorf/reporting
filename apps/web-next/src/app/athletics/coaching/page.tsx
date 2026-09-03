import { redirect } from "next/navigation";
import { canAccessReport } from "@/lib/access";
import { CoachingDenied, TeamPicker } from "@/components/athletics/CoachingHub";
import {
  coachSportKeys,
  isCoachingLeadership,
  visibleSports,
} from "@/lib/reports/athletics-coaching/access";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";

export const dynamic = "force-dynamic";

export default async function CoachingIndexPage() {
  const email = await coachingSessionEmail();
  if (!email) redirect("/");
  if (!canAccessReport(email, "athletics-coaching")) {
    return <CoachingDenied message="You do not have access to the coaching dashboard." />;
  }
  if (isCoachingLeadership(email)) {
    redirect("/athletics/coaching/overview");
  }
  const keys = coachSportKeys(email);
  const sports = visibleSports(email);
  if (keys !== "all" && keys.length === 1) {
    redirect(`/athletics/coaching/${keys[0]}`);
  }
  return (
    <TeamPicker
      sports={sports}
      title="Coaching"
      description="Choose a team dashboard. Department rollup is only available to athletics leadership."
    />
  );
}
