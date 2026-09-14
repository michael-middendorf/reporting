import { EnrollmentBand } from "@/components/athletics/CoachingEnrollment";

export const dynamic = "force-dynamic";

export default async function CoachingEnrollmentPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  return <EnrollmentBand sportKey={sport} />;
}
