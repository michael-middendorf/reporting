import type { MajorsParams } from "./shape";

const YEAR = /^\d{4}$/;
const TERM = /^[A-Za-z]{1,10}$/;

/** Query string to report params. Anything malformed is dropped (the report picks defaults). */
export function majorsParamsFromUrl(url: string): MajorsParams {
  const q = new URL(url).searchParams;
  const pick = (name: string, re: RegExp) => {
    const v = (q.get(name) || "").trim();
    return re.test(v) ? v : null;
  };
  return {
    incomingYear: pick("incomingYear", YEAR),
    year: pick("year", YEAR),
    term: pick("term", TERM)?.toUpperCase() ?? null,
  };
}
