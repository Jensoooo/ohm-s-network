import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useStore, sortAsap } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { TaskCard, useDerivedTasks } from "@/components/TaskCard";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
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
    return base.sort((a, b) => {
      const aDone = a.effectiveStatus === "done" ? 1 : 0;
      const bDone = b.effectiveStatus === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return po[a.priority] - po[b.priority];
    });
  }
  if (by === "frist") {
    return base.sort((a, b) => {
      const aDone = a.effectiveStatus === "done" ? 1 : 0;
      const bDone = b.effectiveStatus === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      if (a.no_deadline && b.no_deadline) return 0;
      if (a.no_deadline) return 1;
      if (b.no_deadline) return -1;
      return (a.deadline ?? "").localeCompare(b.deadline ?? "");
    });
  }
  if (by === "bearbeiter") {
    return base.sort((a, b) => {
      const aDone = a.effectiveStatus === "done" ? 1 : 0;
      const bDone = b.effectiveStatus === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      const na = users.find((u) => u.id === a.owner_id)?.name ?? "ZZZ";
      const nb = users.find((u) => u.id === b.owner_id)?.name ?? "ZZZ";
      return na.localeCompare(nb);
    });
  }
  return base;
}

const actionBtn = (color: string): React.CSSProperties => ({
  flex: 1,
  background: `${color}20`,
  border: `1px solid ${color}60`,
  color,
  borderRadius: 8,
  padding: "8px 4px",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
});

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
  const bulkSetStatus = useStore((s) => s.bulkSetStatus);
  const bulkDelete = useStore((s) => s.bulkDelete);
  const load = useStore((s) => s.load);

  const [sortBy, setSortBy] = useState<SortBy>("auto");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"assign" | "deadline" | "priority" | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkAction(null);
  };

  const derived = useDerivedTasks();

  const tasks = useMemo(() => {
    const filtered = derived
      .filter((t) => filterAreaIds.length === 0 || (t.area_id && filterAreaIds.includes(t.area_id)))
      .filter((t) =>
        filterOwnerIds.length === 0 ||
        filterOwnerIds.some((id) =>
          id === "__unassigned__" ? t.owner_id === null : t.owner_id === id
        )
      )
      .filter((t) => filterProjectIds.length === 0 || (t.project_id && filterProjectIds.includes(t.project_id)));

    return sortTasks(filtered, sortBy, users);
  }, [derived, filterAreaIds, filterOwnerIds, filterProjectIds, sortBy, users]);

  const openCount = tasks.filter((t) => t.effectiveStatus !== "done").length;
  const selCount = selectedIds.size;

  return (
    <div className="mx-auto max-w-md px-4 pt-6" style={{ paddingBottom: selectMode && selCount > 0 ? 200 : 24 }}>
      <header className="mb-4 flex items-center justify-between">
        <div>
          {selectMode ? (
            <h1 className="text-xl font-extrabold text-gradient">{selCount} ausgewählt</h1>
          ) : (
            <Logo className="h-8 w-auto" />
          )}
          <p className="mt-1 text-xs text-muted-foreground">{openCount} offene Aufgabe{openCount === 1 ? "" : "n"}</p>
        </div>
        {selectMode ? (
          <Button onClick={exitSelectMode} size="icon" variant="outline" className="h-12 w-12 rounded-full">
            <X className="h-5 w-5" />
          </Button>
        ) : (
          <Button onClick={() => openEdit("new")} size="icon" className="h-12 w-12 rounded-full gradient-brand text-white shadow-[0_8px_24px_-8px_#7c3aed]">
            <Plus className="h-5 w-5" />
          </Button>
        )}
      </header>

      <div className="mb-2 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        <Chip label="Alle" active={filterAreaIds.length === 0} onClick={clearFilterAreas} />
        {areas.map((a) => (
          <Chip key={a.id} label={a.name} active={filterAreaIds.includes(a.id)} onClick={() => toggleFilterArea(a.id)} />
        ))}
      </div>
      <div className="mb-2 -mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        <Chip label="Alle" active={filterOwnerIds.length === 0} onClick={clearFilterOwners} />
        <Chip
          label="Nicht zugeordnet"
          active={filterOwnerIds.includes("__unassigned__")}
          onClick={() => toggleFilterOwner("__unassigned__")}
        />
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

      {tasks.length === 0 ? (
        <div className="mt-16 text-center text-muted-foreground">
          <p>Keine Aufgaben.</p>
          <Button onClick={() => openEdit("new")} className="mt-4 gradient-brand rounded-full text-white">
            Erste Aufgabe erstellen
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {tasks.map((t) => (
            <li key={t.id}>
              <TaskCard
                task={t}
                selectMode={selectMode}
                selected={selectedIds.has(t.id)}
                onLongPress={() => {
                  setSelectMode(true);
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    next.add(t.id);
                    return next;
                  });
                }}
                onSelect={() => toggleSelect(t.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {bulkAction && (
        <div
          style={{
            position: "fixed",
            bottom: 132,
            left: 0,
            right: 0,
            zIndex: 101,
            background: "#0b1221",
            borderTop: "1px solid rgba(124,58,237,0.3)",
            borderRadius: "16px 16px 0 0",
            padding: 16,
          }}
        >
          {bulkAction === "assign" && (
            <>
              <p style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                Bearbeiter setzen für {selCount} Tasks
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {users.map((u) => {
                  const st = ownerStyle(u);
                  return (
                    <button
                      key={u.id}
                      onClick={async () => {
                        await supabase.from("tasks").update({ owner_id: u.id }).in("id", Array.from(selectedIds));
                        await load();
                        exitSelectMode();
                      }}
                      style={{
                        background: st.main + "20",
                        border: `1px solid ${st.main}`,
                        color: st.main,
                        borderRadius: 20,
                        padding: "6px 14px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {u.name}
                    </button>
                  );
                })}
                <button
                  onClick={async () => {
                    await supabase.from("tasks").update({ owner_id: null }).in("id", Array.from(selectedIds));
                    await load();
                    exitSelectMode();
                  }}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid #334155",
                    color: "#64748b",
                    borderRadius: 20,
                    padding: "6px 14px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Niemand
                </button>
              </div>
            </>
          )}

          {bulkAction === "priority" && (
            <>
              <p style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                Priorität setzen für {selCount} Tasks
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {(
                  [
                    ["hoch", "#ef4444"],
                    ["mittel", "#f59e0b"],
                    ["niedrig", "#22c55e"],
                  ] as const
                ).map(([prio, color]) => (
                  <button
                    key={prio}
                    onClick={async () => {
                      await supabase.from("tasks").update({ priority: prio }).in("id", Array.from(selectedIds));
                      await load();
                      exitSelectMode();
                    }}
                    style={{
                      flex: 1,
                      background: color + "20",
                      border: `1px solid ${color}`,
                      color,
                      borderRadius: 8,
                      padding: "8px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {prio}
                  </button>
                ))}
              </div>
            </>
          )}

          {bulkAction === "deadline" && (
            <>
              <p style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                Frist setzen für {selCount} Tasks
              </p>
              <input
                type="date"
                style={{
                  width: "100%",
                  background: "#150535",
                  border: "1px solid rgba(124,58,237,0.3)",
                  color: "#f1f5f9",
                  borderRadius: 8,
                  padding: "10px",
                  fontSize: 14,
                  marginBottom: 8,
                }}
                onChange={async (e) => {
                  if (!e.target.value) return;
                  await supabase
                    .from("tasks")
                    .update({ deadline: new Date(e.target.value).toISOString(), no_deadline: false })
                    .in("id", Array.from(selectedIds));
                  await load();
                  exitSelectMode();
                }}
              />
              <button
                onClick={async () => {
                  await supabase
                    .from("tasks")
                    .update({ deadline: null, no_deadline: true })
                    .in("id", Array.from(selectedIds));
                  await load();
                  exitSelectMode();
                }}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid #334155",
                  color: "#64748b",
                  borderRadius: 8,
                  padding: "8px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Keine Frist
              </button>
            </>
          )}

          <button
            onClick={() => setBulkAction(null)}
            style={{
              position: "absolute",
              top: 12,
              right: 16,
              background: "none",
              border: "none",
              color: "#64748b",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      )}

      {selectMode && selCount > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 64,
            left: 0,
            right: 0,
            zIndex: 100,
            background: "#0f0228",
            borderTop: "1px solid rgba(124,58,237,0.3)",
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, textAlign: "center" }}>
            {selCount} ausgewählt
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={async () => {
                await bulkSetStatus(Array.from(selectedIds), "done");
                exitSelectMode();
              }}
              style={actionBtn("#14b8a6")}
            >
              ✓ Erledigt
            </button>
            <button onClick={() => setBulkAction("assign")} style={actionBtn("#7c3aed")}>
              👤 Zuweisen
            </button>
            <button onClick={() => setBulkAction("deadline")} style={actionBtn("#f59e0b")}>
              📅 Frist
            </button>
            <button onClick={() => setBulkAction("priority")} style={actionBtn("#8b5cf6")}>
              ⚡ Prio
            </button>
            <button
              onClick={async () => {
                if (!confirm(`${selCount} Tasks löschen?`)) return;
                await bulkDelete(Array.from(selectedIds));
                exitSelectMode();
              }}
              style={actionBtn("#ef4444")}
            >
              🗑
            </button>
          </div>
        </div>
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
