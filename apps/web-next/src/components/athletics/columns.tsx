import type { AthleticsColumn } from "./DataTable";
import { formatCurrency } from "./DataTable";
import { STAGE_COLORS } from "@/lib/reports/athletics/normalize";

const safeSlateUrl = (input: string) => {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && url.hostname === "apply.avemaria.edu" ? url.toString() : "";
  } catch {
    return "";
  }
};

export const APPLICATION_COLUMNS: AthleticsColumn[] = [
  { key: "riskRating", label: "Risk Factor" },
  { key: "firstName", label: "First" },
  { key: "lastName", label: "Last" },
  { key: "sport", label: "Sport" },
  { key: "position", label: "Position" },
  { key: "athleticScholarship", label: "Athletic Scholarship", render: (row) => row.athleticScholarship ? formatCurrency(row.athleticScholarship) : "—" },
  { key: "stage", label: "Applicant Stage", render: (row) => {
    const color = row.stage in STAGE_COLORS ? STAGE_COLORS[row.stage as keyof typeof STAGE_COLORS] : "#edf1f4";
    return <span className="ath-stage-pill" style={{ background: color }}>{row.stage}</span>;
  } },
  { key: "applicationStatus", label: "Application Status" },
  { key: "workflowBin", label: "Workflow / Stage" },
  { key: "offered", label: "Offered" },
  { key: "loiStatus", label: "LOI Status" },
  { key: "recordUrl", label: "Slate Reader", render: (row) => {
    const href = safeSlateUrl(row.recordUrl);
    return href ? <a href={href} target="_blank" rel="noreferrer">Open reader</a> : <span className="ath-muted">URL pending</span>;
  } },
  { key: "profileUrl", label: "Main Profile", render: (row) => {
    const href = safeSlateUrl(row.profileUrl);
    return href ? <a href={href} target="_blank" rel="noreferrer">Open profile</a> : "—";
  } },
];

export const ROSTER_COLUMNS: AthleticsColumn[] = [
  { key: "sport", label: "Sport" },
  { key: "position", label: "Position" },
  { key: "firstName", label: "First" },
  { key: "lastName", label: "Last" },
  { key: "term", label: "Entry Term" },
  { key: "sector", label: "Sector" },
  { key: "athleticScholarship", label: "Athletic Scholarship", render: (row) => row.athleticScholarship ? formatCurrency(row.athleticScholarship) : "—" },
  { key: "loiStatus", label: "Commitment" },
  { key: "recordUrl", label: "Slate Reader", render: (row) => {
    const href = safeSlateUrl(row.recordUrl);
    return href ? <a href={href} target="_blank" rel="noreferrer">Open reader</a> : "—";
  } },
  { key: "profileUrl", label: "Main Profile", render: (row) => {
    const href = safeSlateUrl(row.profileUrl);
    return href ? <a href={href} target="_blank" rel="noreferrer">Open profile</a> : "—";
  } },
];

export const PROSPECT_COLUMNS: AthleticsColumn[] = [
  { key: "recordUrl", label: "Slate Record", render: (row) => {
    const href = safeSlateUrl(row.recordUrl);
    return href ? <a href={href} target="_blank" rel="noreferrer">Slate Record</a> : "—";
  } },
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "gpa", label: "GPA", render: (row) => row.gpa?.toFixed(2) || "—" },
  { key: "prospectStatus", label: "Status" },
  { key: "term", label: "Entry Term" },
  { key: "sport", label: "Sport" },
  { key: "position", label: "Position" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "studentType", label: "Student Type" },
];
