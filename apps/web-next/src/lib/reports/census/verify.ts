import { isInterveningGraduate, isUgDegreeSeekingRow, normPcid, type CensusRawStudent, type UnretainedStudent } from "./lists-core";
import type { HousingAssignmentRow } from "./residency";

export type VerifyRow = {
  issue: string;
  why: string;
  pcid: string;
  first: string;
  last: string;
  detail: string;
};

function isIrelandHouse(h: HousingAssignmentRow): boolean {
  const b = (h.building || "").trim().toUpperCase();
  const p = (h.priceType || "").trim().toUpperCase();
  return b === "CIARA" || b === "MALAC" || p === "ISTA";
}

function isSenior(classLevel: string): boolean {
  const t = (classLevel || "").trim().toUpperCase();
  return t === "SENIOR" || t === "SR";
}

function hasRoom(h: HousingAssignmentRow): boolean {
  const b = (h.building || "").trim();
  const room = (h.room || "").trim();
  if (!b || b === "Commuter") return false;
  return Boolean(room) || isIrelandHouse(h);
}

function nameOf(h: HousingAssignmentRow): { first: string; last: string } {
  const parts = (h.name || "").trim().split(/\s+/);
  if (parts.length < 2) return { first: h.name || "", last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] || "" };
}

/** Temporary census check list: Ireland mismatches, unretained seniors, housing vs registration. */
export function buildVerifyList(
  students: CensusRawStudent[],
  unretained: UnretainedStudent[],
  graduates: { pcid: string; year?: string | number; term?: string; program?: string }[],
  housing: HousingAssignmentRow[],
): VerifyRow[] {
  const registered = new Map(students.map((s) => [normPcid(s.pcid), s]));
  const housingBy = new Map(housing.map((h) => [normPcid(h.pcid), h]));
  const gradIds = new Set(
    graduates.filter((g) => isInterveningGraduate(g.year, g.term)).map((g) => normPcid(g.pcid)),
  );
  const rows: VerifyRow[] = [];
  const programsByPcid = new Map<string, CensusRawStudent[]>();
  for (const s of students) {
    const id = normPcid(s.pcid);
    const list = programsByPcid.get(id) || [];
    list.push(s);
    programsByPcid.set(id, list);
  }
  for (const group of programsByPcid.values()) {
    const progs = new Set(group.map((s) => (s.program || "").toUpperCase()).filter(Boolean));
    if (progs.has("UNDERG") && progs.has("GRAD")) {
      const s = group[0]!;
      rows.push({
        issue: "UG and graduate programs",
        why: "On Registration Status as undergraduate and also on a graduate/Lux Mundi session. Counted in both UG and graduate totals; all-student headcount is once.",
        pcid: s.pcid,
        first: s.first,
        last: s.last,
        detail: group.map((g) => `${g.session || "—"} ${g.program} ${g.degree} ${g.fullPart} ${g.credits} cr`).join(" · "),
      });
    }
  }

  for (const s of students) {
    const id = normPcid(s.pcid);
    const h = housingBy.get(id);
    const irelandSess = (s.session || "").toLowerCase().includes("ireland");
    const irelandHouse = h ? isIrelandHouse(h) : false;
    if (irelandSess && !irelandHouse && (s.residency || "").trim() !== "Commuter") {
      rows.push({
        issue: "Ireland session, not Ireland housing",
        why: "Registration session is 03Ireland (Ireland campus from the residency extract). eRez is not Ciara/Malachy. Census residency stays Ireland.",
        pcid: s.pcid,
        first: s.first,
        last: s.last,
        detail: `session ${s.session || "—"} · housing ${h ? `${h.building || "none"} ${h.room || ""} (${h.residency})` : "not in eRez; Ireland kept from registration"}`,
      });
    }
    const res = (s.residency || "").trim();
    if (!irelandSess && (!res || res === "Unassigned")) {
      rows.push({
        issue: "No residency",
        why: "Checked eRezLife and Registration Status with Residency (Res Comm). Neither has On Campus, Commuter, or Ireland.",
        pcid: s.pcid,
        first: s.first,
        last: s.last,
        detail: `session ${s.session || "—"} · registration ${s.residency || "—"} · eRez ${h ? `${h.building || "none"} ${h.room || ""} (${h.residency})` : "not in eRez"}`,
      });
    }
    if (irelandHouse && !irelandSess) {
      rows.push({
        issue: "Ireland housing, not Ireland session",
        why: "eRez Ciara/Malachy assignment, but Registration Status session is not 03Ireland.",
        pcid: s.pcid,
        first: s.first,
        last: s.last,
        detail: `session ${s.session || "—"} · ${h?.building || ""} ${h?.room || ""} · census residency ${s.residency || "—"} · sport ${s.sport || "—"}`,
      });
    }
    if (gradIds.has(id)) {
      rows.push({
        issue: "Graduate still registered",
        why: "On the Fall 2025–Summer 2026 graduate list and also on Fall 2026 Registration Status.",
        pcid: s.pcid,
        first: s.first,
        last: s.last,
        detail: `${s.program} ${s.classLevel} ${s.incomingReturning}`,
      });
    }
  }

  for (const s of unretained) {
    const id = normPcid(s.pcid);
    const h = housingBy.get(id);
    if (isUgDegreeSeekingRow(s.program || "", s.collegeAttend) && isSenior(s.classLevel)) {
      rows.push({
        issue: "Unretained senior",
        why: "Fall 2025 senior, not registered Fall 2026, and not on the intervening graduate list. Confirm they did not graduate.",
        pcid: s.pcid,
        first: s.first,
        last: s.last,
        detail: `${s.classLevel} ${s.collegeAttend} GPA ${s.gpa ?? "—"} earned cr ${s.earnedCredits || "—"} FA25 cr ${s.credits || "—"} sport ${s.sport || "—"}`,
      });
    }
    if (h && hasRoom(h)) {
      rows.push({
        issue: "Unretained but still housed",
        why: "Not retained on the census, but eRez still has a room assignment.",
        pcid: s.pcid,
        first: s.first,
        last: s.last,
        detail: `${h.building} ${h.room} (${h.residency})`,
      });
    }
  }

  for (const h of housing) {
    const id = normPcid(h.pcid);
    if (!id || registered.has(id)) continue;
    if (!hasRoom(h)) continue;
    const n = nameOf(h);
    rows.push({
      issue: "Housed, not registered",
      why: "eRez assignment with a hall/room, but PCID is not on Fall 2026 Registration Status.",
      pcid: h.pcid,
      first: n.first,
      last: n.last,
      detail: `${h.building} ${h.room} · ${h.residency} · ${h.priceType}`,
    });
  }

  const order = [
    "No residency",
    "Ireland session, not Ireland housing",
    "Ireland housing, not Ireland session",
    "Unretained senior",
    "Housed, not registered",
    "Unretained but still housed",
    "Graduate still registered",
    "UG and graduate programs",
  ];
  return rows.sort((a, b) => {
    const ai = order.indexOf(a.issue);
    const bi = order.indexOf(b.issue);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.last.localeCompare(b.last) || a.first.localeCompare(b.first);
  });
}
