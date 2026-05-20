import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useStore, sortAsap } from "@/lib/store";
import { TaskCard, useDerivedTasks } from "@/components/TaskCard";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ownerStyle } from "@/lib/colors";

export const Route = createFileRoute("/")({
  component: TasksPage,
});

function TasksPage() {
  const filterAreaIds = useStore((s) => s.filterAreaIds);
  const filterOwnerIds = useStore((s) => s.filterOwnerIds);
  const toggleFilterArea = useStore((s) => s.toggleFilterArea);
  const toggleFilterOwner = useStore((s) => s.toggleFilterOwner);
  const clearFilterAreas = useStore((s) => s.clearFilterAreas);
  const clearFilterOwners = useStore((s) => s.clearFilterOwners);
  const areas = useStore((s) => s.areas);
  const users = useStore((s) => s.users);
  const openEdit = useStore((s) => s.openEdit);

  const derived = useDerivedTasks();

  const visible = useMemo(() => {
    return derived
      .filter((t) => filterAreaIds.length === 0 || (t.area_id && filterAreaIds.includes(t.area_id)))
      .filter((t) => filterOwnerIds.length === 0 || (t.owner_id && filterOwnerIds.includes(t.owner_id)))
      .sort(sortAsap);
  }, [derived, filterAreaIds, filterOwnerIds]);

  const openCount = visible.filter((t) => t.effectiveStatus !== "done").length;

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

      <div className="mb-3 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        <Chip label="Alle" active={filterAreaIds.length === 0} onClick={clearFilterAreas} />
        {areas.map((a) => (
          <Chip key={a.id} label={a.name} active={filterAreaIds.includes(a.id)} onClick={() => toggleFilterArea(a.id)} />
        ))}
      </div>
      <div className="mb-4 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        <Chip label="Alle" active={filterOwnerIds.length === 0} onClick={clearFilterOwners} />
        {users.map((u) => {
          const st = ownerStyle(u);
          return (
            <Chip
              key={u.id}
              label={u.name}
              active={filterOwnerIds.includes(u.id)}
              onClick={() => toggleFilterOwner(u.id)}
              dotColor={st.main}
            />
          );
        })}
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
