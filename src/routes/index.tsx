import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useStore, sortAsap } from "@/lib/store";
import { TaskCard, useDerivedTasks } from "@/components/TaskCard";
import { Button } from "@/components/ui/button";
import { Plus, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  component: TasksPage,
});

function TasksPage() {
  const filterAreaId = useStore((s) => s.filterAreaId);
  const filterOwnerId = useStore((s) => s.filterOwnerId);
  const setFilterArea = useStore((s) => s.setFilterArea);
  const setFilterOwner = useStore((s) => s.setFilterOwner);
  const areas = useStore((s) => s.areas);
  const users = useStore((s) => s.users);
  const openEdit = useStore((s) => s.openEdit);

  const derived = useDerivedTasks();

  const visible = useMemo(() => {
    return derived
      .filter((t) => filterAreaId === "all" || t.area_id === filterAreaId)
      .filter((t) => filterOwnerId === "all" || t.owner_id === filterOwnerId)
      .sort(sortAsap);
  }, [derived, filterAreaId, filterOwnerId]);

  const openCount = visible.filter((t) => t.effectiveStatus !== "done").length;

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl gradient-brand">
              <Zap className="h-4 w-4 text-white" />
            </span>
            <h1 className="text-2xl font-extrabold tracking-tight text-gradient">OHMERA</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{openCount} offene Aufgabe{openCount === 1 ? "" : "n"}</p>
        </div>
        <Button onClick={() => openEdit("new")} size="icon" className="h-12 w-12 rounded-full gradient-brand text-white shadow-[0_8px_24px_-8px_#7c3aed]">
          <Plus className="h-5 w-5" />
        </Button>
      </header>

      <div className="mb-3 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        <Chip label="Alle Bereiche" active={filterAreaId === "all"} onClick={() => setFilterArea("all")} />
        {areas.map((a) => (
          <Chip key={a.id} label={a.name} active={filterAreaId === a.id} onClick={() => setFilterArea(a.id)} />
        ))}
      </div>
      <div className="mb-4 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        <Chip label="Alle" active={filterOwnerId === "all"} onClick={() => setFilterOwner("all")} />
        {users.map((u) => (
          <Chip
            key={u.id}
            label={u.name}
            active={filterOwnerId === u.id}
            onClick={() => setFilterOwner(u.id)}
            dotColor={u.color}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="mt-16 text-center text-muted-foreground">
          <p>Keine Aufgaben.</p>
          <Button onClick={() => openEdit("new")} className="mt-4 gradient-brand rounded-full text-white">
            Erste Aufgabe erstellen
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((t) => (
            <li key={t.id}><TaskCard task={t} /></li>
          ))}
        </ul>
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
