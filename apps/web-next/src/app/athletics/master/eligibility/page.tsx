import { redirect } from "next/navigation";
import { canAccessReport } from "@/lib/access";
import { CoachingDenied } from "@/components/athletics/CoachingHub";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";
import { EligibilityClient } from "../../eligibility/EligibilityClient";

export const dynamic = "force-dynamic";

export default async function AthleticsMasterEligibilityPage() {
  const email = await coachingSessionEmail();
  if (!email) redirect("/");
  if (!canAccessReport(email, "athletics")) {
    return <CoachingDenied message="You do not have access to Athletics Eligibility." />;
  }
  return <EligibilityClient />;
}
