import { useMemo, useRef, useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { useDerivedTasks } from "./TaskCard";
import type { DerivedTask } from "@/lib/types";

// Layout constants
const NODE_W = 160;
const NODE_H = 72;
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
}

interface LaneLayout {
  id: string;
  name: string;
  yTop: number;
  height: number;
}

function computeLayout(
  tasks: DerivedTask[],
  areas: { id: string; name: string; sort_order: number }[],
) {
  // Topological columns based on dependencies
  const colByTask = new Map<string, number>();
  const remaining = new Set(tasks.map((t) => t.id));
  let safeguard = 0;
  while (remaining.size > 0 && safeguard++ < 1000) {
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
    if (!progressed) {
      // Break cycles by assigning 0
      for (const id of remaining) colByTask.set(id, 0);
      break;
    }
  }

  // Group by area (lane), then by column
  const orderedAreas = [...areas].sort((a, b) => a.sort_order - b.sort_order);
  const lanes: LaneLayout[] = [];
  const positioned: Positioned[] = [];
  let yCursor = 12;

  for (const area of orderedAreas) {
    const inLane = tasks.filter((t) => t.area_id === area.id);
    if (inLane.length === 0) continue;
    const byCol = new Map<number, DerivedTask[]>();
    for (const t of inLane) {
      const c = colByTask.get(t.id) ?? 0;
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c)!.push(t);
    }
    const maxRows = Math.max(...[...byCol.values()].map((v) => v.length));
    const laneHeight = LANE_HEADER_H + LANE_PAD_TOP + maxRows * NODE_H + (maxRows - 1) * ROW_GAP + LANE_PAD_BOT;
    lanes.push({ id: area.id, name: area.name, yTop: yCursor, height: laneHeight });

    for (const [col, rows] of byCol.entries()) {
      rows.forEach((t, i) => {
        const x = 20 + col * (NODE_W + COL_GAP);
        const y = yCursor + LANE_HEADER_H + LANE_PAD_TOP + i * (NODE_H + ROW_GAP);
        positioned.push({ task: t, x, y, col, laneId: area.id });
      });
    }
    yCursor += laneHeight + 8;
  }

  // Unassigned (no area)
  const noArea = tasks.filter((t) => !t.area_id);
  if (noArea.length > 0) {
    const byCol = new Map<number, DerivedTask[]>();
    for (const t of noArea) {
      const c = colByTask.get(t.id) ?? 0;
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c)!.push(t);
    }
    const maxRows = Math.max(...[...byCol.values()].map((v) => v.length));
    const laneHeight = LANE_HEADER_H + LANE_PAD_TOP + maxRows * NODE_H + (maxRows - 1) * ROW_GAP + LANE_PAD_BOT;
    lanes.push({ id: "__none", name: "Ohne Bereich", yTop: yCursor, height: laneHeight });
    for (const [col, rows] of byCol.entries()) {
      rows.forEach((t, i) => {
        const x = 20 + col * (NODE_W + COL_GAP);
        const y = yCursor + LANE_HEADER_H + LANE_PAD_TOP + i * (NODE_H + ROW_GAP);
        positioned.push({ task: t, x, y, col, laneId: "__none" });
      });
    }
    yCursor += laneHeight + 8;
  }

  const maxCol = Math.max(0, ...positioned.map((p) => p.col));
  const width = 40 + (maxCol + 1) * NODE_W + maxCol * COL_GAP;
  const height = Math.max(400, yCursor + 24);
  return { positioned, lanes, width, height };
}

export function NetworkCanvas() {
  const areas = useStore((s) => s.areas);
  const openDetail = useStore((s) => s.openDetail);
  const derived = useDerivedTasks();

  const { positioned, lanes, width, height } = useMemo(
    () => computeLayout(derived, areas),
    [derived, areas],
  );
  const posById = useMemo(() => new Map(positioned.map((p) => [p.task.id, p])), [positioned]);

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
            <linearGradient id="cross-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#7c3aed" />
            </linearGradient>
            <marker id="arrow-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#7c3aed" />
            </marker>
            <marker id="arrow-cross" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#7c3aed" />
            </marker>
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
              const stroke = crossLane ? "url(#cross-grad)" : "#7c3aed";
              return (
                <g key={`${dep.id}-${p.task.id}`}>
                  <path
                    d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
                    stroke={stroke}
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray={crossLane ? "6 5" : undefined}
                    markerEnd={`url(#${crossLane ? "arrow-cross" : "arrow-purple"})`}
                    opacity={0.9}
                  />
                  {crossLane && (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 6}
                      fill="#a78bfa"
                      fontSize="10"
                      textAnchor="middle"
                      fontWeight="600"
                    >
                      bereichsübergreifend
                    </text>
                  )}
                </g>
              );
            }),
          )}
        </svg>

        {/* Nodes */}
        {positioned.map((p) => {
          const owner = useStore.getState().users.find((u) => u.id === p.task.owner_id);
          const done = p.task.effectiveStatus === "done";
          const blocked = p.task.isBlocked;
          return (
            <button
              key={p.task.id}
              data-node
              onClick={() => openDetail(p.task.id)}
              className="absolute cut-corner bg-card-raw text-left transition-transform active:scale-[0.97]"
              style={{
                left: p.x,
                top: p.y,
                width: NODE_W,
                height: NODE_H,
                opacity: done ? 0.32 : 1,
                boxShadow: blocked ? "inset 0 0 0 1px #f59e0b" : "inset 0 0 0 1px #2a0f55",
              }}
            >
              <div className="flex h-full flex-col justify-between p-2">
                <p className={"text-[12px] font-semibold leading-tight line-clamp-2 " + (done ? "line-through" : "")}>
                  {p.task.title}
                </p>
                <div className="flex items-center justify-between">
                  {owner ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: owner.color }}>
                      {owner.initials}
                    </span>
                  ) : <span />}
                  <span className={
                    "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase " +
                    (blocked ? "bg-[var(--amber)]/20 text-[var(--amber)]"
                      : done ? "bg-[var(--teal)]/20 text-[var(--teal)]"
                      : "bg-primary/20 text-primary-foreground")
                  }>
                    {blocked ? "blockiert" : done ? "fertig" : p.task.status}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
