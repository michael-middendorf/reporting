import { AlumniPage } from "@/components/athletics/CoachingAlumni";

export const dynamic = "force-dynamic";

export default async function CoachingAlumniPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  return <AlumniPage sportKey={sport} />;
}
