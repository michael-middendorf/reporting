"use client";

import { AccessGate, ReportTopBar } from "@/components/AccessGate";

export default function HousingPage() {
  return (
    <AccessGate report="housing">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
          background: "#EEF2F8",
        }}
      >
        <ReportTopBar title="Housing" nav={[{ href: "/housing", label: "Dashboard" }]} />
        <iframe
          title="AMU Housing Dashboard"
          src="/housing/view"
          style={{
            flex: 1,
            width: "100%",
            border: 0,
            minHeight: "calc(100vh - 56px)",
            background: "#EEF2F8",
          }}
        />
      </div>
    </AccessGate>
  );
}
