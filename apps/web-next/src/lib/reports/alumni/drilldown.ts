export type Predicate = {
  kind: "eq" | "bool";
  key: string;
  value: string | boolean;
};

export type DrilldownSpec = {
  title: string;
  segmentKey?: string;
  predicates: Predicate[];
};

export function detailClassYearLabel(row: Record<string, unknown>) {
  return String(row.class_year || row.class_year_issue || row.raw_class_year || "");
}

export function buildDrilldownHref(spec: DrilldownSpec) {
  const params = new URLSearchParams({ spec: JSON.stringify(spec) });
  return `/alumni/drilldown?${params.toString()}`;
}

export function summaryCardDrilldownSpec(card: { id?: string; label?: string }): DrilldownSpec {
  const byId: Record<string, DrilldownSpec> = {
    alumni_base: { title: "Alumni Base", predicates: [] },
    lifetime_donors: {
      title: "Lifetime Donors",
      predicates: [{ kind: "bool", key: "lifetime_donor_flag", value: true }],
    },
    ytd_donors: {
      title: "YTD Donors",
      predicates: [{ kind: "bool", key: "ytd_donor_flag", value: true }],
    },
    recent_donors_365: {
      title: "Recent Donors (365)",
      predicates: [{ kind: "bool", key: "recent_donor_365_flag", value: true }],
    },
    recent_donors_90: {
      title: "Recent Donors (90)",
      predicates: [{ kind: "bool", key: "recent_donor_90_flag", value: true }],
    },
    lapsed_donors_366_730: {
      title: "Lapsed Donors (366-730)",
      predicates: [{ kind: "bool", key: "lapsed_donor_366_730_flag", value: true }],
    },
    touched_90: {
      title: "Touched in 90 Days",
      predicates: [{ kind: "bool", key: "touched_90_flag", value: true }],
    },
    recent_donors_touched_90: {
      title: "Recent Donors Touched 90",
      predicates: [{ kind: "bool", key: "recent_donor_touched_90_flag", value: true }],
    },
    recent_donors_untouched_90: {
      title: "Recent Donors Untouched 90",
      predicates: [{ kind: "bool", key: "recent_donor_untouched_90_flag", value: true }],
    },
    assigned_recent_donors: {
      title: "Assigned Recent Donors",
      predicates: [{ kind: "bool", key: "recent_donor_assigned_flag", value: true }],
    },
    unassigned_recent_donors: {
      title: "Unassigned Recent Donors",
      predicates: [{ kind: "bool", key: "recent_donor_unassigned_flag", value: true }],
    },
    active_recurring: {
      title: "Active Recurring",
      predicates: [{ kind: "bool", key: "active_recurring_flag", value: true }],
    },
    planned_giving: {
      title: "Planned Giving",
      predicates: [{ kind: "bool", key: "planned_giving_flag", value: true }],
    },
  };
  return byId[card.id || ""] || { title: card.label || "Alumni Segment", predicates: [] };
}

export function cohortDrilldownSpec(
  tabKey: string,
  row: { label?: string },
  metricKey: string,
  metricLabel: string,
): DrilldownSpec {
  const predicates: Predicate[] = [];
  const detailField = tabKey === "class_year" ? "cohort_label" : tabKey;
  if (detailField && row.label != null) {
    predicates.push({ kind: "eq", key: detailField, value: String(row.label) });
  }
  const metricMap: Record<string, Predicate> = {
    lifetime_donor_count: { kind: "bool", key: "lifetime_donor_flag", value: true },
    recent_donor_365_count: { kind: "bool", key: "recent_donor_365_flag", value: true },
    touched_90_count: { kind: "bool", key: "touched_90_flag", value: true },
    recent_donor_untouched_90_count: {
      kind: "bool",
      key: "recent_donor_untouched_90_flag",
      value: true,
    },
    assigned_count: { kind: "bool", key: "assigned_flag", value: true },
    unassigned_count: { kind: "bool", key: "assigned_flag", value: false },
  };
  if (metricMap[metricKey]) predicates.push(metricMap[metricKey]);
  return { title: `${row.label} · ${metricLabel}`, predicates };
}

export function leaderDrilldownSpec(groupTitle: string, label: string): DrilldownSpec | null {
  const byGroup: Record<string, DrilldownSpec> = {
    "Top Note Types (90 Days)": {
      title: `Top Note Type (90 Days): ${label}`,
      segmentKey: `leader_note_type_90:${label}`,
      predicates: [],
    },
    "Top Note Creators (90 Days)": {
      title: `Top Note Creator (90 Days): ${label}`,
      segmentKey: `leader_note_creator_90:${label}`,
      predicates: [],
    },
    "Unassigned Recent Donor Decades": {
      title: `Unassigned Recent Donor Decade: ${label}`,
      segmentKey: `leader_unassigned_recent_donor_decade:${label}`,
      predicates: [],
    },
    "Recent Donor Solicitor Groups": {
      title: `Recent Donor Solicitor Group: ${label}`,
      segmentKey: `leader_recent_donor_solicitor_group:${label}`,
      predicates: [],
    },
  };
  return byGroup[groupTitle] || null;
}

export function matchesPredicate(row: Record<string, unknown>, predicate: Predicate) {
  if (!predicate?.kind || !predicate.key) return true;
  if (predicate.kind === "eq") {
    return String(row[predicate.key] || "") === String(predicate.value || "");
  }
  if (predicate.kind === "bool") {
    return Boolean(row[predicate.key]) === Boolean(predicate.value);
  }
  return true;
}

export function applySegment(
  rows: Record<string, unknown>[],
  spec: DrilldownSpec,
  segmentIndex?: { segments?: Record<string, { contact_ids?: unknown[]; title?: string }> },
) {
  let scoped = rows;
  if (spec.segmentKey) {
    const segment = segmentIndex?.segments?.[spec.segmentKey];
    if (segment) {
      const ids = new Set((segment.contact_ids || []).map((v) => Number(v)));
      scoped = rows.filter((row) => ids.has(Number(row.contact_id)));
    }
  }
  return scoped.filter((row) => (spec.predicates || []).every((p) => matchesPredicate(row, p)));
}

export function pillToneForRecency(value: string) {
  if (value === "Gave in last 90 days") return "cool";
  if (value === "Gave in last 365 days") return "warm";
  if (value === "Never gave") return "neutral";
  return "alert";
}

export function pillToneForOpportunity(value: string) {
  if ((value || "").includes("untouched")) return "alert";
  if ((value || "").includes("Recent donor, touched")) return "cool";
  if ((value || "").includes("Never donor")) return "neutral";
  return "warm";
}
