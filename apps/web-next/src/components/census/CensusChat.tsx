"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

const SUGGESTIONS = [
  "Are we up or down versus last fall?",
  "Why is FTCA not 391 this year?",
  "What is FTCA retention vs last year?",
  "Why did students leave?",
  "Are athletes retaining?",
  "Who left with a 3.0+ GPA?",
];

type Turn = { role: "user" | "assistant"; content: string };

export function CensusChat() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/census-chat");
        const json = (await res.json()) as { configured?: boolean };
        if (alive) setConfigured(Boolean(json.configured));
      } catch {
        if (alive) setConfigured(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns, busy, open]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    setQuestion("");
    const next = [...turns, { role: "user" as const, content: q }];
    setTurns(next);
    setBusy(true);
    try {
      const res = await apiFetch("/api/census-chat", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          history: next.slice(0, -1).slice(-8),
        }),
      });
      const json = (await res.json()) as { answer?: string; error?: string };
      if (!res.ok) throw new Error(json.error || res.statusText);
      setTurns([...next, { role: "assistant", content: json.answer || "" }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="download census-chat-launch" onClick={() => setOpen((v) => !v)}>
        {open ? "Close Q&A" : "Ask census"}
      </button>
      {open && (
        <div className="census-chat" role="dialog" aria-label="Census Q&A">
          <div className="census-chat-head">
            <div>
              <div className="eyebrow">Meeting brief</div>
              <strong>Ask the live census</strong>
              <p>Same lists as this page. Won’t invent a number.</p>
            </div>
            <button type="button" className="census-chat-x" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          {configured === false && (
            <p className="census-chat-warn">Q&amp;A needs XAI_API_KEY on the server. Numbers on this page are still the census.</p>
          )}
          <div className="census-chat-chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" disabled={busy} onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="census-chat-log">
            {turns.length === 0 && (
              <p className="census-chat-empty">President-style prompts are above. You can also name a student.</p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`census-chat-msg ${t.role}`}>
                {t.content}
              </div>
            ))}
            {busy && <div className="census-chat-msg assistant">Looking at the census lists…</div>}
            <div ref={bottom} />
          </div>
          {error && <p className="census-chat-err">{error}</p>}
          <form
            className="census-chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about headcount, retention, a name…"
              disabled={busy}
            />
            <button type="submit" className="download" disabled={busy || !question.trim()}>
              Ask
            </button>
          </form>
        </div>
      )}
    </>
  );
}
