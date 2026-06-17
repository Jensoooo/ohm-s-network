import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { useDerivedTasks } from "./TaskCard";
import { ownerStyle, PRIORITY_DOT, withAlpha } from "@/lib/colors";
import type { DerivedTask } from "@/lib/types";

const NODE_W = 160;
const NODE_H = 84;
const COL_GAP = 28;
const ROW_GAP = 60;
const PAD_X = 20;
const PAD_Y = 48;

interface Positioned {
  task: DerivedTask;
  x: number;
  y: number;
  row: number;
  col: number;
  ghost: boolean;
}

// ─── Crossing-Reduction: paarweise Swaps ──────────────────────────────────────
function countCrossings(
  rowA: DerivedTask[],
  rowB: DerivedTask[],
  colByTask: Map<string, number>,
  placedIds: Set<string>,
): number {
  let c = 0;
  for (let i = 0; i < rowB.length; i++) {
    const colBi = colByTask.get(rowB[i].id) ?? i;
    for (const dep of rowB[i].dependsOn.filter((d) => placedIds.has(d.id))) {
      const colA = colByTask.get(dep.id);
      if (colA === undefined) continue;
      for (let j = i + 1; j < rowB.length; j++) {
        const colBj = colByTask.get(rowB[j].id) ?? j;
        for (const dep2 of rowB[j].dependsOn.filter((d) => placedIds.has(d.id))) {
          const colA2 = colByTask.get(dep2.id);
          if (colA2 === undefined) continue;
          if ((colA < colA2 && colBi > colBj) || (colA > colA2 && colBi < colBj)) c++;
        }
      }
    }
  }
  return c;
}

function swapReduce(
  row: number,
  byRow: DerivedTask[][],
  colByTask: Map<string, number>,
  placedIds: Set<string>,
  maxRow: number,
) {
  const rt = byRow[row];
  if (rt.length < 2) return;
  let improved = true;
  let iter = 0;
  while (improved && iter++ < 15) {
    improved = false;
    for (let i = 0; i < rt.length - 1; i++) {
      const tA = rt[i], tB = rt[i + 1];
      const before =
        (row > 0 ? countCrossings(byRow[row - 1], rt, colByTask, placedIds) : 0) +
        (row < maxRow ? countCrossings(rt, byRow[row + 1] ?? [], colByTask, placedIds) : 0);
      colByTask.set(tA.id, i + 1); colByTask.set(tB.id, i);
      rt[i] = tB; rt[i + 1] = tA;
      const after =
        (row > 0 ? countCrossings(byRow[row - 1], rt, colByTask, placedIds) : 0) +
        (row < maxRow ? countCrossings(rt, byRow[row + 1] ?? [], colByTask, placedIds) : 0);
      if (after >= before) {
        colByTask.set(tA.id, i); colByTask.set(tB.id, i + 1);
        rt[i] = tA; rt[i + 1] = tB;
      } else {
        improved = true;
      }
    }
  }
}

