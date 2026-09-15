import { notFound, redirect } from "next/navigation";
import { sportByKey } from "@/lib/reports/athletics-coaching/sports";

export const dynamic = "force-dynamic";

export default async function AthleticsMasterSportOverviewRedirect({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport: sportKey } = await params;
  if (!sportByKey[sportKey]) notFound();
  redirect(`/athletics/master/overview?sport=${encodeURIComponent(sportKey)}`);
}
