"use client";

import { EnrollmentChrome, EnrollmentProvider } from "./EnrollmentProvider";

export default function EnrollmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <EnrollmentProvider>
      <EnrollmentChrome>{children}</EnrollmentChrome>
    </EnrollmentProvider>
  );
}