// ─── Layout ───────────────────────────────────────────────────────────────────
function computeLayout(
  tasks: DerivedTask[],
  visibleTaskIds: Set<string>,
  showGhosts: boolean,
) {
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
  if (placedTasks.length === 0) return { positioned: [], width: 400, height: 400 };

  // Nachfolger-Map aufbauen
  const successorsByTask = new Map<string, string[]>();
  for (const t of placedTasks)
    for (const dep of t.dependsOn) {
      if (!placedIds.has(dep.id)) continue;
      if (!successorsByTask.has(dep.id)) successorsByTask.set(dep.id, []);
      successorsByTask.get(dep.id)!.push(t.id);
    }

  // ── SCHRITT 1: Tasks kategorisieren ────────────────────────────────────────
  // "Isoliert" = keine Vorgänger UND keine Nachfolger → stapeln untereinander
  // "Vernetzt" = hat mindestens eine Verbindung → normales Layout
  const isolatedTasks: DerivedTask[] = [];
  const connectedTasks: DerivedTask[] = [];

  for (const t of placedTasks) {
    const hasPreds = t.dependsOn.some((d) => placedIds.has(d.id));
    const hasSuccs = (successorsByTask.get(t.id) ?? []).length > 0;
    if (!hasPreds && !hasSuccs) {
      isolatedTasks.push(t);
    } else {
      connectedTasks.push(t);
    }
  }

  // ── SCHRITT 2: ROW für vernetzte Tasks via Longest-Path ───────────────────
  const rowByTask = new Map<string, number>();
  const remaining = new Set(connectedTasks.map((t) => t.id));
  let safe = 0;
  while (remaining.size > 0 && safe++ < 5000) {
    let progressed = false;
    for (const id of Array.from(remaining)) {
      const t = connectedTasks.find((x) => x.id === id)!;
      const predRows = t.dependsOn
        .filter((d) => placedIds.has(d.id))
        .map((d) => rowByTask.get(d.id));
      if (predRows.every((r) => r !== undefined)) {
        rowByTask.set(id, predRows.length > 0 ? Math.max(...(predRows as number[])) + 1 : 0);
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) { for (const id of remaining) rowByTask.set(id, 0); break; }
  }

  // Done-Tasks ans Ende
  const maxActiveRow = Math.max(
    0,
    ...connectedTasks.filter((t) => t.effectiveStatus !== "done").map((t) => rowByTask.get(t.id) ?? 0),
  );
  for (const t of connectedTasks) {
    if (t.effectiveStatus === "done")
      rowByTask.set(t.id, Math.max(rowByTask.get(t.id) ?? 0, maxActiveRow + 1));
  }

  // ── SCHRITT 3: COL via Barycenter + Crossing-Reduction ───────────────────
  const maxConnectedRow = connectedTasks.length > 0 ? Math.max(...Array.from(rowByTask.values())) : 0;
  const byRow: DerivedTask[][] = Array.from({ length: maxConnectedRow + 1 }, () => []);
  for (const t of connectedTasks) byRow[rowByTask.get(t.id) ?? 0].push(t);

  const colByTask = new Map<string, number>();

  // Init alphabetisch
  for (const rowTasks of byRow) {
    rowTasks.sort((a, b) => a.title.localeCompare(b.title));
    rowTasks.forEach((t, i) => colByTask.set(t.id, i));
  }

  // 3 Barycenter-Passes + Crossing-Reduction
  for (let pass = 0; pass < 3; pass++) {
    for (let row = 1; row <= maxConnectedRow; row++) {
      const rt = byRow[row]; if (!rt.length) continue;
      const sorted = rt.map((t) => {
        const preds = t.dependsOn.filter((d) => placedIds.has(d.id));
        return { t, bary: preds.length ? preds.reduce((s, d) => s + (colByTask.get(d.id) ?? 0), 0) / preds.length : colByTask.get(t.id) ?? 0 };
      }).sort((a, b) => a.bary - b.bary);
      sorted.forEach(({ t }, i) => { colByTask.set(t.id, i); byRow[row][i] = t; });
      swapReduce(row, byRow, colByTask, placedIds, maxConnectedRow);
    }
    for (let row = maxConnectedRow - 1; row >= 0; row--) {
      const rt = byRow[row]; if (!rt.length) continue;
      const sorted = rt.map((t) => {
        const succs = (successorsByTask.get(t.id) ?? []).filter((id) => placedIds.has(id));
        return { t, bary: succs.length ? succs.reduce((s, id) => s + (colByTask.get(id) ?? 0), 0) / succs.length : colByTask.get(t.id) ?? 0 };
      }).sort((a, b) => a.bary - b.bary);
      sorted.forEach(({ t }, i) => { colByTask.set(t.id, i); byRow[row][i] = t; });
      swapReduce(row, byRow, colByTask, placedIds, maxConnectedRow);
    }
  }

  // ── SCHRITT 4: Pixel-Koordinaten ──────────────────────────────────────────
  const maxConnectedCols = Math.max(...byRow.map((r) => r.length), 1);
  const connectedWidth = maxConnectedCols * NODE_W + (maxConnectedCols - 1) * COL_GAP;

  // Isolierte Tasks: untereinander in einer Spalte RECHTS neben dem vernetzten Bereich
  // (mit etwas extra Abstand)
  const ISOLATED_COL_OFFSET = connectedWidth + COL_GAP * 3;
  const hasIsolated = isolatedTasks.length > 0;

  const totalWidth = PAD_X * 2 + connectedWidth + (hasIsolated ? COL_GAP * 3 + NODE_W : 0);

  const positioned: Positioned[] = [];

  // Vernetzte Tasks
  for (let row = 0; row <= maxConnectedRow; row++) {
    const rowTasks = byRow[row];
    if (!rowTasks.length) continue;
    rowTasks.sort((a, b) => (colByTask.get(a.id) ?? 0) - (colByTask.get(b.id) ?? 0));
    rowTasks.forEach((t, colIndex) => {
      positioned.push({
        task: t,
        x: PAD_X + colIndex * (NODE_W + COL_GAP),
        y: PAD_Y + row * (NODE_H + ROW_GAP),
        row,
        col: colIndex,
        ghost: ghostIds.has(t.id),
      });
    });
  }

  // Isolierte Tasks: untereinander gestapelt in eigener Spalte
  // Done-Tasks unter aktive
  isolatedTasks.sort((a, b) => {
    const aDone = a.effectiveStatus === "done" ? 1 : 0;
    const bDone = b.effectiveStatus === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return a.title.localeCompare(b.title);
  });

  isolatedTasks.forEach((t, i) => {
    positioned.push({
      task: t,
      x: PAD_X + ISOLATED_COL_OFFSET,
      y: PAD_Y + i * (NODE_H + ROW_GAP),
      row: i, // für Pfeil-Referenz (diese Tasks haben keine Pfeile)
      col: maxConnectedCols + 2,
      ghost: ghostIds.has(t.id),
    });
  });

  const totalHeight = Math.max(
    PAD_Y * 2 + (maxConnectedRow + 1) * NODE_H + maxConnectedRow * ROW_GAP,
    PAD_Y * 2 + isolatedTasks.length * NODE_H + (isolatedTasks.length - 1) * ROW_GAP,
    400,
  );

  return {
    positioned,
    width: Math.max(totalWidth, 360),
    height: totalHeight,
  };
}

// ─── Deadline ─────────────────────────────────────────────────────────────────
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

// ─── Props ────────────────────────────────────────────────────────────────────
interface NetworkCanvasProps {
  connectMode?: boolean;
  connectSource?: string | null;
  onConnectTap?: (taskId: string) => void;
  showDone?: boolean;
  onScrollInfo?: (info: { scrollX: number; containerWidth: number; contentWidth: number }) => void;
}

// ─── Komponente ───────────────────────────────────────────────────────────────
export function NetworkCanvas({
  connectMode = false,
  connectSource = null,
  onConnectTap,
  showDone = false,
  onScrollInfo,
}: NetworkCanvasProps = {}) {
  const areas = useStore((s) => s.areas);
  const users = useStore((s) => s.users);
  const openDetail = useStore((s) => s.openDetail);
  const updateTask = useStore((s) => s.updateTask);
  const filterAreaIds = useStore((s) => s.filterAreaIds);
  const filterOwnerIds = useStore((s) => s.filterOwnerIds);
  const filterProjectIds = useStore((s) => s.filterProjectIds);
  const derived = useDerivedTasks();

  const visibleTaskIds = useMemo(
    () => new Set(
      derived
        .filter((t) => showDone || t.effectiveStatus !== "done")
        .filter((t) => filterAreaIds.length === 0 || (t.area_id && filterAreaIds.includes(t.area_id)))
        .filter((t) => filterOwnerIds.length === 0 || (t.owner_id && filterOwnerIds.includes(t.owner_id)))
        .filter((t) => filterProjectIds.length === 0 || (t.project_id && filterProjectIds.includes(t.project_id)))
        .map((t) => t.id),
    ),
    [derived, filterAreaIds, filterOwnerIds, filterProjectIds, showDone],
  );

  const showGhosts = filterAreaIds.length > 0 || filterOwnerIds.length > 0 || filterProjectIds.length > 0;

  const { positioned, width, height } = useMemo(
    () => computeLayout(derived, visibleTaskIds, showGhosts),
    [derived, visibleTaskIds, showGhosts],
  );

  const posById = useMemo(() => new Map(positioned.map((p) => [p.task.id, p])), [positioned]);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  // ── Scroll ────────────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth);
      onScrollInfo?.({ scrollX: el.scrollLeft, containerWidth: el.clientWidth, contentWidth: width });
    });
    obs.observe(el);
    setContainerWidth(el.clientWidth);
    return () => obs.disconnect();
  }, [width, onScrollInfo]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollX(el.scrollLeft);
    onScrollInfo?.({ scrollX: el.scrollLeft, containerWidth: el.clientWidth, contentWidth: width });
  }, [width, onScrollInfo]);

  // ── Scrollbar ─────────────────────────────────────────────────────────────
  const scrollbarVisible = width > containerWidth;
  const thumbWidth = scrollbarVisible ? Math.max(40, (containerWidth / width) * containerWidth) : containerWidth;
  const thumbLeft = scrollbarVisible ? (scrollX / (width - containerWidth)) * (containerWidth - thumbWidth) : 0;
  const thumbDrag = useRef<{ startX: number; startScrollX: number } | null>(null);

  const onThumbDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    thumbDrag.current = { startX: e.clientX, startScrollX: scrollRef.current?.scrollLeft ?? 0 };
  };
  const onThumbMove = (e: React.PointerEvent) => {
    if (!thumbDrag.current || !scrollRef.current) return;
    const dx = e.clientX - thumbDrag.current.startX;
    const ratio = (width - containerWidth) / (containerWidth - thumbWidth);
    scrollRef.current.scrollLeft = thumbDrag.current.startScrollX + dx * ratio;
  };
  const onThumbUp = () => { thumbDrag.current = null; };

  // ── Node-Drag ─────────────────────────────────────────────────────────────
  const [nodeDrag, setNodeDrag] = useState<{ taskId: string; cx: number; cy: number } | null>(null);
  const nodeDragInit = useRef<{
    taskId: string; startClientX: number; startClientY: number;
    activated: boolean; suppressClick: boolean;
    longPressTimer: number | null; longPressReady: boolean;
  } | null>(null);

  const beginNodeDrag = (e: React.PointerEvent, taskId: string) => {
    if (connectMode) return;
    const s = {
      taskId, startClientX: e.clientX, startClientY: e.clientY,
      activated: false, suppressClick: false,
      longPressTimer: null as number | null,
      longPressReady: e.pointerType !== "touch",
    };
    nodeDragInit.current = s;
    if (e.pointerType === "touch")
      s.longPressTimer = window.setTimeout(() => { s.longPressReady = true; }, 400);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - s.startClientX, dy = ev.clientY - s.startClientY;
      if (!s.activated) {
        if (!s.longPressReady || dx * dx + dy * dy < 64) return;
        s.activated = true; s.suppressClick = true;
      }
      const rect = scrollRef.current?.getBoundingClientRect();
      if (!rect) return;
      setNodeDrag({ taskId: s.taskId, cx: ev.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0), cy: ev.clientY - rect.top + (scrollRef.current?.scrollTop ?? 0) });
    };
    const onUp = () => {
      if (s.longPressTimer) window.clearTimeout(s.longPressTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      nodeDragInit.current = null; setNodeDrag(null);
      window.setTimeout(() => { s.suppressClick = false; }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  if (derived.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Noch keine Aufgaben — leg los, dann erscheinen sie hier als Netzplan.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: connectMode ? "#1a0a3d" : "#0f0228" }}>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-x-auto overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <div style={{ width, height, position: "relative", flexShrink: 0 }}>

          {/* SVG Pfeile */}
          <svg width={width} height={height} className="absolute inset-0 pointer-events-none">
            <defs>
              <filter id="arrow-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <marker id="arrow-main" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="7" markerHeight="7" orient="auto">
                <polyline points="2,2 10,6 2,10" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
              <marker id="arrow-cross" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="7" markerHeight="7" orient="auto">
                <polyline points="2,2 10,6 2,10" fill="none" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
              {users.map((u) => {
                const c = ownerStyle(u).main;
                return (
                  <linearGradient key={u.id} id={`done-grad-${u.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.08} />
                  </linearGradient>
                );
              })}
            </defs>
            {positioned.flatMap((p) =>
              p.task.dependsOn.map((dep) => {
                const from = posById.get(dep.id);
                if (!from) return null;
                const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H;
                const x2 = p.x + NODE_W / 2, y2 = p.y;
                const midY = (y1 + y2) / 2;
                const depDone = dep.status === "done";
                const crossRow = Math.abs(from.row - p.row) > 1;
                return (
                  <path
                    key={`${dep.id}-${p.task.id}`}
                    d={`M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`}
                    stroke={depDone ? `url(#done-grad-${from.task.owner_id ?? ""})` : crossRow ? "#6366f1" : "#a78bfa"}
                    strokeWidth={depDone ? 1 : 3}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={depDone ? "3 5" : crossRow ? "4 6" : undefined}
                    filter={!depDone ? "url(#arrow-glow)" : undefined}
                    markerEnd={depDone ? undefined : crossRow ? "url(#arrow-cross)" : "url(#arrow-main)"}
                  />
                );
              }),
            )}
          </svg>

          {/* Task Nodes */}
          {positioned.map((p) => {
            const owner = users.find((u) => u.id === p.task.owner_id);
            const style = ownerStyle(owner);
            const done = p.task.effectiveStatus === "done";
            const blocked = p.task.isBlocked;
            const ghost = p.ghost;
            const dot = PRIORITY_DOT[p.task.priority];
            const area = areaById.get(p.task.area_id ?? "");
            const dl = compactDeadline(p.task);
            const isSource = connectMode && connectSource === p.task.id;
            const isConnectable = connectMode && !ghost && p.task.id !== connectSource;
            const boxShadow = isSource
              ? `0 0 0 2px white, 0 0 20px ${style.main}`
              : isConnectable ? `0 0 8px ${withAlpha(style.main, 0.4)}`
              : !done && !blocked && !ghost ? `0 0 10px ${withAlpha(style.main, 0.3)}`
              : undefined;
            const isDragging = nodeDrag?.taskId === p.task.id;

            return (
              <button
                key={p.task.id}
                data-node
                onPointerDown={ghost || connectMode ? undefined : (e) => beginNodeDrag(e, p.task.id)}
                onClick={ghost ? undefined : (e) => {
                  if (nodeDragInit.current?.suppressClick) { e.preventDefault(); return; }
                  if (connectMode && onConnectTap) onConnectTap(p.task.id);
                  else openDetail(p.task.id);
                }}
                disabled={ghost}
                className="absolute cut-corner text-left transition-transform active:scale-[0.97]"
                style={{
                  left: p.x, top: p.y, width: NODE_W, height: NODE_H,
                  background: done ? "transparent" : style.bg,
                  border: `${done ? 1 : 1.5}px ${blocked || ghost ? "dashed" : "solid"} ${ghost ? withAlpha(style.main, 0.4) : done ? withAlpha(style.main, 0.25) : style.main}`,
                  opacity: isDragging ? 0.2 : ghost ? 0.3 : done ? 0.4 : 1,
                  boxShadow, cursor: ghost ? "default" : connectMode ? "crosshair" : "pointer",
                  touchAction: "none",
                }}
              >
                {area && (
                  <span className="absolute -top-[10px] right-2 rounded-sm px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide"
                    style={{ color: style.accent, background: withAlpha(style.main, 0.18), border: `1px solid ${withAlpha(style.main, 0.3)}` }}>
                    {area.name}
                  </span>
                )}
                <div className="flex h-full flex-col justify-between p-2">
                  {done ? (
                    <p className="text-[11px] font-semibold leading-tight line-clamp-3 line-through text-muted-foreground">{p.task.title}</p>
                  ) : (
                    <>
                      <div className="flex items-start gap-1.5">
                        <span className="mt-[3px] inline-block h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: dot }} />
                        <p className="text-[12px] font-semibold leading-tight line-clamp-2 text-foreground">{p.task.title}</p>
                      </div>
                      <div className="flex items-center justify-between gap-1 mt-1">
                        {owner ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: style.main }}>
                            {owner.initials}
                          </span>
                        ) : <span />}
                        {dl && (
                          <span className="rounded-full px-1.5 py-[1px] text-[10px] font-bold leading-none"
                            style={{ color: dl.color, background: withAlpha(dl.color, 0.16), border: `1px solid ${withAlpha(dl.color, 0.4)}` }}>
                            {dl.text}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </button>
            );
          })}

          {/* Drag Ghost */}
          {nodeDrag && (() => {
            const p = posById.get(nodeDrag.taskId);
            if (!p) return null;
            const owner = users.find((u) => u.id === p.task.owner_id);
            const st = ownerStyle(owner);
            return (
              <div className="absolute pointer-events-none cut-corner"
                style={{ left: nodeDrag.cx - NODE_W / 2, top: nodeDrag.cy - NODE_H / 2, width: NODE_W, height: NODE_H, background: st.bg, border: `1.5px solid ${st.main}`, opacity: 0.55, boxShadow: `0 12px 32px ${withAlpha(st.main, 0.45)}`, zIndex: 50 }}>
                <div className="flex h-full items-start p-2">
                  <p className="text-[12px] font-semibold leading-tight line-clamp-2 text-foreground">{p.task.title}</p>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Scrollbar */}
      {scrollbarVisible && (
        <div className="relative mx-4 my-2 rounded-full flex-shrink-0" style={{ height: 4, background: "rgba(167,139,250,0.12)" }}>
          <div
            className="absolute top-0 rounded-full cursor-grab active:cursor-grabbing"
            style={{ left: thumbLeft, width: thumbWidth, height: 4, background: "rgba(167,139,250,0.55)", touchAction: "none" }}
            onPointerDown={onThumbDown}
            onPointerMove={onThumbMove}
            onPointerUp={onThumbUp}
            onPointerCancel={onThumbUp}
          />
        </div>
      )}
    </div>
  );
}
