/** Local housing preview only. Off unless HOUSING_LOCAL_DEV=1, and never in production. */
export function housingLocalDevEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.HOUSING_LOCAL_DEV === "1";
}
