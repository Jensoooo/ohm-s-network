import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Pause, Square, Play, Check, X, Sun, Send, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import type { Task, Priority } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = "idle" | "recording" | "paused" | "thinking" | "confirm" | "antworten" | "tagesabschluss";

interface ConversationTurn {
  rolle: "user" | "assistant";
  text: string;
}

type Aktion =
  | { typ: "task_erstellen"; titel: string; baustelle?: string | null; assignee?: string | null; prioritaet?: "low" | "medium" | "high" | null; faellig_in_tagen?: number | null }
  | { typ: "task_erledigt"; task_id?: string; task_titel?: string }
  | { typ: "task_loeschen"; task_id?: string; task_titel?: string; grund?: string }
  | { typ: "material_erfasst"; raw_text: string; menge?: number | null; einheit?: string | null; artikel_name?: string | null; task_id?: string | null }
  | { typ: "rueckfrage"; frage: string };

interface ClaudeResponse {
  aktionen: Aktion[];
  rueckfrage: string | null;
  gespraech_beendet: boolean;
}

interface MaterialRow {
  id: string;
  raw_text: string;
  menge: number | null;
  einheit: string | null;
  artikel_name: string | null;
  area_id: string | null;
  task_id: string | null;
  created_at: string;
}

interface TagesData {
  done: Task[];
  created: Task[];
  material: MaterialRow[];
}

const PRIO_MAP: Record<string, Priority> = {
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
};

const SILENCE_MS = 9000;

function todayRange() {
  const today = new Date().toISOString().split("T")[0];
  return { from: today + "T00:00:00", to: today + "T23:59:59" };
}

