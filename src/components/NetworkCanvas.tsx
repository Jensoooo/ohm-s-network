import { useMemo, useRef, useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { useDerivedTasks } from "./TaskCard";
import { ownerStyle, PRIORITY_DOT, withAlpha } from "@/lib/colors";
import type { DerivedTask } from "@/lib/types";

const NODE_W = 168;
const NODE_H = 78;
const COL_GAP = 80;
const ROW_GAP = 24;
const LANE_HEADER_H = 36;
const LANE_PAD_TOP = 12;
const LANE_PAD_BOT = 16;

interface Positioned {
  task: DerivedTask;
  x: number;
  y: number;
  col: number;
  laneId: string;
  ghost: boolean;
}

interface LaneLayout { id: string; name: string; yTop: number; height: number }

function computeLayout(
  tasks: DerivedTask[],
  areas: { id: string; name: string; sort_order: number }[],
  visibleTaskIds: Set<string>,
  showGhosts: boolean,
) {
  // Topological columns based on ALL deps (for stable rank)
  const colByTask = new Map<string, number>();
  const remaining = new Set(tasks.map((t) => t.id));
  let safe = 0;
  while (remaining.size > 0 && safe++ < 2000) {
    let progressed = false;
    for (const id of Array.from(remaining)) {
      const t = tasks.find((x) => x.id === id)!;
      const depCols = t.dependsOn.map((d) => colByTask.get(d.id));
      if (depCols.every((c) => c !== undefined)) {
        const col = depCols.length ? Math.max(...(depCols as number[])) + 1 : 0;
        colByTask.set(id, col);
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) { for (const id of remaining) colByTask.set(id, 0); break; }
  }

  // Determine which tasks are placed
  const ghostIds = new Set<string>();
  if (showGhosts) {
    for (const t of tasks) {
      if (!visibleTaskIds.has(t.id)) continue;
      for (const d of t.dependsOn) {
        if (!visibleTaskIds.has(d.id)) ghostIds.add(d.id);
      }
    }
  }
  const placedIds = new Set([...visibleTaskIds, ...ghostIds]);
  const placedTasks = tasks.filter((t) => placedIds.has(t.id));

  // Lanes
  const orderedAreas = [...areas].sort((a, b) => a.sort_order - b.sort_order);
  const lanes: LaneLayout[] = [];
  const positioned: Positioned[] = [];
  let yCursor = 12;

  const buildLane = (laneId: string, name: string, inLane: DerivedTask[]) => {
    if (inLane.length === 0) return;
    const byCol = new Map<number, DerivedTask[]>();
    for (const t of inLane) {
      const c = colByTask.get(t.id) ?? 0;
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c)!.push(t);
    }
    const maxRows = Math.max(...[...byCol.values()].map((v) => v.length));
    const laneHeight = LANE_HEADER_H + LANE_PAD_TOP + maxRows * NODE_H + (maxRows - 1) * ROW_GAP + LANE_PAD_BOT;
    lanes.push({ id: laneId, name, yTop: yCursor, height: laneHeight });
    for (const [col, rows] of byCol.entries()) {
      rows.forEach((t, i) => {
        const x = 20 + col * (NODE_W + COL_GAP);
        const y = yCursor + LANE_HEADER_H + LANE_PAD_TOP + i * (NODE_H + ROW_GAP);
        positioned.push({ task: t, x, y, col, laneId, ghost: ghostIds.has(t.id) });
      });
    }
    yCursor += laneHeight + 8;
  };

  for (const area of orderedAreas) {
    buildLane(area.id, area.name, placedTasks.filter((t) => t.area_id === area.id));
  }
  buildLane("__none", "Ohne Bereich", placedTasks.filter((t) => !t.area_id));

  const maxCol = Math.max(0, ...positioned.map((p) => p.col));
  const width = 40 + (maxCol + 1) * NODE_W + maxCol * COL_GAP;
  const height = Math.max(400, yCursor + 24);
  return { positioned, lanes, width, height };
}

interface NetworkCanvasProps {
  connectMode?: boolean;
  connectSource?: string | null;
  onConnectTap?: (taskId: string) => void;
}

function compactDeadline(task: DerivedTask): { text: string; color: string } | null {
  if (task.no_deadline || !task.deadline) return null;
  const d = new Date(task.deadline);
  const diff = Math.round((d.getTime() - Date.now()) / 86400000);
  const fmt = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  if (diff < 0) return { text: "überfällig", color: "#ef4444" };
  if (diff === 0) return { text: "heute", color: "#f59e0b" };
  if (diff <= 3) return { text: fmt, color: "#f59e0b" };
  return { text: fmt, color: "#94a3b8" };
}

export function NetworkCanvas({ connectMode = false, connectSource = null, onConnectTap }: NetworkCanvasProps = {}) {
  const areas = useStore((s) => s.areas);
  const users = useStore((s) => s.users);
  const openDetail = useStore((s) => s.openDetail);
  const filterAreaIds = useStore((s) => s.filterAreaIds);
  const filterOwnerIds = useStore((s) => s.filterOwnerIds);
  const derived = useDerivedTasks();

  const visibleTaskIds = useMemo(() => {
    return new Set(
      derived
        .filter((t) => filterAreaIds.length === 0 || (t.area_id && filterAreaIds.includes(t.area_id)))
        .filter((t) => filterOwnerIds.length === 0 || (t.owner_id && filterOwnerIds.includes(t.owner_id)))
        .map((t) => t.id),
    );
  }, [derived, filterAreaIds, filterOwnerIds]);

  const showGhosts = filterAreaIds.length > 0 || filterOwnerIds.length > 0;

  const { positioned, lanes, width, height } = useMemo(
    () => computeLayout(derived, areas, visibleTaskIds, showGhosts),
    [derived, areas, visibleTaskIds, showGhosts],
  );
  const posById = useMemo(() => new Map(positioned.map((p) => [p.task.id, p])), [positioned]);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  useEffect(() => { setPan({ x: 0, y: 0 }); }, [derived.length]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, startX: pan.x, startY: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.startX + (e.clientX - dragRef.current.x),
      y: dragRef.current.startY + (e.clientY - dragRef.current.y),
    });
  };
  const onPointerUp = () => { dragRef.current = null; };

  if (derived.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Noch keine Aufgaben — leg los, dann erscheinen sie hier als Netzplan.
      </div>
    );
  }

  // Build unique gradient defs per owner for "done dep" edges
  const ownerColorByTaskId = (id: string) => {
    const t = derived.find((x) => x.id === id);
    const u = users.find((u) => u.id === t?.owner_id);
    return ownerStyle(u).main;
  };

  return (
    <div
      ref={containerRef}
      className="h-full w-full touch-none overflow-hidden bg-surface select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, width, height }} className="relative">
        <svg width={width} height={height} className="absolute inset-0 pointer-events-none">
          <defs>
            <linearGradient id="cross-grad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#c084fc" />
            </linearGradient>
            <marker id="arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#4a3580" />
            </marker>
            {/* per-owner gradient for done edges */}
            {users.map((u) => {
              const c = ownerStyle(u).main;
              return (
                <linearGradient key={u.id} id={`done-grad-${u.id}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={c} stopOpacity={0.7} />
                  <stop offset="100%" stopColor={c} stopOpacity={0} />
                </linearGradient>
              );
            })}
          </defs>

          {/* Lane backgrounds */}
          {lanes.map((l) => (
            <g key={l.id}>
              <rect x={4} y={l.yTop} width={width - 8} height={l.height} rx={14} fill="#0f0228" stroke="#1f0a3d" />
              <text x={18} y={l.yTop + 22} fill="#a78bfa" fontSize="12" fontWeight="700" style={{ textTransform: "uppercase", letterSpacing: 1 }}>
                {l.name}
              </text>
            </g>
          ))}

          {/* Edges */}
          {positioned.flatMap((p) =>
            p.task.dependsOn.map((dep) => {
              const from = posById.get(dep.id);
              if (!from) return null;
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = p.x;
              const y2 = p.y + NODE_H / 2;
              const cx1 = x1 + Math.min(80, (x2 - x1) / 2);
              const cx2 = x2 - Math.min(80, (x2 - x1) / 2);
              const crossLane = from.laneId !== p.laneId;
              const depDone = dep.status === "done";

              let stroke: string;
              let strokeWidth: number;
              let dash: string | undefined;
              let marker: string | undefined;
              if (crossLane) {
                stroke = "url(#cross-grad)";
                strokeWidth = 2.5;
                dash = "8 3";
              } else if (depDone) {
                stroke = `url(#done-grad-${from.task.owner_id ?? ""})`;
                strokeWidth = 2;
                dash = undefined;
              } else {
                stroke = "#4a3580";
                strokeWidth = 1.5;
                dash = "5 4";
                marker = "url(#arrow-dim)";
              }

              return (
                <path
                  key={`${dep.id}-${p.task.id}`}
                  d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeDasharray={dash}
                  markerEnd={marker}
                />
              );
            }),
          )}
        </svg>

        {/* Nodes */}
        {positioned.map((p) => {
          const owner = users.find((u) => u.id === p.task.owner_id);
          const style = ownerStyle(owner);
          const done = p.task.effectiveStatus === "done";
          const blocked = p.task.isBlocked;
          const ghost = p.ghost;
          const dot = PRIORITY_DOT[p.task.priority];
          const area = areaById.get(p.task.area_id ?? "");

          const borderColor = ghost
            ? withAlpha(style.main, 0.5)
            : done ? withAlpha(style.main, 0.3) : style.main;
          const borderStyle = blocked || ghost ? "dashed" : "solid";
          const borderWidth = done && !ghost ? 1 : 1.5;
          const opacity = ghost ? 0.32 : done ? 0.38 : 1;
          const boxShadow = !done && !blocked && !ghost ? `0 0 10px ${withAlpha(style.main, 0.35)}` : undefined;

          return (
            <button
              key={p.task.id}
              data-node
              onClick={ghost ? undefined : () => openDetail(p.task.id)}
              disabled={ghost}
              className="absolute cut-corner text-left transition-transform active:scale-[0.97]"
              style={{
                left: p.x,
                top: p.y,
                width: NODE_W,
                height: NODE_H,
                background: done ? "transparent" : style.bg,
                border: `${borderWidth}px ${borderStyle} ${borderColor}`,
                opacity,
                boxShadow,
                cursor: ghost ? "default" : "pointer",
              }}
            >
              {ghost && area && (
                <span
                  className="absolute -top-1 right-1 rounded-sm px-1 text-[9px] font-semibold uppercase"
                  style={{ color: "#fcd34d", background: "rgba(245,158,11,0.18)" }}
                >
                  {area.name}
                </span>
              )}
              <div className="flex h-full flex-col justify-between p-2">
                {done ? (
                  <p className="text-[12px] font-semibold leading-tight line-clamp-3 line-through">
                    {p.task.title}
                  </p>
                ) : (
                  <>
                    <div className="flex items-start gap-1.5">
                      <span
                        className="mt-[3px] inline-block h-[10px] w-[10px] shrink-0 rounded-full"
                        style={{ background: dot }}
                      />
                      <p className="text-[12px] font-semibold leading-tight line-clamp-2 text-foreground">
                        {p.task.title}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      {owner ? (
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ background: style.main }}
                        >
                          {owner.initials}
                        </span>
                      ) : <span />}
                      {area && (
                        <span className="text-[9px] uppercase tracking-wide" style={{ color: style.accent }}>
                          {area.name}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
