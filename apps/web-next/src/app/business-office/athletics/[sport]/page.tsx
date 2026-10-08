import { notFound } from "next/navigation";
import { SportFinance } from "@/components/business-office/SportFinance";
import { sportByKey } from "@/lib/reports/athletics-coaching/sports";

export const dynamic = "force-dynamic";

export default async function BusinessOfficeSportPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport: sportKey } = await params;
  const sport = sportByKey[sportKey];
  if (!sport) notFound();
  return (
    <main className="ath-page">
      <div className="ath-page-heading">
        <div>
          <h1>{sport.label}</h1>
        </div>
      </div>
      <SportFinance sportKey={sport.key} backHref="/business-office/athletics" />
    </main>
  );
}
