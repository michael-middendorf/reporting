import { AcademicsPage } from "@/components/athletics/CoachingAcademics";

export const dynamic = "force-dynamic";

export default async function CoachingAcademicsPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  return <AcademicsPage sportKey={sport} />;
}
