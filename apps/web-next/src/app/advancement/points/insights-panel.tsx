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
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
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
          <th>Best contact</th>
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
            <td>
              {group.best ? (
                <>
                  {group.best.label}
                  <div className="section-hint">
                    {money(group.best.amount)} · {pct(group.best.share)} of this row
                    {group.best.rate != null ? ` · ${pct(group.best.rate)} of people reached this way gave` : ""}
                  </div>
                </>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function moreLabel(more: Conversation["more"]) {
  if (more === "phone") return "Phone conversation";
  if (more === "email") return "Email conversation";
  if (more === "tie") return "Tie";
  return "—";
}

function ConversationTable({ rows }: { rows: Conversation[] }) {
  const any = rows.some((row) => row.phone > 0 || row.email > 0);
  if (!any) return <p className="footnote">No phone or email conversations in this range.</p>;
  return (
    <div className="week-scroll">
      <table className="grid">
        <thead>
          <tr>
            <th>Group</th>
            <th>Phone conversation</th>
            <th>Email conversation</th>
            <th>More common</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                {row.label}
                {row.detail ? <div className="section-hint">{row.detail}</div> : null}
              </td>
              <td className={row.more === "phone" || row.more === "tie" ? "insight-best tabular" : "tabular"}>
                {row.phone > 0 ? row.phone.toLocaleString("en-US") : "—"}
              </td>
              <td className={row.more === "email" || row.more === "tie" ? "insight-best tabular" : "tabular"}>
                {row.email > 0 ? row.email.toLocaleString("en-US") : "—"}
              </td>
              <td>{moreLabel(row.more)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Matrix({ groups, channels }: { groups: Group[]; channels: Channel[] }) {
  if (!groups.length || !channels.length) return null;
  return (
    <div className="week-scroll">
      <table className="grid insight-matrix">
        <thead>
          <tr>
            <th>Group</th>
            {channels.map((channel) => (
              <th key={channel.id} title={channel.label}>{channel.short}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.id}>
              <td>{group.label}</td>
              {channels.map((channel) => {
                const cell = group.cells[channel.id];
                const best = group.best?.id === channel.id && (cell?.gifts || 0) > 0;
                return (
                  <td key={channel.id} className={best ? "insight-best tabular" : "tabular"}>
                    {cell?.gifts ? money(cell.amount) : "—"}
                  </td>
                );
              })}
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
        Insights <span className="section-hint">monthly totals, who gave, which campaign, and which contact came before the gift</span>
      </h2>
      <div className="panel">
        {months.length > 0 ? <MonthTable rows={months} /> : null}
        {hasRows ? null : <p className="footnote">No counted gifts in this range.</p>}

        {insights.generations.length > 0 ? (
          <>
            <h3 className="insight-head">Age</h3>
            <SummaryTable groups={insights.generations} />
            <h3 className="insight-head">Dollars by generation and contact type</h3>
            <Matrix groups={insights.generations} channels={insights.generationChannels} />
          </>
        ) : null}

        <h3 className="insight-head">Phone vs email conversations</h3>
        <ConversationTable rows={insights.conversations || []} />

        {insights.relationships.length > 0 ? (
          <>
            <h3 className="insight-head">Relationship to the university</h3>
            <SummaryTable groups={insights.relationships} />
            <h3 className="insight-head">Dollars by relationship and contact type</h3>
            <Matrix groups={insights.relationships} channels={insights.relationshipChannels} />
          </>
        ) : null}

        {(insights.campaigns || []).length > 0 ? (
          <>
            <h3 className="insight-head">Reached by campaign</h3>
            <p className="footnote">Counted gifts by Virtuous campaign, and the contact that came before the gift.</p>
            <SummaryTable groups={insights.campaigns} />
            <h3 className="insight-head">Dollars by campaign and contact type</h3>
            <Matrix groups={insights.campaigns} channels={insights.campaignChannels || []} />
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
