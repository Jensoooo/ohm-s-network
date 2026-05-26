import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { useDerivedTasks } from "@/components/TaskCard";
import { TaskCard } from "@/components/TaskCard";
import { BaustelleWizard } from "@/components/BaustelleWizard";
import { Button } from "@/components/ui/button";
import { Plus, ChevronLeft, MapPin, Calendar } from "lucide-react";
import { ownerStyle } from "@/lib/colors";
import { sortAsap } from "@/lib/store";

export const Route = createFileRoute("/baustellen")({
  component: BaustellenPage,
});

function BaustellenPage() {
  const projects = useStore((s) => s.projects);
  const customers = useStore((s) => s.customers);
  const users = useStore((s) => s.users);
  const closeProject = useStore((s) => s.closeProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const derived = useDerivedTasks();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const active = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;

  if (active) {
    const tasks = derived
      .filter((t) => t.project_id === active.id)
      .sort(sortAsap);
    const customer = customers.find((c) => c.id === active.customer_id);
    return (
      <div className="mx-auto max-w-md px-4 pt-6 pb-24">
        <button onClick={() => setActiveProjectId(null)} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground">
          <ChevronLeft className="h-4 w-4" /> Zurück
        </button>
        <h1 className="text-xl font-extrabold text-gradient">{active.name}</h1>
        {active.address && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {active.address}
          </p>
        )}
        {active.template_type && (
          <p className="mt-1 text-xs text-muted-foreground">Typ: {active.template_type}</p>
        )}
        {customer && (
          <p className="mt-1 text-xs text-muted-foreground">Kunde: {customer.name}</p>
        )}
        <h2 className="mt-5 mb-2 text-sm font-semibold text-foreground">
          Aufgaben ({tasks.length})
        </h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Aufgaben.</p>
        ) : (
          <ul className="space-y-3">
            {tasks.map((t) => (
              <li key={t.id}><TaskCard task={t} /></li>
            ))}
          </ul>
        )}

        <button
          onClick={async () => {
            if (!confirm("Alle offenen Tasks als erledigt markieren?")) return;
            await closeProject(active.id);
            setActiveProjectId(null);
          }}
          style={{
            width: "100%",
            marginTop: 16,
            background: "rgba(20,184,166,0.1)",
            border: "1px solid rgba(20,184,166,0.3)",
            color: "#2dd4bf",
            borderRadius: 20,
            padding: "10px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ✓ Projekt abschließen
        </button>
        <button
          onClick={async () => {
            if (!confirm("Projekt und ALLE zugehörigen Tasks löschen? Das kann nicht rückgängig gemacht werden.")) return;
            await deleteProject(active.id);
            setActiveProjectId(null);
          }}
          style={{
            width: "100%",
            marginTop: 8,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "#ef4444",
            borderRadius: 20,
            padding: "10px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          🗑 Projekt löschen
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-24">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-gradient">Baustellen</h1>
          <p className="mt-1 text-xs text-muted-foreground">{projects.length} aktive Projekte</p>
        </div>
        <Button
          onClick={() => setWizardOpen(true)}
          size="icon"
          className="h-12 w-12 rounded-full gradient-brand text-white shadow-[0_8px_24px_-8px_#7c3aed]"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="mt-16 text-center text-muted-foreground">
          <p>Keine Baustellen.</p>
          <Button onClick={() => setWizardOpen(true)} className="mt-4 gradient-brand rounded-full text-white">
            Erste Baustelle erstellen
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => {
            const projTasks = derived.filter((t) => t.project_id === p.id);
            const done = projTasks.filter((t) => t.effectiveStatus === "done").length;
            const total = projTasks.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const ownerIds = Array.from(new Set(projTasks.map((t) => t.owner_id).filter(Boolean)));
            const owners = ownerIds.map((id) => users.find((u) => u.id === id)).filter(Boolean);
            const nextDeadline = projTasks
              .filter((t) => t.effectiveStatus !== "done" && !t.no_deadline && t.deadline)
              .map((t) => new Date(t.deadline!))
              .sort((a, b) => a.getTime() - b.getTime())[0];

            return (
              <li key={p.id}>
                <button
                  onClick={() => setActiveProjectId(p.id)}
                  className="cut-corner w-full p-4 text-left transition-transform active:scale-[0.98]"
                  style={{
                    background: "#150535",
                    border: "1px solid rgba(124,58,237,0.22)",
                  }}
                >
                  <h3 className="text-base font-semibold text-foreground">{p.name}</h3>
                  {p.address && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {p.address}
                    </p>
                  )}
                  {p.template_type && (
                    <p className="mt-0.5 text-xs text-muted-foreground">Typ: {p.template_type}</p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: "linear-gradient(135deg, #7c3aed, #14b8a6)",
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {done} / {total}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex -space-x-1.5">
                      {owners.map((u) => {
                        const st = ownerStyle(u!);
                        return (
                          <span
                            key={u!.id}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            style={{ background: st.main, boxShadow: "0 0 0 2px #150535" }}
                          >
                            {u!.initials}
                          </span>
                        );
                      })}

                      {owners.length === 0 && (
                        <span className="text-[11px] text-muted-foreground">Niemand zugewiesen</span>
                      )}
                    </div>
                    {nextDeadline && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {nextDeadline.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <BaustelleWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
