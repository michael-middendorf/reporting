import { CoachingScoreboard } from "@/components/athletics/CoachingScoreboard";

export const dynamic = "force-dynamic";

export default async function CoachingTeamPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  return <CoachingScoreboard sportKey={sport} />;
}
