import { useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useDerivedTasks } from "./TaskCard";
import { ownerStyle, PRIORITY_DOT, withAlpha } from "@/lib/colors";
import { runNetzplanAlgorithm } from "@/lib/netzplan";
import type { NetzplanItem, SimpleNetzplanItem, MergedNetzplanItem, TaskWithGraph } from "@/lib/netzplan";
import type { User } from "@/lib/types";

// ── Deadline ──────────────────────────────────────────────────────────────────

function deadlineLabel(deadline: string | null, no_deadline: boolean): { text: string; color: string } | null {
  if (no_deadline || !deadline) return null;
  const d = new Date(deadline);
  const diff = Math.round((d.getTime() - Date.now()) / 86400000);
  const fmt = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  if (diff < 0) return { text: "überfällig", color: "#ef4444" };
  if (diff === 0) return { text: "heute", color: "#f59e0b" };
  if (diff <= 3) return { text: fmt, color: "#f59e0b" };
  return { text: fmt, color: "#94a3b8" };
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function ChainTaskCard({
  task, users, vertical = false, onTap, connectMode, connectSource,
}: {
  task: TaskWithGraph;
  users: User[];
  vertical?: boolean;
  onTap?: (id: string) => void;
  connectMode?: boolean;
  connectSource?: string | null;
}) {
  const owner = users.find((u) => u.id === task.owner_id);
  const st = ownerStyle(owner);
  const done = task.effectiveStatus === "done";
  const blocked = task.isBlocked;
  const dot = PRIORITY_DOT[task.priority];
  const dl = deadlineLabel(task.deadline, task.no_deadline);
  const isSource = connectMode && connectSource === task.id;
  const w = vertical ? 176 : 132;
  const h = vertical ? 78 : 62;

  return (
    <button
      className="shrink-0 rounded-lg text-left active:scale-[0.97] transition-transform"
      style={{
        width: w, height: h,
        background: done ? "transparent" : st.bg,
        border: `1.5px ${blocked ? "dashed" : "solid"} ${done ? withAlpha(st.main, 0.2) : st.main}`,
        opacity: done ? 0.35 : 1,
        boxShadow: isSource
          ? `0 0 0 2px white, 0 0 14px ${st.main}`
          : !done && !blocked
          ? `0 0 6px ${withAlpha(st.main, 0.22)}`
          : undefined,
      }}
      onClick={() => onTap?.(task.id)}
    >
      <div className="flex h-full flex-col justify-between p-1.5">
        <div className="flex items-start gap-1">
          <span className="mt-[3px] h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
          <p className={`font-semibold leading-tight text-foreground ${vertical ? "text-[11px] line-clamp-3" : "text-[10px] line-clamp-2"}`}>
            {task.title}
          </p>
        </div>
        <div className="flex items-center justify-between gap-1">
          {owner ? (
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ background: st.main }}
            >
              {owner.initials}
            </span>
          ) : <span />}
          {dl && (
            <span
              className="rounded-full px-1 py-[0.5px] text-[9px] font-bold leading-none shrink-0"
              style={{ color: dl.color, background: withAlpha(dl.color, 0.15), border: `1px solid ${withAlpha(dl.color, 0.3)}` }}
            >
              {dl.text}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Arrows ────────────────────────────────────────────────────────────────────

function HArrow() {
  const c = "rgba(167,139,250,0.5)";
  return (
    <div className="flex items-center shrink-0 px-0.5">
      <div className="h-px w-3" style={{ background: c }} />
      <span className="text-[11px] leading-none" style={{ color: c }}>›</span>
    </div>
  );
}

function VArrow() {
  return (
    <div className="flex flex-col items-center py-0.5 shrink-0">
      <div className="w-px h-3" style={{ background: "rgba(167,139,250,0.4)" }} />
      <span className="text-[11px] leading-none" style={{ color: "rgba(167,139,250,0.6)" }}>↓</span>
    </div>
  );
}

// ── Score Badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score, onExpand }: { score: number; onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      className="flex flex-col items-center justify-center rounded-lg shrink-0 gap-0.5 py-1"
      style={{ width: 42, minHeight: 62, background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.12)" }}
    >
      <span className="text-[9px] font-bold text-[#a78bfa]">{score}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}

// ── Collapsed Simple Row ──────────────────────────────────────────────────────

function CollapsedChainRow({
  item, users, onExpand, onTaskTap, connectMode, connectSource,
}: {
  item: SimpleNetzplanItem;
  users: User[];
  onExpand: () => void;
  onTaskTap: (id: string) => void;
  connectMode?: boolean;
  connectSource?: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 py-1.5">
      <ScoreBadge score={item.headScore} onExpand={onExpand} />
      <div className="flex items-center overflow-x-auto no-scrollbar flex-1">
        {item.tasks.map((task, i) => (
          <div key={task.id} className="flex items-center shrink-0">
            {i > 0 && <HArrow />}
            <ChainTaskCard task={task} users={users} onTap={onTaskTap} connectMode={connectMode} connectSource={connectSource} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Collapsed Merged Row ──────────────────────────────────────────────────────
// Oben: Gewinner-Pfad + gemeinsamer Schwanz (volle Kette).
// Darunter: je eine Zeile pro Verlierer-Pfad, endet mit ↑ (zeigt auf Gewinner-Kette).

function MergedCollapsedRow({
  item, users, onExpand, onTaskTap, connectMode, connectSource,
}: {
  item: MergedNetzplanItem;
  users: User[];
  onExpand: () => void;
  onTaskTap: (id: string) => void;
  connectMode?: boolean;
  connectSource?: string | null;
}) {
  const [winnerPath, ...loserPaths] = item.paths;
  const topRow = [...winnerPath.tasks, ...item.sharedTail];

  return (
    <div className="flex items-start gap-1.5 py-1.5">
      <ScoreBadge score={item.combinedScore} onExpand={onExpand} />

      <div className="flex flex-col gap-1 overflow-x-auto no-scrollbar flex-1">
        {/* Obere Zeile: volle Gewinner-Kette */}
        <div className="flex items-center shrink-0">
          {topRow.map((task, i) => (
            <div key={task.id} className="flex items-center shrink-0">
              {i > 0 && <HArrow />}
              <ChainTaskCard task={task} users={users} onTap={onTaskTap} connectMode={connectMode} connectSource={connectSource} />
            </div>
          ))}
        </div>

        {/* Untere Zeilen: Verlierer-Pfade + ↑ */}
        {loserPaths.map((path, pi) => (
          <div key={pi} className="flex items-center shrink-0">
            {path.tasks.map((task, i) => (
              <div key={task.id} className="flex items-center shrink-0">
                {i > 0 && <HArrow />}
                <ChainTaskCard task={task} users={users} onTap={onTaskTap} connectMode={connectMode} connectSource={connectSource} />
              </div>
            ))}
            <div className="flex items-center shrink-0 px-1">
              <span className="text-[13px] leading-none" style={{ color: "rgba(167,139,250,0.6)" }}>↑</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Expanded Simple Column ────────────────────────────────────────────────────

function ExpandedChainColumn({
  item, users, onCollapse, onTaskTap, connectMode, connectSource,
}: {
  item: SimpleNetzplanItem;
  users: User[];
  onCollapse: () => void;
  onTaskTap: (id: string) => void;
  connectMode?: boolean;
  connectSource?: string | null;
}) {
  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: 192 }}>
      <div className="flex items-center justify-between w-full mb-2 px-1">
        <span className="text-[10px] font-bold text-[#a78bfa]">Score {item.headScore}</span>
        <button onClick={onCollapse} className="p-0.5 rounded text-muted-foreground active:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col items-center overflow-y-auto no-scrollbar">
        {item.tasks.map((task, i) => (
          <div key={task.id} className="flex flex-col items-center">
            {i > 0 && <VArrow />}
            <ChainTaskCard task={task} users={users} vertical onTap={onTaskTap} connectMode={connectMode} connectSource={connectSource} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Expanded Merged Column ────────────────────────────────────────────────────
// Eingangspfade als beschriftete Abschnitte, dann Trennlinie, dann gemeinsamer Schwanz.

function MergedExpandedColumn({
  item, users, onCollapse, onTaskTap, connectMode, connectSource,
}: {
  item: MergedNetzplanItem;
  users: User[];
  onCollapse: () => void;
  onTaskTap: (id: string) => void;
  connectMode?: boolean;
  connectSource?: string | null;
}) {
  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: 210 }}>
      <div className="flex items-center justify-between w-full mb-2 px-1">
        <span className="text-[10px] font-bold text-[#a78bfa]">Score Ø {item.combinedScore}</span>
        <button onClick={onCollapse} className="p-0.5 rounded text-muted-foreground active:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Oben: volle Gewinner-Kette vertikal */}
      <div className="flex flex-col items-center overflow-y-auto no-scrollbar w-full">
        {[...item.paths[0].tasks, ...item.sharedTail].map((task, i) => (
          <div key={task.id} className="flex flex-col items-center">
            {i > 0 && <VArrow />}
            <ChainTaskCard task={task} users={users} vertical onTap={onTaskTap} connectMode={connectMode} connectSource={connectSource} />
          </div>
        ))}

        {/* Verlierer-Pfade mit ↑ */}
        {item.paths.slice(1).map((path, pi) => (
          <div key={pi} className="mt-3 w-full">
            <div className="flex items-center gap-1 mb-2 w-full px-2">
              <div className="h-px flex-1" style={{ background: "rgba(167,139,250,0.2)" }} />
              <span className="text-[8px] shrink-0 opacity-50" style={{ color: "rgba(167,139,250,0.7)" }}>
                ↑ Score {path.headScore}
              </span>
              <div className="h-px flex-1" style={{ background: "rgba(167,139,250,0.2)" }} />
            </div>
            <div className="flex flex-col items-center">
              {path.tasks.map((task, i) => (
                <div key={task.id} className="flex flex-col items-center">
                  {i > 0 && <VArrow />}
                  <ChainTaskCard task={task} users={users} vertical onTap={onTaskTap} connectMode={connectMode} connectSource={connectSource} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Haupt-Komponente ──────────────────────────────────────────────────────────

interface NetzplanChainViewProps {
  connectMode?: boolean;
  connectSource?: string | null;
  onConnectTap?: (taskId: string) => void;
  showDone?: boolean;
}

export function NetzplanChainView({
  connectMode = false,
  connectSource = null,
  onConnectTap,
  showDone = false,
}: NetzplanChainViewProps) {
  const derived = useDerivedTasks();
  const users = useStore((s) => s.users);
  const openDetail = useStore((s) => s.openDetail);
  const filterAreaIds = useStore((s) => s.filterAreaIds);
  const filterOwnerIds = useStore((s) => s.filterOwnerIds);
  const filterProjectIds = useStore((s) => s.filterProjectIds);

  const filteredTasks = useMemo(
    () => derived
      .filter((t) => showDone || t.effectiveStatus !== "done")
      .filter((t) => filterAreaIds.length === 0 || filterAreaIds.includes(t.area_id ?? ""))
      .filter((t) => filterOwnerIds.length === 0 || filterOwnerIds.includes(t.owner_id ?? ""))
      .filter((t) => filterProjectIds.length === 0 || filterProjectIds.includes(t.project_id ?? "")),
    [derived, showDone, filterAreaIds, filterOwnerIds, filterProjectIds],
  );

  const { items } = useMemo(
    () => filteredTasks.length > 0 ? runNetzplanAlgorithm(filteredTasks) : { items: [] },
    [filteredTasks],
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleTaskTap = (taskId: string) => {
    if (connectMode && onConnectTap) onConnectTap(taskId);
    else openDetail(taskId);
  };

  if (derived.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Noch keine Aufgaben — leg los, dann erscheinen sie hier als Netzplan.
      </div>
    );
  }

  if (filteredTasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Keine Aufgaben für diesen Filter.
      </div>
    );
  }

  const expandedItems = items.filter((i) => expandedIds.has(i.id));
  const collapsedItems = items.filter((i) => !expandedIds.has(i.id));

  return (
    <div className="flex flex-col h-full" style={{ background: connectMode ? "#1a0a3d" : "#0f0228" }}>
      {/* Aufgeklappte Items */}
      {expandedItems.length > 0 && (
        <div
          className="flex flex-row gap-4 overflow-x-auto overflow-y-auto p-3 flex-shrink-0 border-b"
          style={{ maxHeight: "50vh", borderColor: "rgba(167,139,250,0.12)" }}
        >
          {expandedItems.map((item) =>
            item.type === 'simple' ? (
              <ExpandedChainColumn
                key={item.id} item={item} users={users}
                onCollapse={() => toggle(item.id)} onTaskTap={handleTaskTap}
                connectMode={connectMode} connectSource={connectSource}
              />
            ) : (
              <MergedExpandedColumn
                key={item.id} item={item} users={users}
                onCollapse={() => toggle(item.id)} onTaskTap={handleTaskTap}
                connectMode={connectMode} connectSource={connectSource}
              />
            )
          )}
        </div>
      )}

      {/* Zugeklappte Items */}
      <div className="flex-1 overflow-y-auto px-3">
        <div className="flex flex-col divide-y" style={{ borderColor: "rgba(167,139,250,0.07)" }}>
          {collapsedItems.map((item) =>
            item.type === 'simple' ? (
              <CollapsedChainRow
                key={item.id} item={item} users={users}
                onExpand={() => toggle(item.id)} onTaskTap={handleTaskTap}
                connectMode={connectMode} connectSource={connectSource}
              />
            ) : (
              <MergedCollapsedRow
                key={item.id} item={item} users={users}
                onExpand={() => toggle(item.id)} onTaskTap={handleTaskTap}
                connectMode={connectMode} connectSource={connectSource}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
