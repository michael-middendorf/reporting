import { FundraisingBand } from "@/components/athletics/CoachingFundraising";

export const dynamic = "force-dynamic";

export default async function CoachingFundraisingPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  return <FundraisingBand sportKey={sport} />;
}
