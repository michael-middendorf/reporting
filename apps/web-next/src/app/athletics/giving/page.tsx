import { redirect } from "next/navigation";
import { CoachingDenied } from "@/components/athletics/CoachingHub";
import { canAccessAthleticsGiving } from "@/lib/reports/athletics-giving/access";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";
import { GivingClient } from "./GivingClient";

export const dynamic = "force-dynamic";

export default async function AthleticsGivingPage() {
  const email = await coachingSessionEmail();
  if (!email) redirect("/");
  if (!canAccessAthleticsGiving(email)) {
    return (
      <CoachingDenied message="Athletics Giving is limited to athletics leadership and Advancement." />
    );
  }
  return <GivingClient />;
}
