"use client";

type Cell = { gifts: number; amount: number; rate: number | null };
type Best = { id: string; label: string; amount: number; gifts: number; share: number; rate: number | null };
type Group = {
  id: string;
  label: string;
  detail: string;
  donors: number;
  gifts: number;
  amount: number;
  avg: number;
  best: Best | null;
  cells: Record<string, Cell>;
};
type Channel = { id: string; label: string; short: string };
type Conversation = {
  id: string;
  label: string;
  detail: string;
  phone: number;
  email: number;
  more: "phone" | "email" | "tie" | "none";
};
export type MonthTotal = {
  key: string;
  label: string;
  points: number;
  avgPerWeekday: number;
  weekdays: number;
  conversations: number;
  dials: number;
  convRate: number;
  gifts: number;
  giftAmount: number;
};
export type InsightsModel = {
  donors: number;
  findings: string[];
  knownRelationship: number;
  generations: Group[];
  relationships: Group[];
  donorTags: Group[];
  campaigns: Group[];
  generationChannels: Channel[];
  relationshipChannels: Channel[];
  campaignChannels: Channel[];
  conversations: Conversation[];
};

const money = (n: number | undefined) => `$${Math.round(n || 0).toLocaleString("en-US")}`;
const rate = (n: number) => `${(n * 100).toFixed(1)}%`;

function MonthTable({ rows }: { rows: MonthTotal[] }) {
  const total = rows.reduce(
    (sum, row) => {
      sum.points += row.points;
      sum.conversations += row.conversations;
      sum.dials += row.dials;
      sum.gifts += row.gifts;
      sum.giftAmount += row.giftAmount;
      sum.weekdays += row.weekdays;
      return sum;
    },
    { points: 0, conversations: 0, dials: 0, gifts: 0, giftAmount: 0, weekdays: 0 },
  );
  return (
    <>
      <h3 className="insight-head">Monthly totals</h3>
      <p className="footnote">
        Team points, conversations, dials, and raised dollars for each month in the selected dates.
        Avg/wkdy divides points by weekdays that had activity.
      </p>
      <div className="week-scroll">
        <table className="grid month-totals">
          <thead>
            <tr>
              <th>Months</th>
              <th>Points</th>
              <th>Avg/wkdy</th>
              <th>Convers</th>
              <th>Dials</th>
              <th>Conv Rate</th>
              <th>Gifts</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td className="pts tabular">{row.points.toLocaleString("en-US")}</td>
                <td className="tabular">{row.weekdays ? Math.round(row.avgPerWeekday).toLocaleString("en-US") : "—"}</td>
                <td className="tabular">{row.conversations.toLocaleString("en-US")}</td>
                <td className="tabular">{row.dials.toLocaleString("en-US")}</td>
                <td className="tabular">{row.dials ? rate(row.convRate) : "—"}</td>
                <td className="tabular">{row.gifts.toLocaleString("en-US")}</td>
                <td className="pts tabular">{money(row.giftAmount)}</td>
              </tr>
            ))}
            {rows.length > 1 ? (
              <tr className="grand">
                <td>Total</td>
                <td className="pts tabular">{total.points.toLocaleString("en-US")}</td>
                <td className="tabular">
                  {total.weekdays ? Math.round(total.points / total.weekdays).toLocaleString("en-US") : "—"}
                </td>
                <td className="tabular">{total.conversations.toLocaleString("en-US")}</td>
                <td className="tabular">{total.dials.toLocaleString("en-US")}</td>
                <td className="tabular">{total.dials ? rate(total.conversations / total.dials) : "—"}</td>
                <td className="tabular">{total.gifts.toLocaleString("en-US")}</td>
                <td className="pts tabular">{money(total.giftAmount)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SummaryTable({ groups }: { groups: Group[] }) {
  return (
    <div className="week-scroll">
    <table className="grid">
      <thead>
        <tr>
          <th>Group</th>
          <th>Donors</th>
          <th>Gifts</th>
          <th>Raised</th>
          <th>Avg gift</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.id}>
            <td>
              {group.label}
              {group.detail ? <div className="section-hint">{group.detail}</div> : null}
            </td>
            <td className="tabular">{group.donors}</td>
            <td className="tabular">{group.gifts}</td>
            <td className="pts tabular">{money(group.amount)}</td>
            <td className="tabular">{money(group.avg)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export function InsightsPanel({ insights, months = [] }: { insights: InsightsModel; months?: MonthTotal[] }) {
  const hasRows = insights.generations.length > 0 || insights.relationships.length > 0 || insights.donorTags.length > 0 || (insights.campaigns || []).length > 0;
  return (
    <section className="section" aria-labelledby="insights-heading">
      <h2 id="insights-heading">
        Insights <span className="section-hint">monthly totals, who gave, and which campaign</span>
      </h2>
      <div className="panel">
        {months.length > 0 ? <MonthTable rows={months} /> : null}
        {hasRows ? null : <p className="footnote">No counted gifts in this range.</p>}

        {insights.generations.length > 0 ? (
          <>
            <h3 className="insight-head">Age</h3>
            <SummaryTable groups={insights.generations} />
          </>
        ) : null}

        {insights.relationships.length > 0 ? (
          <>
            <h3 className="insight-head">Relationship to the university</h3>
            <SummaryTable groups={insights.relationships} />
          </>
        ) : null}

        {(insights.campaigns || []).length > 0 ? (
          <>
            <h3 className="insight-head">Reached by campaign</h3>
            <p className="footnote">Counted gifts by Virtuous campaign.</p>
            <SummaryTable groups={insights.campaigns} />
          </>
        ) : null}

        {insights.donorTags.length > 0 ? (
          <>
            <h3 className="insight-head">Giving history</h3>
            <SummaryTable groups={insights.donorTags} />
          </>
        ) : null}
      </div>
    </section>
  );
}
