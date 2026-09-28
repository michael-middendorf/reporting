"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  GIFT_NOTE_CHOICES,
  formatGiftAmount,
  formatGiftDay,
  giftNoteDraft,
} from "@/lib/reports/points/gift-note.js";
import "@/styles/points.css";

const NOTES_BASE = "https://app.virtuoussoftware.com/Generosity/Contact/Notes";

function GiftNoteForm() {
  const params = useSearchParams();
  const contactId = (params.get("contactId") || "").trim();
  const name = (params.get("name") || "").trim();
  const amount = params.get("amount") || "";
  const giftDay = params.get("day") || "";
  const project = (params.get("project") || "").trim();
  const money = formatGiftAmount(amount);
  const giftLabel = formatGiftDay(giftDay);
  const [typeId, setTypeId] = useState("gift");
  const [day, setDay] = useState(/^\d{4}-\d{2}-\d{2}$/.test(giftDay) ? giftDay : "");
  const [note, setNote] = useState(giftNoteDraft({ amount, day: giftDay }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedType, setSavedType] = useState("");

  const choice = GIFT_NOTE_CHOICES.find((item) => item.id === typeId) || GIFT_NOTE_CHOICES[0];
  const donor = name || "This contact";

  useEffect(() => {
    document.title = `Gift note · ${donor}`;
  }, [donor]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d+$/.test(contactId)) {
      setError("This gift has no Virtuous contact.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/reports/points/gift-note", {
        method: "POST",
        body: JSON.stringify({ contactId, type: choice.id, note, day }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save the note");
      setSavedType(choice.label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the note");
    } finally {
      setBusy(false);
    }
  }

  const meta = [money, giftLabel, project].filter(Boolean).join(" · ");

  return (
    <div className="gift-note-page">
      <form className="gift-note-card" onSubmit={onSubmit}>
        <div className="gift-note-accent" aria-hidden="true" />
        <div className="gift-note-body">
          <p className="gift-note-kicker">Gift note</p>
          <h1>{donor}</h1>
          {meta ? <p className="gift-note-meta">{meta}</p> : <p className="gift-note-meta">Virtuous contact {contactId || "—"}</p>}

          {savedType ? (
            <div className="gift-note-done">
              <p>Saved as {savedType} on {donor}.</p>
              {/^\d+$/.test(contactId) ? (
                <a href={`${NOTES_BASE}/${contactId}`} target="_blank" rel="noopener noreferrer">
                  Open notes in Virtuous
                </a>
              ) : null}
              <div className="gift-note-actions">
                <button type="button" className="gift-note-save" onClick={() => window.close()}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              <label className="gift-note-field">
                <span>Type</span>
                <select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
                  {GIFT_NOTE_CHOICES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="gift-note-typehint">{choice.type}</p>

              <label className="gift-note-field">
                <span>Date</span>
                <input type="date" value={day} required onChange={(event) => setDay(event.target.value)} />
              </label>

              <label className="gift-note-field">
                <span>Note</span>
                <textarea value={note} required rows={4} onChange={(event) => setNote(event.target.value)} />
              </label>

              {error ? <p className="gift-note-error">{error}</p> : null}

              <div className="gift-note-actions">
                <button type="submit" className="gift-note-save" disabled={busy}>
                  {busy ? "Saving…" : "Save note"}
                </button>
                <button type="button" className="gift-note-cancel" onClick={() => window.close()}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

export default function GiftNotePage() {
  return (
    <Suspense fallback={<p className="gift-note-loading">Loading…</p>}>
      <GiftNoteForm />
    </Suspense>
  );
}
