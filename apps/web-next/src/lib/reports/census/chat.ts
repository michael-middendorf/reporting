/** Census meeting Q&A: briefing + tools against the same snapshot as the page. */

import { loadCensusSnapshot } from "./overlay";
import { buildCensusBriefing, countPeople, searchPeople } from "./briefing";

const MODEL = process.env.CENSUS_CHAT_MODEL || "grok-4.6";
const XAI_URL = "https://api.x.ai/v1/chat/completions";

type ChatMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: unknown;
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "lookup_person",
      description: "Find students by name or PCID on the FA26 census and/or FA25 prior census.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Name or PCID, e.g. Aiden Wilson or P000384377" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_people",
      description: "Count students on FA26 or FA25 matching filters. Returns n plus a short sample.",
      parameters: {
        type: "object",
        properties: {
          term: { type: "string", enum: ["fa26", "fa25"] },
          incoming: { type: "boolean" },
          ftca: { type: "boolean" },
          athlete: { type: "boolean" },
          football: { type: "boolean" },
          honors: { type: "boolean" },
          testScore: { type: "boolean" },
          catholic: { type: "boolean" },
          gender: { type: "string", enum: ["Male", "Female"] },
          sport: { type: "string" },
          residency: { type: "string" },
          unretained: { type: "boolean", description: "FA25 students not registered FA26 and not intervening graduates" },
        },
      },
    },
  },
];

export function censusChatConfigured(): boolean {
  return Boolean((process.env.XAI_API_KEY || "").trim());
}

export async function answerCensusQuestion(
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<{ answer: string; model: string }> {
  const key = (process.env.XAI_API_KEY || "").trim();
  if (!key) {
    throw Object.assign(new Error("Census Q&A is not configured (missing XAI_API_KEY)."), { status: 503 });
  }
  const { data, lists } = await loadCensusSnapshot();
  const briefing = buildCensusBriefing(data, lists);
  const system = [
    "You are the AMU Fall census brief for a live meeting with the president.",
    "You only use numbers from the BRIEFING JSON or TOOL results. Never invent a headcount or rate.",
    "If it is not in the briefing or a tool result, say it is not in this census.",
    "Be concise. Lead with the number. Name students when asked — this page already shows names.",
    "FTCA this fall is Incoming+FTCA (spring admits are Returning). Last fall Historical FTCA is 391 (gold 392 minus Aiden Wilson, dropped after census).",
    "BRIEFING:",
    JSON.stringify(briefing),
  ].join("\n");

  const messages: ChatMsg[] = [
    { role: "system", content: system },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question.trim() },
  ];

  for (let i = 0; i < 4; i++) {
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw Object.assign(new Error(`Census Q&A model error (${res.status}): ${text.slice(0, 400)}`), { status: 502 });
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    };
    const msg = json.choices?.[0]?.message;
    if (!msg) throw Object.assign(new Error("Empty model response"), { status: 502 });
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const answer = (msg.content || "").trim();
      return { answer: answer || "No answer returned.", model: MODEL };
    }
    messages.push({
      role: "assistant",
      content: msg.content || "",
      tool_calls: calls,
    });
    for (const call of calls) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      const result = runCensusTool(call.function.name, parsed, lists);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result),
      });
    }
  }
  return { answer: "I needed too many lookups. Ask a more specific question.", model: MODEL };
}

export function runCensusTool(name: string, args: Record<string, unknown>, lists: import("./lists-core").CensusLists) {
  if (name === "lookup_person") {
    return { people: searchPeople(lists, String(args.query || ""), 15) };
  }
  if (name === "count_people") {
    return countPeople(lists, {
      term: args.term === "fa25" ? "fa25" : "fa26",
      incoming: typeof args.incoming === "boolean" ? args.incoming : undefined,
      ftca: typeof args.ftca === "boolean" ? args.ftca : undefined,
      athlete: typeof args.athlete === "boolean" ? args.athlete : undefined,
      football: typeof args.football === "boolean" ? args.football : undefined,
      honors: typeof args.honors === "boolean" ? args.honors : undefined,
      testScore: typeof args.testScore === "boolean" ? args.testScore : undefined,
      catholic: typeof args.catholic === "boolean" ? args.catholic : undefined,
      gender: typeof args.gender === "string" ? args.gender : undefined,
      sport: typeof args.sport === "string" ? args.sport : undefined,
      residency: typeof args.residency === "string" ? args.residency : undefined,
      unretained: typeof args.unretained === "boolean" ? args.unretained : undefined,
    });
  }
  return { error: `Unknown tool ${name}` };
}