function formatMaterial(m: { menge?: number | null; einheit?: string | null; artikel_name?: string | null; raw_text: string }) {
  if (m.menge) return `${m.menge}${m.einheit ? " " + m.einheit : "x"} ${m.artikel_name ?? m.raw_text}`;
  return m.artikel_name ?? m.raw_text;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function VoiceChat() {
  const tasks = useStore((s) => s.tasks);
  const users = useStore((s) => s.users);
  const areas = useStore((s) => s.areas);
  const loaded = useStore((s) => s.loaded);
  const load = useStore((s) => s.load);
  const currentUserId = useStore((s) => s.currentUserId);
  const createTask = useStore((s) => s.createTask);
  const setStatus = useStore((s) => s.setStatus);
  const deleteTask = useStore((s) => s.deleteTask);

  const [phase, setPhase] = useState<Phase>("idle");
  const [transcriptBuffer, setTranscriptBuffer] = useState("");
  const [aktionen, setAktionen] = useState<Aktion[]>([]);
  const [rueckfrage, setRueckfrage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagesData, setTagesData] = useState<TagesData | null>(null);
  const [fallbackText, setFallbackText] = useState("");
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [sessionEnding, setSessionEnding] = useState(false);

  // Refs for values needed inside recording callbacks without stale closures
  const recRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptBufferRef = useRef("");
  const intentionalStopRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  // Always up-to-date processTranscript — avoids stale closure in recording onend
  const processTranscriptRef = useRef<(text: string) => Promise<void>>(async () => {});

  phaseRef.current = phase;

  // Sicherstellen dass Store geladen ist wenn direkt auf /voice navigiert wird
  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);

  const hasSpeechAPI =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const updateBuffer = useCallback((text: string) => {
    transcriptBufferRef.current = text;
    setTranscriptBuffer(text);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // ── System prompt ──────────────────────────────────────────────────────────

  const buildSystemPrompt = useCallback(
    (history: ConversationTurn[]) => {
      const offeneTasks = tasks
        .filter((t) => t.status !== "done")
        .map((t) => {
          const aName = areas.find((a) => a.id === t.area_id)?.name ?? "";
          return `  - id="${t.id}" titel="${t.title}"${aName ? ` baustelle="${aName}"` : ""}`;
        })
        .join("\n");

      const verlaufText = history
        .slice(-5)
        .map((t) => `${t.rolle === "user" ? "Elektriker" : "Assistent"}: ${t.text}`)
        .join("\n");

      const baustellenListe = areas.map((a) => a.name).join(", ") || "keine";
      console.log("[VoiceChat] Store loaded:", loaded, "| Baustellen:", baustellenListe, "| Bearbeiter:", users.map((u) => u.name).join(", ") || "keine", "| Offene Tasks:", tasks.filter((t) => t.status !== "done").length);

      return `Du bist ein aufmerksamer Assistent für einen Elektriker (App: OHMERA). Der Elektriker spricht Deutsch und berichtet von der Baustelle.

Verfügbare Baustellen: ${baustellenListe}
Verfügbare Bearbeiter: ${users.map((u) => u.name).join(", ") || "keine"}

Offene Tasks (nutze die id-Felder für task_erledigt/task_loeschen):
${offeneTasks || "  (keine offenen Tasks)"}

${history.length > 0 ? `Bisheriger Gesprächsverlauf:\n${verlaufText}\n` : ""}
Nach jeder Eingabe des Elektrikers:
1. Erkenne und erfasse alle Aktionen (Task erstellen/erledigen, Material notieren)
2. Prüfe ob Material erwähnt wurde — wenn nicht: frage proaktiv danach
3. Schau ob andere offene Tasks an derselben Baustelle nicht erwähnt wurden — wenn ja, erwähne sie kurz
4. Gib immer eine kurze natürliche Rückfrage — außer der Elektriker signalisiert "fertig", "das wars", "alles", "mehr nicht"

REGELN:
- task_loeschen: NUR wenn der Elektriker das explizit gefordert hat im aktuellen Gespräch
- Bei Unsicherheit welcher Task gemeint ist: Typ "rueckfrage" statt raten
- Material: raw_text immer speichern, nie nach genauer Menge nachfragen
- Antworte NUR mit JSON, kein Text davor/danach

JSON-Format der Antwort:
{
  "aktionen": [
    { "typ": "task_erstellen", "titel": "string", "baustelle": "string|null", "assignee": "string|null", "prioritaet": "low|medium|high|null", "faellig_in_tagen": null },
    { "typ": "task_erledigt", "task_id": "uuid-string", "task_titel": "string" },
    { "typ": "task_loeschen", "task_id": "uuid-string", "task_titel": "string", "grund": "string|null" },
    { "typ": "material_erfasst", "raw_text": "string", "menge": null, "einheit": null, "artikel_name": null },
    { "typ": "rueckfrage", "frage": "string" }
  ],
  "rueckfrage": "deine proaktive Rückfrage an den Elektriker (string oder null)",
  "gespraech_beendet": false
}`;
    },
    [tasks, areas, users, loaded]
  );

  // ── Claude API ─────────────────────────────────────────────────────────────

  const callClaude = useCallback(
    async (text: string, history: ConversationTurn[]): Promise<ClaudeResponse> => {
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("API-Key fehlt (VITE_ANTHROPIC_API_KEY).");

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: buildSystemPrompt(history),
          messages: [{ role: "user", content: text }],
        }),
      });

      if (!res.ok) throw new Error(`Claude API: ${res.status} ${res.statusText}`);

      const data = await res.json();
      const rawText: string = data.content?.[0]?.text ?? "{}";
      const raw = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      return JSON.parse(raw) as ClaudeResponse;
    },
    [buildSystemPrompt]
  );

  // ── Process transcript ─────────────────────────────────────────────────────

  const processTranscript = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setError("Keine Spracheingabe erkannt.");
        setPhase("idle");
        return;
      }

      setPhase("thinking");

      try {
        const parsed = await callClaude(text, conversationHistory);
        const assistantText = parsed.rueckfrage ?? "";

        setConversationHistory((prev) => [
          ...prev,
          { rolle: "user" as const, text },
          ...(assistantText ? [{ rolle: "assistant" as const, text: assistantText }] : []),
        ]);

        updateBuffer("");
        setAktionen(parsed.aktionen ?? []);
        setRueckfrage(parsed.rueckfrage ?? null);
        setSessionEnding(parsed.gespraech_beendet ?? false);
        setPhase("confirm");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unbekannter Fehler");
        setPhase("idle");
      }
    },
    [callClaude, conversationHistory, updateBuffer]
  );

  processTranscriptRef.current = processTranscript;

  // ── Recording engine ───────────────────────────────────────────────────────

  const startRecordingSession = useCallback(() => {
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    const rec = new SpeechRec();
    rec.lang = "de-DE";
    rec.continuous = true;
    rec.interimResults = true;

    const priorBuffer = transcriptBufferRef.current;
    let sessionFinal = "";

    rec.onresult = (e: any) => {
      sessionFinal = Array.from(e.results as SpeechRecognitionResultList)
        .filter((r) => r.isFinal)
        .map((r) => r[0].transcript)
        .join("");

      const combined = priorBuffer ? priorBuffer.trimEnd() + " " + sessionFinal : sessionFinal;
      updateBuffer(combined);

      // Reset silence auto-pause timer
      clearSilenceTimer();
      silenceTimerRef.current = setTimeout(() => {
        intentionalStopRef.current = false;
        rec.stop();
      }, SILENCE_MS);
    };

    rec.onend = () => {
      clearSilenceTimer();
      if (intentionalStopRef.current) {
        void processTranscriptRef.current(transcriptBufferRef.current);
      } else {
        setPhase("paused");
      }
    };

    rec.onerror = (e: any) => {
      clearSilenceTimer();
      if (e.error === "no-speech" || e.error === "aborted") {
        setPhase("paused");
      } else {
        setError(`Mikrofon-Fehler: ${e.error}`);
        setPhase("idle");
      }
    };

    recRef.current = rec;
    rec.start();

    // Initial silence timer
    silenceTimerRef.current = setTimeout(() => {
      intentionalStopRef.current = false;
      rec.stop();
    }, SILENCE_MS);
  }, [updateBuffer, clearSilenceTimer]);

  const startRecording = useCallback(() => {
    setError(null);
    updateBuffer("");
    intentionalStopRef.current = false;
    setPhase("recording");
    startRecordingSession();
  }, [startRecordingSession, updateBuffer]);

  const pauseRecording = useCallback(() => {
    clearSilenceTimer();
    intentionalStopRef.current = false;
    setPhase("paused");
    recRef.current?.stop();
  }, [clearSilenceTimer]);

  const resumeRecording = useCallback(() => {
    intentionalStopRef.current = false;
    setPhase("recording");
    startRecordingSession();
  }, [startRecordingSession]);

  const stopRecording = useCallback(() => {
    clearSilenceTimer();
    intentionalStopRef.current = true;
    setPhase("thinking");
    if (phaseRef.current === "paused") {
      // rec already stopped — process directly
      void processTranscriptRef.current(transcriptBufferRef.current);
    } else {
      recRef.current?.stop(); // onend will call processTranscriptRef.current
    }
  }, [clearSilenceTimer]);

  // ── Execute actions ────────────────────────────────────────────────────────

  const executeAktionen = useCallback(async () => {
    setPhase("thinking");

    for (const aktion of aktionen) {
      if (aktion.typ === "task_loeschen") continue; // handled separately

      if (aktion.typ === "task_erledigt") {
        let match: Task | undefined;
        if (aktion.task_id) match = tasks.find((t) => t.id === aktion.task_id);
        if (!match && aktion.task_titel) {
          const lc = aktion.task_titel.toLowerCase();
          match = tasks.find(
            (t) =>
              t.status !== "done" &&
              (t.title.toLowerCase().includes(lc) || lc.includes(t.title.toLowerCase()))
          );
        }
        if (match) await setStatus(match.id, "done");

      } else if (aktion.typ === "task_erstellen") {
        const area = aktion.baustelle
          ? areas.find((a) => a.name.toLowerCase().includes(aktion.baustelle!.toLowerCase()))
          : null;
        const owner = aktion.assignee
          ? users.find((u) => u.name.toLowerCase().includes(aktion.assignee!.toLowerCase()))
          : null;
        const deadline =
          aktion.faellig_in_tagen != null
            ? new Date(Date.now() + aktion.faellig_in_tagen * 86400000).toISOString().split("T")[0]
            : null;

        await createTask(
          {
            title: aktion.titel,
            area_id: area?.id ?? areas[0]?.id ?? "",
            owner_id: owner?.id ?? currentUserId ?? users[0]?.id ?? "",
            priority: PRIO_MAP[aktion.prioritaet ?? ""] ?? "niedrig",
            deadline,
            no_deadline: deadline == null,
          },
          []
        );

      } else if (aktion.typ === "material_erfasst") {
        let areaId: string | null = null;
        if (aktion.task_id) {
          const t = tasks.find((t) => t.id === aktion.task_id);
          if (t) areaId = t.area_id;
        }
        try {
          await (supabase as any).from("material_usage").insert({
            raw_text: aktion.raw_text,
            menge: aktion.menge ?? null,
            einheit: aktion.einheit ?? null,
            artikel_name: aktion.artikel_name ?? null,
            task_id: aktion.task_id ?? null,
            area_id: areaId,
          });
        } catch {
          // table may not be migrated yet — fail silently
        }
      }
    }

    if (rueckfrage && !sessionEnding) {
      setAktionen([]);
      setPhase("antworten");
    } else {
      const remainingDeletes = aktionen.filter((a) => a.typ === "task_loeschen");
      setAktionen(remainingDeletes);
      if (remainingDeletes.length > 0 && !sessionEnding) {
        setPhase("confirm");
      } else {
        setPhase("idle");
        setConversationHistory([]);
        setSessionEnding(false);
        setRueckfrage(null);
      }
    }
  }, [aktionen, rueckfrage, sessionEnding, tasks, areas, users, currentUserId, createTask, setStatus]);

  const executeDelete = useCallback(
    async (aktion: Extract<Aktion, { typ: "task_loeschen" }>) => {
      let match: Task | undefined;
      if (aktion.task_id) match = tasks.find((t) => t.id === aktion.task_id);
      if (!match && aktion.task_titel) {
        const lc = aktion.task_titel.toLowerCase();
        match = tasks.find((t) => t.title.toLowerCase().includes(lc) || lc.includes(t.title.toLowerCase()));
      }
      if (match) await deleteTask(match.id);

      const remaining = aktionen.filter((a) => a !== aktion);
      setAktionen(remaining);

      const remainingDeletes = remaining.filter((a) => a.typ === "task_loeschen");
      if (remainingDeletes.length === 0) {
        if (rueckfrage) {
          setPhase("antworten");
        } else {
          setPhase("idle");
          setConversationHistory([]);
        }
      }
    },
    [aktionen, rueckfrage, tasks, deleteTask]
  );

  const resetToIdle = useCallback(() => {
    setPhase("idle");
    setAktionen([]);
    setRueckfrage(null);
    setConversationHistory([]);
    updateBuffer("");
    setError(null);
  }, [updateBuffer]);

  // ── Tagesabschluss ─────────────────────────────────────────────────────────

  const loadTagesabschluss = useCallback(async () => {
    const { from, to } = todayRange();
    const [doneRes, createdRes] = await Promise.all([
      supabase.from("tasks").select("*").eq("status", "done").gte("done_at", from).lte("done_at", to),
      supabase.from("tasks").select("*").gte("created_at", from).lte("created_at", to),
    ]);

    let material: MaterialRow[] = [];
    try {
      const matRes = await (supabase as any)
        .from("material_usage")
        .select("*")
        .gte("created_at", from)
        .lte("created_at", to);
      material = matRes.data ?? [];
    } catch {
      // table not migrated yet
    }

    setTagesData({
      done: (doneRes.data ?? []) as Task[],
      created: (createdRes.data ?? []) as Task[],
      material,
    });
    setPhase("tagesabschluss");
  }, []);

  const tagesText = useCallback(() => {
    if (!tagesData) return "";
    const today = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    const lines = [`Heute erledigt – ${today}`, ""];

    const byArea = new Map<string, Task[]>();
    for (const t of tagesData.done) {
      const aName = areas.find((a) => a.id === t.area_id)?.name ?? "Allgemein";
      if (!byArea.has(aName)) byArea.set(aName, []);
      byArea.get(aName)!.push(t);
    }
    for (const [area, ts] of byArea) {
      lines.push(`${area}:`);
      for (const t of ts) {
        lines.push(`✓ ${t.title}`);
        tagesData.material
          .filter((m) => m.task_id === t.id)
          .forEach((m) => lines.push(`  Material: ${formatMaterial(m)}`));
      }
      lines.push("");
    }

    const newToday = tagesData.created.filter((t) => t.status !== "done");
    if (newToday.length) {
      lines.push("Neu erstellt heute:");
      for (const t of newToday) {
        const ownerName = users.find((u) => u.id === t.owner_id)?.name ?? "";
        const dl = t.deadline ? ` (${new Date(t.deadline).toLocaleDateString("de-DE")})` : "";
        lines.push(`+ ${ownerName ? ownerName + ": " : ""}${t.title}${dl}`);
      }
      lines.push("");
    }

    if (tagesData.material.length > 0) {
      lines.push("Material gesamt heute:");
      for (const m of tagesData.material) lines.push(`- ${formatMaterial(m)}`);
    }

    return lines.join("\n");
  }, [tagesData, areas, users]);

  const mailtoLink = () =>
    `mailto:?subject=Tagesabschluss ${new Date().toLocaleDateString("de-DE")}&body=${encodeURIComponent(tagesText())}`;

  // ── Text input ─────────────────────────────────────────────────────────────

  const submitText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setFallbackText("");
      void processTranscript(text);
    },
    [processTranscript]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const circleBtn = (color: string, glow?: string) => ({
    width: 64,
    height: 64,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    background: color,
    border: `2px solid ${color.replace("0.15", "0.5").replace("0.2", "0.6")}`,
    boxShadow: glow ? `0 0 24px ${glow}` : undefined,
    flexShrink: 0,
  });

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#08011a", color: "#e2d9f3" }}>
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
            className="w-full rounded-xl p-3 text-sm flex items-start gap-2"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}
          >
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="h-4 w-4 opacity-60" /></button>
          </div>
        )}

        {/* ── IDLE ── */}
        {phase === "idle" && (
          <>
            <div className="text-sm text-center opacity-50">
              Tippe auf den Mikrofon-Button und sprich auf Deutsch
            </div>
            {hasSpeechAPI ? (
              <button
                onClick={startRecording}
                style={{
                  ...circleBtn("rgba(167,139,250,0.15)", "rgba(167,139,250,0.15)"),
                  width: 80,
                  height: 80,
                  border: "2px solid rgba(167,139,250,0.4)",
                }}
                aria-label="Aufnahme starten"
              >
                <Mic className="h-9 w-9" style={{ color: "#a78bfa" }} />
              </button>
            ) : (
              <div
                className="w-full rounded-xl p-3 text-xs text-center opacity-60"
                style={{ border: "1px solid rgba(167,139,250,0.2)" }}
              >
                Web Speech API nicht verfügbar – nutze die Texteingabe unten
              </div>
            )}
          </>
        )}

        {/* ── RECORDING ── */}
        {phase === "recording" && (
          <>
            <div className="text-sm opacity-60 animate-pulse">Ich höre zu…</div>
            {transcriptBuffer && (
              <div
                className="w-full rounded-xl p-3 text-sm italic opacity-70"
                style={{ background: "rgba(167,139,250,0.05)" }}
              >
                {transcriptBuffer}
              </div>
            )}
            <div className="flex gap-8">
              <button
                onClick={pauseRecording}
                style={circleBtn("rgba(251,191,36,0.15)")}
                aria-label="Pause"
              >
                <Pause className="h-7 w-7" style={{ color: "#fbbf24" }} />
              </button>
              <button
                onClick={stopRecording}
                style={circleBtn("rgba(239,68,68,0.2)", "rgba(239,68,68,0.2)")}
                aria-label="Senden"
              >
                <Square className="h-7 w-7" style={{ color: "#f87171" }} />
              </button>
            </div>
            <div className="text-xs opacity-40">⏸ Pause &nbsp;·&nbsp; ⏹ Senden</div>
          </>
        )}

        {/* ── PAUSED ── */}
        {phase === "paused" && (
          <>
            <div className="text-sm opacity-60">Pausiert</div>
            {transcriptBuffer && (
              <div
                className="w-full rounded-xl p-3 text-sm"
                style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)" }}
              >
                <span className="text-xs opacity-40 block mb-1">Bisher gehört:</span>
                {transcriptBuffer}
              </div>
            )}
            <div className="flex gap-8">
              <button
                onClick={resumeRecording}
                style={circleBtn("rgba(34,197,94,0.15)")}
                aria-label="Weiterreden"
              >
                <Play className="h-7 w-7" style={{ color: "#86efac" }} />
              </button>
              <button
                onClick={stopRecording}
                style={circleBtn("rgba(239,68,68,0.2)")}
                aria-label="Senden"
              >
                <Square className="h-7 w-7" style={{ color: "#f87171" }} />
              </button>
            </div>
            <div className="text-xs opacity-40">▶ Weiterreden &nbsp;·&nbsp; ⏹ Senden</div>
          </>
        )}

        {/* ── THINKING ── */}
        {phase === "thinking" && (
          <>
            <div className="text-sm opacity-60">Verarbeite…</div>
            {transcriptBuffer && (
              <div
                className="w-full rounded-xl p-3 text-sm"
                style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.15)" }}
              >
                <span className="text-xs opacity-50 block mb-1">Gehört:</span>
                {transcriptBuffer}
              </div>
            )}
            <div
              className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "#a78bfa", borderTopColor: "transparent" }}
            />
          </>
        )}

        {/* ── CONFIRM ── */}
        {phase === "confirm" && (
          <div className="w-full flex flex-col gap-4">
            {aktionen.length > 0 && (
              <div
                className="rounded-xl p-4"
                style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}
              >
                <p className="text-xs font-bold mb-3 opacity-50 tracking-wide">CLAUDE SCHLÄGT VOR:</p>
                <ul className="flex flex-col gap-2">
                  {aktionen.map((a, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 text-sm rounded-lg p-2"
                      style={{ background: "rgba(255,255,255,0.03)" }}
                    >
                      {a.typ === "task_loeschen" && (
                        <>
                          <span
                            className="rounded px-1.5 py-0.5 text-xs font-bold shrink-0"
                            style={{ background: "rgba(239,68,68,0.2)", color: "#fca5a5" }}
                          >
                            LÖSCHEN
                          </span>
                          <span className="flex-1 opacity-80">{a.task_titel ?? a.task_id}</span>
                          <button
                            onClick={() => void executeDelete(a)}
                            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold shrink-0"
                            style={{
                              background: "rgba(239,68,68,0.25)",
                              color: "#fca5a5",
                              border: "1px solid rgba(239,68,68,0.4)",
                            }}
                          >
                            <Trash2 className="h-3 w-3" /> Bestätigen
                          </button>
                        </>
                      )}
                      {a.typ === "material_erfasst" && (
                        <>
                          <span
                            className="rounded px-1.5 py-0.5 text-xs font-bold shrink-0"
                            style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}
                          >
                            MATERIAL
                          </span>
                          <span className="flex-1 opacity-80">{formatMaterial(a)}</span>
                        </>
                      )}
                      {a.typ === "task_erledigt" && (
                        <>
                          <span
                            className="rounded px-1.5 py-0.5 text-xs font-bold shrink-0"
                            style={{ background: "rgba(34,197,94,0.2)", color: "#86efac" }}
                          >
                            ERLEDIGT
                          </span>
                          <span>{a.task_titel ?? a.task_id}</span>
                        </>
                      )}
                      {a.typ === "task_erstellen" && (
                        <>
                          <span
                            className="rounded px-1.5 py-0.5 text-xs font-bold shrink-0"
                            style={{ background: "rgba(167,139,250,0.2)", color: "#c4b5fd" }}
                          >
                            NEU
                          </span>
                          <span>
                            {a.titel}
                            {a.baustelle && <span className="opacity-50"> · {a.baustelle}</span>}
                          </span>
                        </>
                      )}
                      {a.typ === "rueckfrage" && (
                        <>
                          <span
                            className="rounded px-1.5 py-0.5 text-xs font-bold shrink-0"
                            style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}
                          >
                            FRAGE
                          </span>
                          <span className="italic opacity-80">{a.frage}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rueckfrage && (
              <div
                className="rounded-xl p-3 text-sm"
                style={{
                  background: "rgba(251,191,36,0.07)",
                  border: "1px solid rgba(251,191,36,0.25)",
                  color: "#fde68a",
                }}
              >
                <span className="text-xs font-bold block mb-1 opacity-50">CLAUDE FRAGT:</span>
                {rueckfrage}
              </div>
            )}

            {aktionen.some((a) => a.typ === "task_erstellen" || a.typ === "task_erledigt" || a.typ === "material_erfasst") && (
              <div className="flex gap-3">
                <button
                  onClick={() => void executeAktionen()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-sm"
                  style={{
                    background: "rgba(34,197,94,0.15)",
                    border: "1px solid rgba(34,197,94,0.4)",
                    color: "#86efac",
                  }}
                >
                  <Check className="h-4 w-4" /> Ja, ausführen
                </button>
                <button
                  onClick={resetToIdle}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-semibold text-sm"
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "#fca5a5",
                  }}
                >
                  <X className="h-4 w-4" /> Abbrechen
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── ANTWORTEN (rueckfrage aktiv nach Ausführung) ── */}
        {phase === "antworten" && (
          <>
            <div
              className="w-full rounded-xl p-4"
              style={{
                background: "rgba(251,191,36,0.07)",
                border: "1px solid rgba(251,191,36,0.3)",
                color: "#fde68a",
              }}
            >
              <span className="text-xs font-bold block mb-2 opacity-50">CLAUDE FRAGT:</span>
              <p className="text-sm">{rueckfrage}</p>
            </div>

            {hasSpeechAPI && (
              <button
                onClick={() => {
                  setError(null);
                  intentionalStopRef.current = false;
                  setPhase("recording");
                  startRecordingSession();
                }}
                style={{
                  ...circleBtn("rgba(167,139,250,0.15)", "rgba(167,139,250,0.15)"),
                  width: 80,
                  height: 80,
                  border: "2px solid rgba(167,139,250,0.4)",
                }}
                aria-label="Antwort sprechen"
              >
                <Mic className="h-9 w-9" style={{ color: "#a78bfa" }} />
              </button>
            )}
            <div className="text-xs opacity-40">Oder tippe deine Antwort unten</div>
          </>
        )}

        {/* ── TAGESABSCHLUSS ── */}
        {phase === "tagesabschluss" && tagesData && (
          <div className="w-full flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="font-bold" style={{ color: "#fbbf24" }}>
                Heute – {new Date().toLocaleDateString("de-DE")}
              </span>
              <button onClick={() => setPhase("idle")} className="p-1 rounded opacity-50">
                <X className="h-4 w-4" />
              </button>
            </div>

            {tagesData.done.length > 0 ? (
              <div
                className="rounded-xl p-4 text-sm"
                style={{ background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)" }}
              >
                {(() => {
                  const byArea = new Map<string, Task[]>();
                  for (const t of tagesData.done) {
                    const aName = areas.find((a) => a.id === t.area_id)?.name ?? "Allgemein";
                    if (!byArea.has(aName)) byArea.set(aName, []);
                    byArea.get(aName)!.push(t);
                  }
                  return [...byArea.entries()].map(([area, ts]) => (
                    <div key={area} className="mb-3 last:mb-0">
                      <p className="text-xs font-bold mb-1 opacity-60">{area}</p>
                      {ts.map((t) => {
                        const mat = tagesData.material.filter((m) => m.task_id === t.id);
                        return (
                          <div key={t.id}>
                            <p className="flex items-center gap-1.5">
                              <span style={{ color: "#86efac" }}>✓</span>
                              {t.title}
                            </p>
                            {mat.map((m) => (
                              <p key={m.id} className="ml-5 text-xs opacity-60">
                                Material: {formatMaterial(m)}
                              </p>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <p className="text-sm opacity-40 text-center">Noch nichts erledigt heute</p>
            )}

            {tagesData.created.filter((t) => t.status !== "done").length > 0 && (
              <div
                className="rounded-xl p-4 text-sm"
                style={{ background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.2)" }}
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
                          <span className="font-semibold opacity-70">{ownerName}: </span>
                        )}
                        {t.title}
                      </p>
                    );
                  })}
              </div>
            )}

            {tagesData.material.length > 0 && (
              <div
                className="rounded-xl p-4 text-sm"
                style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.15)" }}
              >
                <p className="text-xs font-bold mb-2 opacity-60" style={{ color: "#fbbf24" }}>
                  MATERIAL GESAMT:
                </p>
                {tagesData.material.map((m) => (
                  <p key={m.id} className="opacity-80">– {formatMaterial(m)}</p>
                ))}
              </div>
            )}

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

      {/* Text input — always visible except tagesabschluss, recording, thinking */}
      {phase !== "tagesabschluss" && phase !== "recording" && phase !== "thinking" && (
        <div className="p-4 border-t" style={{ borderColor: "rgba(167,139,250,0.1)" }}>
          <div className="flex gap-2">
            <textarea
              value={fallbackText}
              onChange={(e) => setFallbackText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText(fallbackText);
                }
              }}
              placeholder={phase === "antworten" ? "Deine Antwort tippen…" : "Direkt tippen… (Enter = Senden)"}
              rows={2}
              className="flex-1 resize-none rounded-xl px-3 py-2 text-sm outline-none"
              style={{
                background: "rgba(167,139,250,0.06)",
                border: "1px solid rgba(167,139,250,0.2)",
                color: "#e2d9f3",
              }}
            />
            <button
              onClick={() => submitText(fallbackText)}
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
