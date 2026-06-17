import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Check, X, Sun, Send, ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import type { Task, Priority } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Aktion {
  typ: "task_erstellen" | "task_erledigt" | "task_aktualisieren" | "notiz";
  task_titel: string;
  baustelle: string | null;
  assignee: string | null;
  prioritaet: "low" | "medium" | "high" | null;
  faellig_in_tagen: number | null;
  notiz: string | null;
}

interface ClaudeResponse {
  aktionen: Aktion[];
  zusammenfassung: string;
}

interface TagesData {
  done: Task[];
  created: Task[];
}

const PRIO_MAP: Record<string, Priority> = {
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
};

// ── Util ──────────────────────────────────────────────────────────────────────

function todayRange() {
  const today = new Date().toISOString().split("T")[0];
  return { from: today + "T00:00:00", to: today + "T23:59:59" };
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

type Phase = "idle" | "recording" | "thinking" | "confirm" | "tagesabschluss";

export function VoiceChat() {
  const tasks = useStore((s) => s.tasks);
  const users = useStore((s) => s.users);
  const areas = useStore((s) => s.areas);
  const currentUserId = useStore((s) => s.currentUserId);
  const createTask = useStore((s) => s.createTask);
  const setStatus = useStore((s) => s.setStatus);

  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [aktionen, setAktionen] = useState<Aktion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tagesData, setTagesData] = useState<TagesData | null>(null);
  const [fallbackText, setFallbackText] = useState("");

  const recRef = useRef<any>(null);

  const hasSpeechAPI =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // ── Claude API ──────────────────────────────────────────────────────────────

  const processTranscript = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setError("Keine Spracheingabe erkannt.");
        setPhase("idle");
        return;
      }

      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (!apiKey) {
        setError(
          "VITE_ANTHROPIC_API_KEY fehlt in .env – bitte eintragen und App neu starten."
        );
        setPhase("idle");
        return;
      }

      const systemPrompt = `Du bist ein KI-Assistent für die Elektriker-App OHMERA.
Der Nutzer spricht auf Deutsch und gibt dir Informationen über seine Baustellenarbeit.

Verfügbare Baustellen: ${areas.map((a) => a.name).join(", ") || "keine"}
Verfügbare Bearbeiter: ${users.map((u) => u.name).join(", ") || "keine"}
Offene Tasks heute: ${tasks
        .filter((t) => t.status !== "done")
        .map((t) => t.title)
        .join(", ") || "keine"}

Extrahiere aus der Spracheingabe eine oder mehrere Aktionen im JSON-Format:

{
  "aktionen": [
    {
      "typ": "task_erstellen" | "task_erledigt" | "task_aktualisieren" | "notiz",
      "task_titel": "string",
      "baustelle": "string oder null",
      "assignee": "string oder null",
      "prioritaet": "low" | "medium" | "high" | null,
      "faellig_in_tagen": number | null,
      "notiz": "string oder null"
    }
  ],
  "zusammenfassung": "string – kurze Bestätigung was du verstanden hast auf Deutsch"
}

Antworte NUR mit dem JSON, kein Text davor oder danach.`;

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{ role: "user", content: text }],
          }),
        });

        if (!res.ok) throw new Error(`Claude API: ${res.status} ${res.statusText}`);

        const data = await res.json();
        const raw = data.content?.[0]?.text ?? "{}";
        const parsed: ClaudeResponse = JSON.parse(raw);

        setAktionen(parsed.aktionen ?? []);
        setSummary(parsed.zusammenfassung ?? "");
        setPhase("confirm");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unbekannter Fehler");
        setPhase("idle");
      }
    },
    [areas, users, tasks]
  );

  // ── Sprachaufnahme ──────────────────────────────────────────────────────────

  const startRecording = useCallback(() => {
    const SpeechRec =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const rec = new SpeechRec();
    rec.lang = "de-DE";
    rec.continuous = false;
    rec.interimResults = true;

    let finalText = "";

    rec.onresult = (e: any) => {
      const interim = Array.from(e.results as SpeechRecognitionResultList)
        .map((r) => r[0].transcript)
        .join("");
      setTranscript(interim);
      finalText = Array.from(e.results as SpeechRecognitionResultList)
        .filter((r) => r.isFinal)
        .map((r) => r[0].transcript)
        .join("");
    };

    rec.onend = () => {
      const text = finalText || transcript;
      setTranscript(text);
      setPhase("thinking");
      void processTranscript(text);
    };

    rec.onerror = (e: any) => {
      setError(`Mikrofon-Fehler: ${e.error}`);
      setPhase("idle");
    };

    recRef.current = rec;
    setError(null);
    setTranscript("");
    setPhase("recording");
    rec.start();
  }, [processTranscript, transcript]);

  const stopRecording = useCallback(() => {
    recRef.current?.stop();
  }, []);

  // ── Fallback: Texteingabe ───────────────────────────────────────────────────

  const submitFallback = () => {
    const text = fallbackText.trim();
    if (!text) return;
    setTranscript(text);
    setFallbackText("");
    setPhase("thinking");
    void processTranscript(text);
  };

  // ── Aktionen ausführen ──────────────────────────────────────────────────────

  const executeAktionen = async () => {
    setPhase("thinking");
    for (const aktion of aktionen) {
      if (aktion.typ === "task_erledigt") {
        const match = tasks.find(
          (t) =>
            t.status !== "done" &&
            (t.title.toLowerCase().includes(aktion.task_titel.toLowerCase()) ||
              aktion.task_titel.toLowerCase().includes(t.title.toLowerCase()))
        );
        if (match) await setStatus(match.id, "done");
      } else if (aktion.typ === "task_erstellen") {
        const area = aktion.baustelle
          ? areas.find((a) =>
              a.name.toLowerCase().includes(aktion.baustelle!.toLowerCase())
            )
          : null;
        const owner = aktion.assignee
          ? users.find((u) =>
              u.name.toLowerCase().includes(aktion.assignee!.toLowerCase())
            )
          : null;

        const deadline =
          aktion.faellig_in_tagen != null
            ? new Date(Date.now() + aktion.faellig_in_tagen * 86400000)
                .toISOString()
                .split("T")[0]
            : null;

        await createTask(
          {
            title: aktion.task_titel,
            area_id: area?.id ?? areas[0]?.id ?? "",
            owner_id: owner?.id ?? currentUserId ?? users[0]?.id ?? "",
            priority: PRIO_MAP[aktion.prioritaet ?? ""] ?? "niedrig",
            deadline,
            no_deadline: deadline == null,
          },
          []
        );
      }
    }
    setAktionen([]);
    setSummary("");
    setTranscript("");
    setPhase("idle");
  };

  // ── Tagesabschluss ──────────────────────────────────────────────────────────

  const loadTagesabschluss = async () => {
    const { from, to } = todayRange();
    const [doneRes, createdRes] = await Promise.all([
      supabase.from("tasks").select("*").eq("status", "done").gte("done_at", from).lte("done_at", to),
      supabase.from("tasks").select("*").gte("created_at", from).lte("created_at", to),
    ]);
    setTagesData({
      done: (doneRes.data ?? []) as Task[],
      created: (createdRes.data ?? []) as Task[],
    });
    setPhase("tagesabschluss");
  };

  const tagesText = () => {
    if (!tagesData) return "";
    const today = new Date().toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const lines = [`Heute erledigt – ${today}`, ""];

    const byArea = new Map<string, Task[]>();
    for (const t of tagesData.done) {
      const aName = areas.find((a) => a.id === t.area_id)?.name ?? "Allgemein";
      if (!byArea.has(aName)) byArea.set(aName, []);
      byArea.get(aName)!.push(t);
    }
    for (const [area, ts] of byArea) {
      lines.push(`${area}:`);
      for (const t of ts) lines.push(`✓ ${t.title}`);
      lines.push("");
    }

    const newToday = tagesData.created.filter((t) => t.status !== "done");
    if (newToday.length) {
      lines.push("Neu erstellt heute:");
      for (const t of newToday) {
        const ownerName = users.find((u) => u.id === t.owner_id)?.name;
        const prefix = ownerName ? `${ownerName}: ` : "";
        const dl = t.deadline
          ? ` (${new Date(t.deadline).toLocaleDateString("de-DE")})`
          : "";
        lines.push(`+ ${prefix}${t.title}${dl}`);
      }
    }

    return lines.join("\n");
  };

  const mailtoLink = () =>
    `mailto:?subject=Tagesabschluss ${new Date().toLocaleDateString("de-DE")}&body=${encodeURIComponent(tagesText())}`;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col min-h-screen"
      style={{ background: "#08011a", color: "#e2d9f3" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "rgba(167,139,250,0.12)" }}
      >
        <span className="text-lg font-bold" style={{ color: "#a78bfa" }}>
          KI-Assistent
        </span>
        <button
          onClick={loadTagesabschluss}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{
            background: "rgba(251,191,36,0.12)",
            border: "1px solid rgba(251,191,36,0.3)",
            color: "#fbbf24",
          }}
        >
          <Sun className="h-3.5 w-3.5" />
          Tagesabschluss
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">

        {/* Error */}
        {error && (
          <div
            className="w-full rounded-xl p-3 text-sm"
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
            }}
          >
            {error}
          </div>
        )}

        {/* Phase: IDLE */}
        {phase === "idle" && (
          <>
            <div className="text-sm text-center opacity-50">
              Tippe auf den Mikrofon-Button und sprich auf Deutsch
            </div>

            <button
              onClick={hasSpeechAPI ? startRecording : undefined}
              disabled={!hasSpeechAPI && fallbackText === ""}
              className="flex items-center justify-center rounded-full transition-all active:scale-95"
              style={{
                width: 80,
                height: 80,
                background: "rgba(167,139,250,0.15)",
                border: "2px solid rgba(167,139,250,0.4)",
                boxShadow: "0 0 24px rgba(167,139,250,0.15)",
              }}
              aria-label="Aufnahme starten"
            >
              <Mic className="h-9 w-9" style={{ color: "#a78bfa" }} />
            </button>

            {!hasSpeechAPI && (
              <div
                className="w-full rounded-xl p-3 text-xs text-center opacity-60"
                style={{ border: "1px solid rgba(167,139,250,0.2)" }}
              >
                Web Speech API nicht verfügbar – nutze die Texteingabe unten
              </div>
            )}
          </>
        )}

        {/* Phase: RECORDING */}
        {phase === "recording" && (
          <>
            <div className="text-sm opacity-60 animate-pulse">
              Ich höre zu...
            </div>
            {transcript && (
              <div
                className="w-full rounded-xl p-3 text-sm italic opacity-70"
                style={{ background: "rgba(167,139,250,0.05)" }}
              >
                {transcript}
              </div>
            )}
            <button
              onClick={stopRecording}
              className="flex items-center justify-center rounded-full animate-pulse"
              style={{
                width: 80,
                height: 80,
                background: "rgba(239,68,68,0.2)",
                border: "2px solid rgba(239,68,68,0.6)",
                boxShadow: "0 0 32px rgba(239,68,68,0.3)",
              }}
              aria-label="Aufnahme stoppen"
            >
              <MicOff className="h-9 w-9" style={{ color: "#f87171" }} />
            </button>
            <div className="text-xs opacity-40">Nochmal tippen zum Stoppen</div>
          </>
        )}

        {/* Phase: THINKING */}
        {phase === "thinking" && (
          <>
            <div className="text-sm opacity-60">Verarbeite...</div>
            {transcript && (
              <div
                className="w-full rounded-xl p-3 text-sm"
                style={{
                  background: "rgba(167,139,250,0.08)",
                  border: "1px solid rgba(167,139,250,0.15)",
                }}
              >
                <span className="text-xs opacity-50 block mb-1">Gehört:</span>
                {transcript}
              </div>
            )}
            <div
              className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "#a78bfa", borderTopColor: "transparent" }}
            />
          </>
        )}

        {/* Phase: CONFIRM */}
        {phase === "confirm" && (
          <div className="w-full flex flex-col gap-4">
            {transcript && (
              <div
                className="rounded-xl p-3 text-sm"
                style={{
                  background: "rgba(167,139,250,0.06)",
                  border: "1px solid rgba(167,139,250,0.12)",
                }}
              >
                <span className="text-xs opacity-40 block mb-1">Deine Eingabe:</span>
                {transcript}
              </div>
            )}

            <div
              className="rounded-xl p-4"
              style={{
                background: "rgba(167,139,250,0.1)",
                border: "1px solid rgba(167,139,250,0.25)",
              }}
            >
              <p className="text-sm font-semibold mb-3" style={{ color: "#a78bfa" }}>
                Claude versteht:
              </p>
              <p className="text-sm mb-3">{summary}</p>

              {aktionen.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {aktionen.map((a, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs rounded-lg p-2"
                      style={{ background: "rgba(255,255,255,0.04)" }}
                    >
                      <span
                        className="rounded px-1.5 py-0.5 font-bold shrink-0"
                        style={{
                          background:
                            a.typ === "task_erledigt"
                              ? "rgba(34,197,94,0.2)"
                              : "rgba(167,139,250,0.2)",
                          color:
                            a.typ === "task_erledigt" ? "#86efac" : "#c4b5fd",
                          fontSize: 10,
                        }}
                      >
                        {a.typ === "task_erstellen"
                          ? "NEU"
                          : a.typ === "task_erledigt"
                          ? "ERLEDIGT"
                          : a.typ === "task_aktualisieren"
                          ? "UPDATE"
                          : "NOTIZ"}
                      </span>
                      <div>
                        <span className="font-medium">{a.task_titel}</span>
                        {a.baustelle && (
                          <span className="opacity-50"> · {a.baustelle}</span>
                        )}
                        {a.assignee && (
                          <span className="opacity-50"> · {a.assignee}</span>
                        )}
                        {a.faellig_in_tagen != null && (
                          <span className="opacity-50">
                            {" "}
                            · in {a.faellig_in_tagen} Tag
                            {a.faellig_in_tagen !== 1 ? "en" : ""}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={executeAktionen}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-sm"
                style={{
                  background: "rgba(34,197,94,0.15)",
                  border: "1px solid rgba(34,197,94,0.4)",
                  color: "#86efac",
                }}
              >
                <Check className="h-4 w-4" />
                Ja, stimmt so
              </button>
              <button
                onClick={() => {
                  setPhase("idle");
                  setAktionen([]);
                  setSummary("");
                  setTranscript("");
                  setError(null);
                }}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-sm"
                style={{
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  color: "#fca5a5",
                }}
              >
                <X className="h-4 w-4" />
                Nein, nochmal
              </button>
            </div>
          </div>
        )}

        {/* Phase: TAGESABSCHLUSS */}
        {phase === "tagesabschluss" && tagesData && (
          <div className="w-full flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="font-bold" style={{ color: "#fbbf24" }}>
                Heute – {new Date().toLocaleDateString("de-DE")}
              </span>
              <button
                onClick={() => setPhase("idle")}
                className="p-1 rounded opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Erledigt */}
            {tagesData.done.length > 0 ? (
              <div
                className="rounded-xl p-4 text-sm"
                style={{
                  background: "rgba(34,197,94,0.07)",
                  border: "1px solid rgba(34,197,94,0.2)",
                }}
              >
                {(() => {
                  const byArea = new Map<string, Task[]>();
                  for (const t of tagesData.done) {
                    const aName =
                      areas.find((a) => a.id === t.area_id)?.name ?? "Allgemein";
                    if (!byArea.has(aName)) byArea.set(aName, []);
                    byArea.get(aName)!.push(t);
                  }
                  return [...byArea.entries()].map(([area, ts]) => (
                    <div key={area} className="mb-3 last:mb-0">
                      <p className="text-xs font-bold mb-1 opacity-60">{area}</p>
                      {ts.map((t) => (
                        <p key={t.id} className="flex items-center gap-1.5">
                          <span style={{ color: "#86efac" }}>✓</span>
                          {t.title}
                        </p>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <p className="text-sm opacity-40 text-center">
                Noch nichts erledigt heute
              </p>
            )}

            {/* Neu erstellt */}
            {tagesData.created.filter((t) => t.status !== "done").length > 0 && (
              <div
                className="rounded-xl p-4 text-sm"
                style={{
                  background: "rgba(167,139,250,0.07)",
                  border: "1px solid rgba(167,139,250,0.2)",
                }}
              >
                <p className="text-xs font-bold mb-2 opacity-60">Neu erstellt heute:</p>
                {tagesData.created
                  .filter((t) => t.status !== "done")
                  .map((t) => {
                    const ownerName = users.find((u) => u.id === t.owner_id)?.name;
                    return (
                      <p key={t.id} className="flex items-center gap-1.5">
                        <span style={{ color: "#a78bfa" }}>+</span>
                        {ownerName && (
                          <span className="font-semibold opacity-70">
                            {ownerName}:{" "}
                          </span>
                        )}
                        {t.title}
                      </p>
                    );
                  })}
              </div>
            )}

            {/* Aktionen */}
            <div className="flex gap-3">
              <button
                onClick={() => window.print()}
                className="flex-1 rounded-xl py-2.5 text-xs font-semibold"
                style={{
                  background: "rgba(167,139,250,0.1)",
                  border: "1px solid rgba(167,139,250,0.25)",
                  color: "#c4b5fd",
                }}
              >
                Als PDF
              </button>
              <a
                href={mailtoLink()}
                className="flex-1 flex items-center justify-center rounded-xl py-2.5 text-xs font-semibold"
                style={{
                  background: "rgba(167,139,250,0.1)",
                  border: "1px solid rgba(167,139,250,0.25)",
                  color: "#c4b5fd",
                }}
              >
                Per Mail
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Texteingabe (Fallback oder immer sichtbar) */}
      {(phase === "idle" || !hasSpeechAPI) && phase !== "tagesabschluss" && (
        <div
          className="p-4 border-t"
          style={{ borderColor: "rgba(167,139,250,0.1)" }}
        >
          <div className="flex gap-2">
            <textarea
              value={fallbackText}
              onChange={(e) => setFallbackText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitFallback();
                }
              }}
              placeholder="Oder direkt tippen… (Enter = Senden)"
              rows={2}
              className="flex-1 resize-none rounded-xl px-3 py-2 text-sm outline-none"
              style={{
                background: "rgba(167,139,250,0.06)",
                border: "1px solid rgba(167,139,250,0.2)",
                color: "#e2d9f3",
              }}
            />
            <button
              onClick={submitFallback}
              disabled={!fallbackText.trim()}
              className="flex items-center justify-center rounded-xl px-3 disabled:opacity-30"
              style={{
                background: "rgba(167,139,250,0.15)",
                border: "1px solid rgba(167,139,250,0.3)",
              }}
            >
              <Send className="h-4 w-4" style={{ color: "#a78bfa" }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
