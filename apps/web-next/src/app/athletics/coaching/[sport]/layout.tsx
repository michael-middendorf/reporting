import { notFound, redirect } from "next/navigation";
import { canAccessReport } from "@/lib/access";
import { CoachingDenied } from "@/components/athletics/CoachingHub";
import { CoachingSportNav } from "@/components/athletics/CoachingSportNav";
import { canAccessSport } from "@/lib/reports/athletics-coaching/access";
import { coachingSessionEmail } from "@/lib/reports/athletics-coaching/session";
import { sportByKey } from "@/lib/reports/athletics-coaching/sports";

export const dynamic = "force-dynamic";

export default async function CoachingSportLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  return (
    <main className="ath-page">
      <div className="ath-page-heading">
        <div>
          <h1>{sport.label}</h1>
          <p>Team dashboard.</p>
        </div>
      </div>
      <CoachingSportNav sportKey={sport.key} />
      {children}
    </main>
  );
}
