import { canAccessReport } from "../../access";
import { isCoachingLeadership } from "../athletics-coaching/access";

/** Athletics Master, coaching leadership, and Advancement. Not head coaches. */
export function canAccessAthleticsGiving(email: string): boolean {
  return (
    canAccessReport(email, "athletics") ||
    isCoachingLeadership(email) ||
    canAccessReport(email, "advancement")
  );
}
