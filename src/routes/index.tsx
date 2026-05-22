import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore, sortAsap } from "@/lib/store";
import { TaskCard, useDerivedTasks } from "@/components/TaskCard";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ownerStyle } from "@/lib/colors";
import type { DerivedTask, User, Priority } from "@/lib/types";

export const Route = createFileRoute("/")({
  component: TasksPage,
});

type SortBy = "auto" | "prio" | "frist" | "bearbeiter";

function sortTasks(tasks: DerivedTask[], by: SortBy, users: User[]): DerivedTask[] {
  const base = [...tasks];
  if (by === "auto") return base.sort(sortAsap);
  if (by === "prio") {
    const po: Record<Priority, number> = { hoch: 0, mittel: 1, niedrig: 2 };
    return base.sort((a, b) => po[a.priority] - po[b.priority]);
  }
  if (by === "frist") {
    return base.sort((a, b) => {
      if (a.no_deadline && b.no_deadline) return 0;
      if (a.no_deadline) return 1;
      if (b.no_deadline) return -1;
      return (a.deadline ?? "").localeCompare(b.deadline ?? "");
    });
  }
  if (by === "bearbeiter") {
    return base.sort((a, b) => {
      const na = users.find((u) => u.id === a.owner_id)?.name ?? "ZZZ";
      const nb = users.find((u) => u.id === b.owner_id)?.name ?? "ZZZ";
      return na.localeCompare(nb);
    });
  }
  return base;
}

function TasksPage() {
  const filterAreaIds = useStore((s) => s.filterAreaIds);
  const filterOwnerIds = useStore((s) => s.filterOwnerIds);
  const filterProjectIds = useStore((s) => s.filterProjectIds);
  const toggleFilterArea = useStore((s) => s.toggleFilterArea);
  const toggleFilterOwner = useStore((s) => s.toggleFilterOwner);
  const toggleFilterProject = useStore((s) => s.toggleFilterProject);
  const clearFilterAreas = useStore((s) => s.clearFilterAreas);
  const clearFilterOwners = useStore((s) => s.clearFilterOwners);
  const clearFilterProjects = useStore((s) => s.clearFilterProjects);
  const areas = useStore((s) => s.areas);
  const users = useStore((s) => s.users);
  const projects = useStore((s) => s.projects);
  const openEdit = useStore((s) => s.openEdit);

  const [sortBy, setSortBy] = useState<SortBy>("auto");
  const [showUnassigned, setShowUnassigned] = useState(false);

  const derived = useDerivedTasks();

  const [assigned, backlog] = useMemo(() => {
    const filtered = derived
      .filter((t) => filterAreaIds.length === 0 || (t.area_id && filterAreaIds.includes(t.area_id)))
      .filter((t) => {
        if (showUnassigned) return t.owner_id === null;
        if (filterOwnerIds.length === 0) return true;
        return t.owner_id && filterOwnerIds.includes(t.owner_id);
      })
      .filter((t) => filterProjectIds.length === 0 || (t.project_id && filterProjectIds.includes(t.project_id)));

    const open = filtered.filter((t) => t.effectiveStatus !== "done");
    const assigned = sortTasks(open.filter((t) => t.owner_id !== null), sortBy, users);
    const backlog = open.filter((t) => t.owner_id === null && !t.isBlocked).sort(sortAsap);
    return [assigned, backlog];
  }, [derived, filterAreaIds, filterOwnerIds, filterProjectIds, sortBy, showUnassigned, users]);

  const openCount = assigned.length + backlog.length;

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <Logo className="h-8 w-auto" />
          <p className="mt-1 text-xs text-muted-foreground">{openCount} offene Aufgabe{openCount === 1 ? "" : "n"}</p>
        </div>
        <Button onClick={() => openEdit("new")} size="icon" className="h-12 w-12 rounded-full gradient-brand text-white shadow-[0_8px_24px_-8px_#7c3aed]">
          <Plus className="h-5 w-5" />
        </Button>
      </header>

      <div className="mb-2 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        <Chip label="Alle" active={filterAreaIds.length === 0} onClick={clearFilterAreas} />
        {areas.map((a) => (
          <Chip key={a.id} label={a.name} active={filterAreaIds.includes(a.id)} onClick={() => toggleFilterArea(a.id)} />
        ))}
      </div>
      <div className="mb-2 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        <Chip label="Alle" active={filterOwnerIds.length === 0 && !showUnassigned} onClick={() => { clearFilterOwners(); setShowUnassigned(false); }} />
        <Chip label="Nicht zugeordnet" active={showUnassigned} onClick={() => setShowUnassigned((v) => !v)} />
        {users.map((u) => {
          const st = ownerStyle(u);
          return (
            <Chip
              key={u.id}
              label={u.name}
              active={filterOwnerIds.includes(u.id)}
              onClick={() => { setShowUnassigned(false); toggleFilterOwner(u.id); }}
              dotColor={st.main}
            />
          );
        })}
      </div>
      <div className="mb-3 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        <Chip label="Alle Baustellen" active={filterProjectIds.length === 0} onClick={clearFilterProjects} />
        {projects.map((p) => (
          <Chip key={p.id} label={p.name} active={filterProjectIds.includes(p.id)} onClick={() => toggleFilterProject(p.id)} />
        ))}
      </div>

      <div className="mb-3 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        {([
          ["auto", "Standard"],
          ["prio", "Priorität"],
          ["frist", "Frist"],
          ["bearbeiter", "Bearbeiter"],
        ] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setSortBy(val)}
            className={
              "shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition " +
              (sortBy === val
                ? "border-transparent gradient-brand text-white"
                : "border-border bg-card-raw text-muted-foreground")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {assigned.length === 0 && backlog.length === 0 ? (
        <div className="mt-16 text-center text-muted-foreground">
          <p>Keine Aufgaben.</p>
          <Button onClick={() => openEdit("new")} className="mt-4 gradient-brand rounded-full text-white">
            Erste Aufgabe erstellen
          </Button>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {assigned.map((t) => (
              <li key={t.id}><TaskCard task={t} /></li>
            ))}
          </ul>

          {backlog.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Backlog — nicht zugeordnet
                </span>
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted-foreground">
                  {backlog.length}
                </span>
              </div>
              <ul className="space-y-2 opacity-70">
                {backlog.map((t) => (
                  <li key={t.id}><TaskCard task={t} /></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ label, active, onClick, dotColor }: { label: string; active: boolean; onClick: () => void; dotColor?: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition " +
        (active
          ? "border-transparent gradient-brand text-white"
          : "border-border bg-card-raw text-muted-foreground")
      }
    >
      {dotColor && <span className="h-2 w-2 rounded-full" style={{ background: dotColor }} />}
      {label}
    </button>
  );
}
