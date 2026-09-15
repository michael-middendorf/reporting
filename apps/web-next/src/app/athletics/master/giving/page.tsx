import { redirect } from "next/navigation";
import { CoachingDenied } from "@/components/athletics/CoachingHub";
import { canAccessAthleticsGiving } from "@/lib/reports/athletics-giving/access";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";
import { GivingClient } from "../../giving/GivingClient";

export const dynamic = "force-dynamic";

export default async function AthleticsMasterGivingPage() {
  const email = await coachingSessionEmail();
  if (!email) redirect("/");
  if (!canAccessAthleticsGiving(email)) {
    return (
      <CoachingDenied message="You do not have access to Athletics Giving." />
    );
  }
  return <GivingClient />;
}
