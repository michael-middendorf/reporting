/**
 * Client-side filter for the Points Gifts table.
 * A query matches when every word is in the donor, MA, date, kind, project,
 * or gift id, or when a number matches a displayed dollar amount.
 */

function giftKindText(gift) {
  if (!gift) return "";
  if (gift.assist) return "Assist";
  if (gift.acIncrease) return "AC increase";
  if (gift.annualized) return "Monthly";
  return gift.giftType || "";
}

function formatGiftDay(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso || "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(+d)) return String(iso || "");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function textHaystack(gift, donorName) {
  const day = gift?.day || "";
  return [
    donorName,
    gift?.owner,
    giftKindText(gift),
    gift?.giftType,
    gift?.project,
    gift?.segment,
    gift?.kindLabel,
    gift?.label,
    day,
    formatGiftDay(day),
    gift?.giftId,
  ]
    .filter((part) => part != null && String(part).trim() !== "")
    .join(" ")
    .toLowerCase();
}

function textHasToken(text, token) {
  if (!/^\d+$/.test(token)) return text.includes(token);
  return new RegExp(`(^|[^0-9])${token}([^0-9]|$)`).test(text);
}

function amountTokenMatches(raw, gift) {
  const target = Number(raw);
  if (!Number.isFinite(target)) return false;
  const fields = [gift?.amount, gift?.postedAmount, gift?.priorMonthly, gift?.newMonthly, gift?.giftAmount];
  for (const n of fields) {
    const v = Number(n);
    if (!Number.isFinite(v)) continue;
    if (Math.abs(v - target) < 0.005) return true;
    if (!raw.includes(".") && target === Math.round(v)) return true;
  }
  return false;
}

/**
 * Filter the counted gift rows already returned by listedGiftRows.
 * A blank query keeps the selected MA. A query with no MA searches everyone.
 * A query that misses the selected MA returns matches for the other MAs.
 *
 * @template T
 * @param {T[]} gifts
 * @param {{ owner?: string | null, query?: string, nameOf?: (gift: T) => string }} [opts]
 * @returns {{ rows: T[], widened: boolean }}
 */
export function filterListedGifts(gifts, { owner = null, query = "", nameOf = (g) => g?.contactName || "" } = {}) {
  const q = String(query || "").trim();
  const selected = owner || (q ? "all" : "");
  if (!selected) return { rows: [], widened: false };
  const matches = (g) => !q || giftMatchesQuery(g, q, nameOf(g));
  const scoped = (gifts || []).filter((g) => (selected === "all" || g.owner === selected) && matches(g));
  if (!q || scoped.length || !owner || owner === "all") return { rows: scoped, widened: false };
  const everywhere = (gifts || []).filter(matches);
  if (!everywhere.length) return { rows: [], widened: false };
  return { rows: everywhere, widened: true };
}

/** True when `query` is blank or every word matches this gift. */
export function giftMatchesQuery(gift, query, donorName = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const text = textHaystack(gift, donorName);
  return q.split(/\s+/).every((token) => {
    const stripped = token.replace(/[$,]/g, "");
    if (textHasToken(text, token) || (stripped !== token && textHasToken(text, stripped))) return true;
    if (/^\d+(\.\d+)?$/.test(stripped)) return amountTokenMatches(stripped, gift);
    return false;
  });
}
