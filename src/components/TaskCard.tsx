import { useStore, deriveTasks } from "@/lib/store";
import { ownerStyle, PRIORITY_DOT, withAlpha } from "@/lib/colors";
import type { DerivedTask } from "@/lib/types";
import { Clock, ArrowRight } from "lucide-react";

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
  const style = ownerStyle(owner);

  const done = task.effectiveStatus === "done";
  const blocked = task.isBlocked;
  const dot = PRIORITY_DOT[task.priority];

  // Status by FORM, not by color
  const borderColor = done ? withAlpha(style.main, 0.3) : style.main;
  const borderWidth = done ? 1 : 1.5;
  const borderStyle = blocked ? "dashed" : "solid";

  return (
    <button
      onClick={() => openDetail(task.id)}
      className="cut-corner relative w-full text-left p-4 transition-transform active:scale-[0.98]"
      style={{
        background: done ? "transparent" : style.bg,
        border: `${borderWidth}px ${borderStyle} ${borderColor}`,
        opacity: done ? 0.38 : 1,
      }}
    >
      {done ? (
        <h3 className="truncate text-base font-semibold text-foreground line-through">
          {task.title}
        </h3>
      ) : (
        <div className="flex items-start gap-3">
          {owner && (
            <span
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ background: style.main }}
            >
              {owner.initials}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                aria-label={`Priorität ${task.priority}`}
                className="inline-block h-[10px] w-[10px] shrink-0 rounded-full"
                style={{ background: dot }}
              />
              <h3 className="truncate text-base font-semibold text-foreground">{task.title}</h3>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {area && <span className="rounded-full bg-surface px-2 py-0.5">{area.name}</span>}
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{formatDeadline(task)}</span>
              {owner && <span style={{ color: style.accent }}>{owner.name}</span>}
            </div>
            {blocked && task.dependsOn.length > 0 && (
              <p className="mt-2 text-xs" style={{ color: style.accent }}>
                Wartet auf: {task.dependsOn.filter((d) => d.status !== "done").map((d) => d.title).join(", ")}
              </p>
            )}
            {!blocked && task.blocks.length > 0 && (
              <p className="mt-2 inline-flex items-center gap-1 text-xs" style={{ color: style.accent }}>
                <ArrowRight className="h-3 w-3" /> Blockt {task.blocks.length} Aufgabe{task.blocks.length === 1 ? "" : "n"}
              </p>
            )}
          </div>
        </div>
      )}
    </button>
  );
}

export function useDerivedTasks() {
  const tasks = useStore((s) => s.tasks);
  const deps = useStore((s) => s.dependencies);
  return deriveTasks(tasks, deps);
}
