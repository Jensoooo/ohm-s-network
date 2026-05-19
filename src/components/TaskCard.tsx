import { useStore, deriveTasks } from "@/lib/store";
import type { DerivedTask } from "@/lib/types";
import { Clock, Lock, ArrowRight, User as UserIcon } from "lucide-react";

const prioRing: Record<string, string> = {
  hoch: "ring-2 ring-[hsl(0_70%_60%)]",
  mittel: "ring-1 ring-[var(--amber)]",
  niedrig: "ring-1 ring-border",
};

function formatDeadline(t: DerivedTask) {
  if (t.no_deadline) return "Keine Frist";
  if (!t.deadline) return "—";
  const d = new Date(t.deadline);
  const now = new Date();
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
  const base = d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
  if (diff < 0) return `${base} · überfällig`;
  if (diff === 0) return `${base} · heute`;
  if (diff === 1) return `${base} · morgen`;
  return `${base} · in ${diff}d`;
}

export function TaskCard({ task }: { task: DerivedTask }) {
  const openDetail = useStore((s) => s.openDetail);
  const users = useStore((s) => s.users);
  const areas = useStore((s) => s.areas);
  const owner = users.find((u) => u.id === task.owner_id);
  const area = areas.find((a) => a.id === task.area_id);

  const done = task.effectiveStatus === "done";
  const blocked = task.isBlocked;

  return (
    <button
      onClick={() => openDetail(task.id)}
      className={
        "cut-corner relative w-full text-left bg-card-raw p-4 transition-transform active:scale-[0.98] " +
        prioRing[task.priority]
      }
    >
      {blocked && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--amber)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--amber)]">
          <Lock className="h-3 w-3" /> Blockiert
        </span>
      )}
      <div className="flex items-start gap-3">
        {owner && (
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: owner.color }}
          >
            {owner.initials}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className={"truncate text-base font-semibold " + (done ? "text-muted-foreground line-through" : "text-foreground")}>
            {task.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {area && <span className="rounded-full bg-surface px-2 py-0.5">{area.name}</span>}
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatDeadline(task)}</span>
            {owner && <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{owner.name}</span>}
          </div>
          {blocked && task.dependsOn.length > 0 && (
            <p className="mt-2 text-xs text-[var(--amber)]/90">
              Wartet auf: {task.dependsOn.filter((d) => d.status !== "done").map((d) => d.title).join(", ")}
            </p>
          )}
          {!blocked && task.blocks.length > 0 && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--teal)]">
              <ArrowRight className="h-3 w-3" /> Blockt {task.blocks.length} Aufgabe{task.blocks.length === 1 ? "" : "n"}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

export function useDerivedTasks() {
  const tasks = useStore((s) => s.tasks);
  const deps = useStore((s) => s.dependencies);
  return deriveTasks(tasks, deps);
}
