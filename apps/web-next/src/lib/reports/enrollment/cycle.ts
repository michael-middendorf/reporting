export type EnrollmentCycle = "fa25" | "fa26" | "fa27";

export const ENROLLMENT_CYCLES: EnrollmentCycle[] = ["fa27", "fa26", "fa25"];

export function cycleMeta(cycle: EnrollmentCycle) {
  if (cycle === "fa25") {
    return {
      year: 2025,
      label: "FA25",
      vs: "FA24",
      curKey: "Fall 2025",
      prvKey: "Fall 2024",
      option: "Fall 2025",
      wdLabel: "FA25 / SP26",
    };
  }
  if (cycle === "fa26") {
    return {
      year: 2026,
      label: "FA26",
      vs: "FA25",
      curKey: "Fall 2026",
      prvKey: "Fall 2025",
      option: "Fall 2026",
      wdLabel: "FA26 / SP27",
    };
  }
  return {
    year: 2027,
    label: "FA27",
    vs: "FA26",
    curKey: "Fall 2027",
    prvKey: "Fall 2026",
    option: "Fall 2027",
    wdLabel: "FA27 / SP28",
  };
}

export function isEnrollmentCycle(v: string): v is EnrollmentCycle {
  return v === "fa25" || v === "fa26" || v === "fa27";
}

/** Current term stats vs prior term. In-progress cycles use last-year snapshots. */
export function pickCurPrv<T>(
  adm: { fa24: T; fa25: T; fa26: T; fa27: T; fa25Yoy?: T; fa26Yoy?: T },
  cycle: EnrollmentCycle,
): { cur: T; prv: T } {
  if (cycle === "fa25") return { cur: adm.fa25, prv: adm.fa24 };
  if (cycle === "fa26") return { cur: adm.fa26, prv: adm.fa25Yoy ?? adm.fa25 };
  return { cur: adm.fa27, prv: adm.fa26Yoy ?? adm.fa26 };
}
