import { useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useDerivedTasks } from "./TaskCard";
import { ownerStyle, PRIORITY_DOT, withAlpha } from "@/lib/colors";
import { runNetzplanAlgorithm } from "@/lib/netzplan";
import type { NetzplanChain, TaskWithGraph } from "@/lib/netzplan";
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
  const merge = task.isMergeRef;
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
        background: done || merge ? "transparent" : st.bg,
        border: `1.5px ${blocked || merge ? "dashed" : "solid"} ${
          merge ? withAlpha(st.main, 0.3) : done ? withAlpha(st.main, 0.2) : st.main
        }`,
        opacity: done ? 0.35 : merge ? 0.45 : 1,
        boxShadow: isSource
          ? `0 0 0 2px white, 0 0 14px ${st.main}`
          : !done && !merge && !blocked
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

function HArrow({ dim = false }: { dim?: boolean }) {
  const c = dim ? "rgba(167,139,250,0.2)" : "rgba(167,139,250,0.5)";
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

// ── Merge-Ref Label ───────────────────────────────────────────────────────────

function MergeLabel({ task, chainById }: { task: TaskWithGraph; chainById: Map<string, NetzplanChain> }) {
  const winner = chainById.get(task.mergeIntoChainId ?? "");
  const label = winner?.tasks[0]?.title?.slice(0, 20) ?? "Kette";
  return (
    <span className="text-[9px] italic ml-1 shrink-0" style={{ color: "rgba(167,139,250,0.55)" }}>
      → {label}
    </span>
  );
}

// ── Collapsed Chain Row ───────────────────────────────────────────────────────

function CollapsedChainRow({
  chain, users, onExpand, onTaskTap, connectMode, connectSource, chainById,
}: {
  chain: NetzplanChain;
  users: User[];
  onExpand: () => void;
  onTaskTap: (id: string) => void;
  connectMode?: boolean;
  connectSource?: string | null;
  chainById: Map<string, NetzplanChain>;
}) {
  return (
    <div className="flex items-center gap-1.5 py-1.5">
      {/* Score + Expand-Button */}
      <button
        onClick={onExpand}
        className="flex flex-col items-center justify-center rounded-lg shrink-0 gap-0.5 py-1"
        style={{ width: 42, minHeight: 62, background: "rgba(167,139,250,0.07)", border: "1px solid rgba(167,139,250,0.12)" }}
      >
        <span className="text-[9px] font-bold text-[#a78bfa]">{chain.headScore}</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {/* Horizontaler Task-Strip */}
      <div className="flex items-center overflow-x-auto no-scrollbar flex-1">
        {chain.tasks.map((task, i) => (
          <div key={task.id} className="flex items-center shrink-0">
            {i > 0 && <HArrow dim={task.isMergeRef} />}
            <ChainTaskCard
              task={task}
              users={users}
              onTap={onTaskTap}
              connectMode={connectMode}
              connectSource={connectSource}
            />
            {task.isMergeRef && <MergeLabel task={task} chainById={chainById} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Expanded Chain Column ─────────────────────────────────────────────────────

function ExpandedChainColumn({
  chain, users, onCollapse, onTaskTap, connectMode, connectSource, chainById,
}: {
  chain: NetzplanChain;
  users: User[];
  onCollapse: () => void;
  onTaskTap: (id: string) => void;
  connectMode?: boolean;
  connectSource?: string | null;
  chainById: Map<string, NetzplanChain>;
}) {
  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: 192 }}>
      {/* Header */}
      <div className="flex items-center justify-between w-full mb-2 px-1">
        <span className="text-[10px] font-bold text-[#a78bfa]">Score {chain.headScore}</span>
        <button onClick={onCollapse} className="p-0.5 rounded text-muted-foreground active:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Vertikaler Task-Strip */}
      <div className="flex flex-col items-center overflow-y-auto no-scrollbar">
        {chain.tasks.map((task, i) => (
          <div key={task.id} className="flex flex-col items-center">
            {i > 0 && <VArrow />}
            <ChainTaskCard
              task={task}
              users={users}
              vertical
              onTap={onTaskTap}
              connectMode={connectMode}
              connectSource={connectSource}
            />
            {task.isMergeRef && (
              <div className="mt-1 mb-1">
                <MergeLabel task={task} chainById={chainById} />
              </div>
            )}
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

  // Filter VOR dem Algorithmus anwenden (Spec: Schritt 1–5 mit filteredTasks neu berechnen)
  const filteredTasks = useMemo(
    () =>
      derived
        .filter((t) => showDone || t.effectiveStatus !== "done")
        .filter((t) => filterAreaIds.length === 0 || filterAreaIds.includes(t.area_id ?? ""))
        .filter((t) => filterOwnerIds.length === 0 || filterOwnerIds.includes(t.owner_id ?? ""))
        .filter((t) => filterProjectIds.length === 0 || filterProjectIds.includes(t.project_id ?? "")),
    [derived, showDone, filterAreaIds, filterOwnerIds, filterProjectIds],
  );

  const { chains } = useMemo(
    () => filteredTasks.length > 0 ? runNetzplanAlgorithm(filteredTasks) : { chains: [], taskMap: new Map() },
    [filteredTasks],
  );

  const chainById = useMemo(() => new Map(chains.map((c) => [c.id, c])), [chains]);

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

  const expandedChains = chains.filter((c) => expandedIds.has(c.id));
  const collapsedChains = chains.filter((c) => !expandedIds.has(c.id));

  return (
    <div className="flex flex-col h-full" style={{ background: connectMode ? "#1a0a3d" : "#0f0228" }}>

      {/* Aufgeklappte Ketten: nebeneinander als vertikale Spalten */}
      {expandedChains.length > 0 && (
        <div
          className="flex flex-row gap-4 overflow-x-auto overflow-y-auto p-3 flex-shrink-0 border-b"
          style={{ maxHeight: "50vh", borderColor: "rgba(167,139,250,0.12)" }}
        >
          {expandedChains.map((chain) => (
            <ExpandedChainColumn
              key={chain.id}
              chain={chain}
              users={users}
              onCollapse={() => toggle(chain.id)}
              onTaskTap={handleTaskTap}
              connectMode={connectMode}
              connectSource={connectSource}
              chainById={chainById}
            />
          ))}
        </div>
      )}

      {/* Zugeklappte Ketten: vertikale Liste von horizontalen Zeilen */}
      <div className="flex-1 overflow-y-auto px-3">
        <div className="flex flex-col divide-y" style={{ borderColor: "rgba(167,139,250,0.07)" }}>
          {collapsedChains.map((chain) => (
            <CollapsedChainRow
              key={chain.id}
              chain={chain}
              users={users}
              onExpand={() => toggle(chain.id)}
              onTaskTap={handleTaskTap}
              connectMode={connectMode}
              connectSource={connectSource}
              chainById={chainById}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
