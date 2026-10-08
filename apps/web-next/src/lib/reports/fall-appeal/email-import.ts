export const EMAIL_PERFORMANCE_KEY = "fall-appeal/email-performance.json";

const SEGMENTS: Record<number, [string, string]> = {
  93: ["active_donors", "Active Donors"], 94: ["active_donors", "Active Donors"], 95: ["active_donors", "Active Donors"],
  96: ["lapsed_12_24", "Lapsed 12–24 Months"], 97: ["lapsed_12_24", "Lapsed 12–24 Months"], 98: ["lapsed_12_24", "Lapsed 12–24 Months"],
  99: ["lapsed_24_48", "Lapsed 24–48 Months"], 100: ["lapsed_24_48", "Lapsed 24–48 Months"], 101: ["lapsed_24_48", "Lapsed 24–48 Months"],
  102: ["thank_you", "All Donors — Thank You"],
};

type Send = {
  emailId: number;
  emailNumber?: number | null;
  name: string;
  subject: string | null;
  sentAt: string;
  recipients: number;
  uniqueOpens: number;
  openRate: number | null;
  uniqueClicks: number;
  clickRate: number | null;
  revenue?: number | null;
  gifts?: number | null;
  avgGift?: number | null;
};
const rate = (n: number, d: number) => d ? Math.round((1000 * n) / d) / 10 : null;
const header = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

function csv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += c; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted value");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseEmailPerformanceCsv(text: string) {
  const rows = csv(text);
  if (rows.length < 2) throw new Error("CSV needs a header and at least one send");
  const headings = rows[0].map(header);
  const required = ["emailid", "emailname", "subject", "sentat", "recipients", "uniqueopens", "uniqueclicks"];
  const indexes = required.map((name) => headings.indexOf(name));
  if (indexes.some((i) => i < 0)) throw new Error("CSV headers must be email_id, email_name, subject, sent_at, recipients, unique_opens, unique_clicks");
  const emailNumIndex = headings.findIndex((h) => ["emailnumber", "emailnum", "sendnumber", "number"].includes(h));
  const revIndex = headings.findIndex((h) => ["revenue", "attributedrevenue"].includes(h));
  const giftsIndex = headings.findIndex((h) => ["gifts", "conversions"].includes(h));

  const sends: Send[] = []; const seen = new Set<number>();
  for (const [line, row] of rows.slice(1).map((r, i) => [i + 2, r] as const)) {
    const value = (name: string) => row[indexes[required.indexOf(name)]] || "";
    const emailId = Number(value("emailid")); const recipients = Number(value("recipients")); const opens = Number(value("uniqueopens")); const clicks = Number(value("uniqueclicks"));
    if (!SEGMENTS[emailId]) throw new Error(`Line ${line}: email_id must be an approved Fall 2026 send`);
    if (seen.has(emailId)) throw new Error(`Line ${line}: email_id ${emailId} is duplicated`);
    if (![recipients, opens, clicks].every((n) => Number.isInteger(n) && n >= 0) || opens > recipients || clicks > recipients) throw new Error(`Line ${line}: engagement counts must be whole numbers from 0 to recipients`);
    const sent = new Date(value("sentat"));
    if (Number.isNaN(sent.getTime())) throw new Error(`Line ${line}: sent_at must be a valid date/time`);
    const name = value("emailname"); if (!name) throw new Error(`Line ${line}: email_name is required`);

    let emailNumber: number | null = null;
    if (emailNumIndex >= 0) {
      const v = (row[emailNumIndex] || "").trim();
      if (v) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) throw new Error(`Line ${line}: email_number must be a positive whole number`);
        emailNumber = n;
      }
    }

    let revenue: number | null = null;
    if (revIndex >= 0) {
      const v = (row[revIndex] || "").trim();
      if (v) {
        const n = Number(v.replace(/[$,]/g, ""));
        if (!Number.isFinite(n) || n < 0) throw new Error(`Line ${line}: revenue must be a non-negative number`);
        revenue = Math.round(n * 100) / 100;
      }
    }

    let gifts: number | null = null;
    if (giftsIndex >= 0) {
      const v = (row[giftsIndex] || "").trim();
      if (v) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) throw new Error(`Line ${line}: gifts must be a non-negative whole number`);
        gifts = n;
      }
    }

    const avgGift = gifts && revenue != null ? Math.round((revenue / gifts) * 100) / 100 : (revenue != null && gifts === 0 ? 0 : null);

    seen.add(emailId);
    sends.push({
      emailId,
      emailNumber,
      name,
      subject: value("subject") || null,
      sentAt: sent.toISOString(),
      recipients,
      uniqueOpens: opens,
      openRate: rate(opens, recipients),
      uniqueClicks: clicks,
      clickRate: rate(clicks, recipients),
      revenue,
      gifts,
      avgGift,
    });
  }

  const groups = new Map<string, {
    key: string;
    label: string;
    recipients: number;
    uniqueOpens: number;
    uniqueClicks: number;
    revenue: number | null;
    gifts: number | null;
    avgGift: number | null;
    sends: Send[];
  }>();

  for (const send of sends) {
    const [key, label] = SEGMENTS[send.emailId];
    const group = groups.get(key) || {
      key,
      label,
      recipients: 0,
      uniqueOpens: 0,
      uniqueClicks: 0,
      revenue: null,
      gifts: null,
      avgGift: null,
      sends: [],
    };
    group.recipients += send.recipients;
    group.uniqueOpens += send.uniqueOpens;
    group.uniqueClicks += send.uniqueClicks;
    if (send.revenue != null) {
      group.revenue = Math.round(((group.revenue ?? 0) + send.revenue) * 100) / 100;
    }
    if (send.gifts != null) {
      group.gifts = (group.gifts ?? 0) + send.gifts;
    }
    group.sends.push(send);
    groups.set(key, group);
  }

  const segments = [...groups.values()].map((group) => {
    const sortedSends = group.sends.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    sortedSends.forEach((s, idx) => {
      if (s.emailNumber == null) {
        s.emailNumber = idx + 1;
      }
    });
    const avgGift = group.gifts && group.revenue != null
      ? Math.round((group.revenue / group.gifts) * 100) / 100
      : (group.revenue != null && group.gifts === 0 ? 0 : null);
    return {
      ...group,
      sends: sortedSends,
      avgGift,
      openRate: rate(group.uniqueOpens, group.recipients),
      clickRate: rate(group.uniqueClicks, group.recipients),
    };
  }).sort((a, b) => Number(a.key === "thank_you") - Number(b.key === "thank_you") || a.label.localeCompare(b.label));

  return { generatedAt: new Date().toISOString(), sourceSyncedAt: null, source: "manual_csv", segments };
}
