import { SportFinance } from "@/components/business-office/SportFinance";

export const dynamic = "force-dynamic";

export default async function CoachingBudgetPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  return <SportFinance sportKey={sport} />;
}
