export type ImportDataset = "mail" | "email" | "digital";

type CsvRow = Record<string, string>;
const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const rate = (value: number, denominator: number) => denominator ? Math.round((value / denominator) * 1000) / 10 : null;

function parseCsv(text: string): CsvRow[] {
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
  if (rows.length < 2) throw new Error("CSV needs a header and at least one row");
  const headings = rows[0].map(normalize);
  return rows.slice(1).map((values) => Object.fromEntries(headings.map((heading, index) => [heading, values[index] || ""])));
}

const integer = (value: string, label: string, line: number) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Line ${line}: ${label} must be a whole number of zero or more`);
  return n;
};
const money = (value: string, label: string, line: number) => {
  const n = Number(value.replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`Line ${line}: ${label} must be a number`);
  return Math.round(n * 100) / 100;
};
const date = (value: string, label: string, line: number) => {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error(`Line ${line}: ${label} must be a valid date`);
  return parsed.toISOString();
};
const requireCampaign = (row: CsvRow, slug: string, line: number) => {
  if (row.campaignslug && row.campaignslug !== slug) throw new Error(`Line ${line}: campaign_slug must match ${slug}`);
};

export function parseAppealImport(text: string, dataset: ImportDataset, slug: string) {
  const rows = parseCsv(text);
  const seen = new Set<string>();
  const values = rows.map((row, index) => {
    const line = index + 2; requireCampaign(row, slug, line);
    if (dataset === "mail") {
      const mailingId = row.mailingid; const label = row.label; const dropDate = date(row.dropdate, "drop_date", line);
      if (!mailingId || !label) throw new Error(`Line ${line}: mailing_id and label are required`);
      if (seen.has(mailingId)) throw new Error(`Line ${line}: mailing_id ${mailingId} is duplicated`); seen.add(mailingId);
      return { mailingId, label, dropDate, creative: row.creative || null, totalMailed: integer(row.totalmailed, "total_mailed", line) };
    }
    if (dataset === "digital") {
      const key = [row.date, row.landingpage, row.source, row.medium].join("|");
      if (!row.date || !row.landingpage || !row.source || !row.medium) throw new Error(`Line ${line}: date, landing_page, source, and medium are required`);
      if (seen.has(key)) throw new Error(`Line ${line}: duplicate digital source row`); seen.add(key);
      return { date: date(row.date, "date", line).slice(0, 10), landingPage: row.landingpage, source: row.source, medium: row.medium, visits: integer(row.visits, "visits", line), conversions: integer(row.conversions, "conversions", line), attributedRevenue: money(row.attributedrevenue, "attributed_revenue", line) };
    }
    const emailId = row.emailid; const emailName = row.emailname; const sentAt = date(row.sentat, "sent_at", line);
    if (!emailId || !emailName) throw new Error(`Line ${line}: email_id and email_name are required`);
    if (!Number.isInteger(Number(emailId)) || Number(emailId) < 0) throw new Error(`Line ${line}: email_id must be a whole number of zero or more`);
    if (seen.has(emailId)) throw new Error(`Line ${line}: email_id ${emailId} is duplicated`); seen.add(emailId);
    const sent = integer(row.sent || row.recipients, "sent", line); const delivered = integer(row.delivered || row.sent || row.recipients, "delivered", line);
    const opens = integer(row.uniqueopens, "unique_opens", line); const clicks = integer(row.uniqueclicks, "unique_clicks", line); const conversions = integer(row.conversions || "0", "conversions", line); const unsubscribes = integer(row.unsubscribes || "0", "unsubscribes", line);
    if (delivered > sent || [opens, clicks, conversions, unsubscribes].some((n) => n > delivered)) throw new Error(`Line ${line}: engagement counts cannot exceed delivered`);
    return { emailId: Number(emailId), name: emailName, subject: row.subject || null, sentAt, sent, delivered, uniqueOpens: opens, uniqueClicks: clicks, conversions, unsubscribes, attributedRevenue: money(row.attributedrevenue || "0", "attributed_revenue", line), deliveryRate: rate(delivered, sent), openRate: rate(opens, delivered), clickRate: rate(clicks, delivered), conversionRate: rate(conversions, delivered), unsubscribeRate: rate(unsubscribes, delivered) };
  });
  return { generatedAt: new Date().toISOString(), campaignSlug: slug, dataset, rows: values };
}
