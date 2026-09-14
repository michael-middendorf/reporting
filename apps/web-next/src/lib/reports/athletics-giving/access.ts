import { canAccessReport } from "../../access";

/** Named athletics gifts: coaching leadership and Advancement. Not head coaches. */
export function canAccessAthleticsGiving(email: string): boolean {
  return canAccessReport(email, "athletics-coaching") || canAccessReport(email, "advancement");
}
