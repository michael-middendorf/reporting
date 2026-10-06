/**
 * Calendar month bounds for the Points date filter.
 */

function pad(n) {
  return String(n).padStart(2, "0");
}

export function monthKey(iso) {
  const text = String(iso || "");
  const m = text.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : "";
}

export function monthBounds(key) {
  const [y, m] = String(key || "").split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return { from: "", to: "" };
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${y}-${pad(m)}-01`,
    to: `${y}-${pad(m)}-${pad(last)}`,
  };
}

export function monthLabel(key, locale = "en-US") {
  const [y, m] = String(key || "").split("-").map(Number);
  if (!y || !m) return "";
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

/** Inclusive months from evalStart through asOf, latest first. */
export function monthOptions(evalStartIso, asOf = new Date()) {
  const start = String(evalStartIso || "").match(/^(\d{4})-(\d{2})/);
  if (!start) return [];
  let y = Number(start[1]);
  let m = Number(start[2]);
  const end = asOf instanceof Date ? asOf : new Date(`${asOf}T00:00:00`);
  if (Number.isNaN(+end)) return [];
  const endY = end.getFullYear();
  const endM = end.getMonth() + 1;
  const out = [];
  while (y < endY || (y === endY && m <= endM)) {
    const key = `${y}-${pad(m)}`;
    out.push({ key, label: monthLabel(key) });
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out.reverse();
}

/** YYYY-MM when from/to are exactly that calendar month, else "". */
export function matchingMonth(dateFrom, dateTo) {
  const key = monthKey(dateFrom);
  if (!key || !dateTo) return "";
  const b = monthBounds(key);
  return dateFrom === b.from && dateTo === b.to ? key : "";
}
