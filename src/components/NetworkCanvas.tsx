import { useMemo, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { useDerivedTasks } from "./TaskCard";
import { ownerStyle, PRIORITY_DOT, withAlpha } from "@/lib/colors";
import type { DerivedTask } from "@/lib/types";

const NODE_W = 172;
const NODE_H = 88;
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
  const updateTask = useStore((s) => s.updateTask);
  const filterAreaIds = useStore((s) => s.filterAreaIds);
  const filterOwnerIds = useStore((s) => s.filterOwnerIds);
  const filterProjectIds = useStore((s) => s.filterProjectIds);
  const derived = useDerivedTasks();

  const visibleTaskIds = useMemo(() => {
    return new Set(
      derived
        .filter((t) => filterAreaIds.length === 0 || (t.area_id && filterAreaIds.includes(t.area_id)))
        .filter((t) => filterOwnerIds.length === 0 || (t.owner_id && filterOwnerIds.includes(t.owner_id)))
        .filter((t) => filterProjectIds.length === 0 || (t.project_id && filterProjectIds.includes(t.project_id)))
        .map((t) => t.id),
    );
  }, [derived, filterAreaIds, filterOwnerIds, filterProjectIds]);

  const showGhosts = filterAreaIds.length > 0 || filterOwnerIds.length > 0 || filterProjectIds.length > 0;


  const { positioned, lanes, width, height } = useMemo(
    () => computeLayout(derived, areas, visibleTaskIds, showGhosts),
    [derived, areas, visibleTaskIds, showGhosts],
  );
  const posById = useMemo(() => new Map(positioned.map((p) => [p.task.id, p])), [positioned]);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  useEffect(() => { panRef.current = pan; }, [pan]);
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  // Node drag (move task to another lane)
  const [nodeDrag, setNodeDrag] = useState<{
    taskId: string;
    sourceLaneId: string;
    cx: number; // canvas coords
    cy: number;
    hoverLaneId: string | null;
  } | null>(null);
  const nodeDragInit = useRef<{
    taskId: string;
    sourceLaneId: string;
    startClientX: number;
    startClientY: number;
    pointerType: string;
    longPressReady: boolean;
    activated: boolean;
    longPressTimer: number | null;
    suppressClick: boolean;
  } | null>(null);

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

  const nodeDragRef = useRef<typeof nodeDrag>(null);
  useEffect(() => { nodeDragRef.current = nodeDrag; }, [nodeDrag]);
  const lanesRef = useRef(lanes);
  useEffect(() => { lanesRef.current = lanes; }, [lanes]);

  const beginNodeDrag = (e: React.PointerEvent, taskId: string, sourceLaneId: string) => {
    if (connectMode) return;
    const s = {
      taskId,
      sourceLaneId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      pointerType: e.pointerType,
      longPressReady: e.pointerType !== "touch",
      activated: false,
      longPressTimer: null as number | null,
      suppressClick: false,
    };
    nodeDragInit.current = s;
    if (e.pointerType === "touch") {
      s.longPressTimer = window.setTimeout(() => { s.longPressReady = true; }, 400);
    }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - s.startClientX;
      const dy = ev.clientY - s.startClientY;
      if (!s.activated) {
        if (!s.longPressReady) return;
        if (dx * dx + dy * dy < 64) return;
        s.activated = true;
        s.suppressClick = true;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = ev.clientX - rect.left - panRef.current.x;
      const cy = ev.clientY - rect.top - panRef.current.y;
      let hover: string | null = null;
      for (const l of lanesRef.current) {
        if (cy >= l.yTop && cy <= l.yTop + l.height) {
          if (l.id !== s.sourceLaneId && l.id !== "__none") hover = l.id;
          break;
        }
      }
      setNodeDrag({ taskId: s.taskId, sourceLaneId: s.sourceLaneId, cx, cy, hoverLaneId: hover });
    };
    const onUp = async () => {
      if (s.longPressTimer) { window.clearTimeout(s.longPressTimer); s.longPressTimer = null; }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const wasActive = s.activated;
      const finalDrag = nodeDragRef.current;
      nodeDragInit.current = null;
      setNodeDrag(null);
      if (wasActive && finalDrag?.hoverLaneId) {
        const area = areas.find((a) => a.id === finalDrag.hoverLaneId);
        await updateTask(finalDrag.taskId, { area_id: finalDrag.hoverLaneId });
        if (area) toast.success(`Task zu ${area.name} verschoben`);
      }
      window.setTimeout(() => { s.suppressClick = false; }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const wasDraggedRef = () => nodeDragInit.current?.suppressClick === true;

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
      className="h-full w-full touch-none overflow-hidden select-none transition-colors duration-300"
      style={{ background: connectMode ? "#1a0a3d" : "#0f0228" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, width, height }} className="relative isolate">
        <svg width={width} height={height} className="absolute inset-0 pointer-events-none -z-0">
          <defs>
            <linearGradient id="cross-grad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#c084fc" />
            </linearGradient>
            <marker id="arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="#a78bfa" />
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
          {lanes.map((l) => {
            const isDrop = nodeDrag?.hoverLaneId === l.id;
            return (
              <g key={l.id} style={{ transition: "opacity 0.15s" }}>
                <rect
                  x={4}
                  y={l.yTop}
                  width={width - 8}
                  height={l.height}
                  rx={14}
                  fill={isDrop ? "rgba(124,58,237,0.08)" : "#0f0228"}
                  stroke={isDrop ? "rgba(124,58,237,0.4)" : "#1f0a3d"}
                  strokeWidth={isDrop ? 1.5 : 1}
                />
                <text x={18} y={l.yTop + 22} fill="#a78bfa" fontSize="12" fontWeight="700" style={{ textTransform: "uppercase", letterSpacing: 1 }}>
                  {l.name}
                </text>
              </g>
            );
          })}

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
              const pathD = `M ${x1} ${y1} C ${cx1} ${y1} ${cx2} ${y2} ${x2} ${y2}`;
              const crossLane = from.laneId !== p.laneId;
              const depDone = dep.status === "done";

              let stroke: string;
              let strokeWidth: number;
              let dash: string | undefined;
              let marker: string | undefined;
              if (crossLane) {
                // bereichsübergreifend: dezent
                stroke = "url(#cross-grad)";
                strokeWidth = 1.25;
                dash = "3 5";
                marker = undefined;
              } else if (depDone) {
                stroke = `url(#done-grad-${from.task.owner_id ?? ""})`;
                strokeWidth = 2;
                dash = undefined;
              } else {
                // innerhalb eines Bereichs: deutlich sichtbar
                stroke = "#a78bfa";
                strokeWidth = 2.5;
                dash = undefined;
                marker = "url(#arrow-dim)";
              }

              return (
                <path
                  key={`${dep.id}-${p.task.id}`}
                  d={pathD}
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
          const isSource = connectMode && connectSource === p.task.id;
          const isConnectable = connectMode && !ghost && p.task.id !== connectSource;
          const boxShadow = isSource
            ? `0 0 0 2px white, 0 0 20px ${style.main}`
            : isConnectable
            ? `0 0 8px ${withAlpha(style.main, 0.4)}`
            : !done && !blocked && !ghost
            ? `0 0 10px ${withAlpha(style.main, 0.35)}`
            : undefined;
          const cursor = ghost ? "default" : connectMode ? "crosshair" : "pointer";
          const dl = compactDeadline(p.task);

          const isDragging = nodeDrag?.taskId === p.task.id;
          return (
            <button
              key={p.task.id}
              data-node
              onPointerDown={
                ghost || connectMode
                  ? undefined
                  : (e) => beginNodeDrag(e, p.task.id, p.laneId)
              }
              onClick={
                ghost
                  ? undefined
                  : (e) => {
                      if (wasDraggedRef()) { e.preventDefault(); return; }
                      if (connectMode && onConnectTap) onConnectTap(p.task.id);
                      else openDetail(p.task.id);
                    }
              }
              disabled={ghost}
              className="absolute z-10 cut-corner text-left transition-transform active:scale-[0.97]"
              style={{
                left: p.x,
                top: p.y,
                width: NODE_W,
                height: NODE_H,
                background: done ? "transparent" : style.bg,
                border: `${borderWidth}px ${borderStyle} ${borderColor}`,
                opacity: isDragging ? 0.25 : opacity,
                boxShadow,
                cursor,
                touchAction: "none",
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
                    <div className="flex items-center justify-between gap-1">
                      {owner ? (
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                          style={{ background: style.main }}
                        >
                          {owner.initials}
                        </span>
                      ) : <span />}
                      {dl && (
                        <span
                          className="rounded-full px-2 py-[2px] text-[11px] font-bold leading-none tracking-tight"
                          style={{
                            color: dl.color,
                            background: withAlpha(dl.color, 0.16),
                            border: `1px solid ${withAlpha(dl.color, 0.45)}`,
                          }}
                        >
                          {dl.text}
                        </span>
                      )}
                      {area && (
                        <span
                          className="text-[9px] uppercase tracking-wide shrink-0 overflow-hidden text-ellipsis"
                          style={{ color: style.accent, maxWidth: 60 }}
                        >
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

        {/* Drag ghost */}
        {nodeDrag && (() => {
          const p = posById.get(nodeDrag.taskId);
          if (!p) return null;
          const owner = users.find((u) => u.id === p.task.owner_id);
          const st = ownerStyle(owner);
          return (
            <div
              className="absolute pointer-events-none cut-corner"
              style={{
                left: nodeDrag.cx - NODE_W / 2,
                top: nodeDrag.cy - NODE_H / 2,
                width: NODE_W,
                height: NODE_H,
                background: st.bg,
                border: `1.5px solid ${st.main}`,
                opacity: 0.6,
                boxShadow: `0 12px 32px ${withAlpha(st.main, 0.5)}`,
                zIndex: 50,
              }}
            >
              <div className="flex h-full items-start p-2">
                <p className="text-[12px] font-semibold leading-tight line-clamp-2 text-foreground">
                  {p.task.title}
                </p>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
