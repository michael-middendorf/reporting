import { canAccessReport } from "../../access";

/** Athletics Master, coaching leadership, and Advancement. */
export function canAccessAthleticsGiving(email: string): boolean {
  return (
    canAccessReport(email, "athletics") ||
    canAccessReport(email, "athletics-coaching") ||
    canAccessReport(email, "advancement")
  );
}
