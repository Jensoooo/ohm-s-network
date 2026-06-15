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
const PAD_Y = 48; // FIX: Platz für Bereichs-Labels oben

interface Positioned {
  task: DerivedTask;
  x: number;
  y: number;
  row: number;
  col: number;
  ghost: boolean;
}

// ─── Crossing-Reduction: paarweise Swaps ──────────────────────────────────────
function countCrossingsBetweenRows(
  rowA: DerivedTask[],
  rowB: DerivedTask[],
  colByTask: Map<string, number>,
  placedIds: Set<string>,
): number {
  let crossings = 0;
  for (let i = 0; i < rowB.length; i++) {
    const tB = rowB[i];
    const colB = colByTask.get(tB.id) ?? i;
    for (const dep of tB.dependsOn.filter((d) => placedIds.has(d.id))) {
      const colA = colByTask.get(dep.id);
      if (colA === undefined) continue;
      for (let j = i + 1; j < rowB.length; j++) {
        const tB2 = rowB[j];
        const colB2 = colByTask.get(tB2.id) ?? j;
        for (const dep2 of tB2.dependsOn.filter((d) => placedIds.has(d.id))) {
          const colA2 = colByTask.get(dep2.id);
          if (colA2 === undefined) continue;
          if ((colA < colA2 && colB > colB2) || (colA > colA2 && colB < colB2)) {
            crossings++;
          }
        }
      }
    }
  }
  return crossings;
}

function swapReduce(
  row: number,
  byRow: DerivedTask[][],
  colByTask: Map<string, number>,
  placedIds: Set<string>,
  maxRow: number,
) {
  const rowTasks = byRow[row];
  if (rowTasks.length < 2) return;
  let improved = true;
  let iterations = 0;
  while (improved && iterations++ < 20) {
    improved = false;
    for (let i = 0; i < rowTasks.length - 1; i++) {
      const tA = rowTasks[i];
      const tB = rowTasks[i + 1];
      const before =
        (row > 0 ? countCrossingsBetweenRows(byRow[row - 1], rowTasks, colByTask, placedIds) : 0) +
        (row < maxRow ? countCrossingsBetweenRows(rowTasks, byRow[row + 1] ?? [], colByTask, placedIds) : 0);
      // Tausch
      colByTask.set(tA.id, i + 1);
      colByTask.set(tB.id, i);
      rowTasks[i] = tB;
      rowTasks[i + 1] = tA;
      const after =
        (row > 0 ? countCrossingsBetweenRows(byRow[row - 1], rowTasks, colByTask, placedIds) : 0) +
        (row < maxRow ? countCrossingsBetweenRows(rowTasks, byRow[row + 1] ?? [], colByTask, placedIds) : 0);
      if (after >= before) {
        // Rücktauschen
        colByTask.set(tA.id, i);
        colByTask.set(tB.id, i + 1);
        rowTasks[i] = tA;
        rowTasks[i + 1] = tB;
      } else {
        improved = true;
      }
    }
  }
}

// ─── Chain-Detection: zusammenhängende Teilgraphen finden ────────────────────
function findConnectedChains(tasks: DerivedTask[], placedIds: Set<string>): string[][] {
  const adjList = new Map<string, Set<string>>();
  for (const t of tasks) {
    if (!adjList.has(t.id)) adjList.set(t.id, new Set());
    for (const dep of t.dependsOn) {
      if (!placedIds.has(dep.id)) continue;
      adjList.get(t.id)!.add(dep.id);
      if (!adjList.has(dep.id)) adjList.set(dep.id, new Set());
      adjList.get(dep.id)!.add(t.id);
    }
  }
  const visited = new Set<string>();
  const chains: string[][] = [];
  for (const t of tasks) {
    if (visited.has(t.id)) continue;
    const chain: string[] = [];
    const queue = [t.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      chain.push(id);
      for (const nb of adjList.get(id) ?? []) {
        if (!visited.has(nb)) queue.push(nb);
      }
    }
    chains.push(chain);
  }
  return chains;
}

// ─── Haupt-Layout-Funktion ────────────────────────────────────────────────────
function computeLayout(
  tasks: DerivedTask[],
  visibleTaskIds: Set<string>,
  showGhosts: boolean,
) {
  // Ghost-Nodes
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

  // ── SCHRITT 1: ROW via Longest-Path ───────────────────────────────────────
  const rowByTask = new Map<string, number>();
  const remaining = new Set(placedTasks.map((t) => t.id));
  let safe = 0;
  while (remaining.size > 0 && safe++ < 5000) {
    let progressed = false;
    for (const id of Array.from(remaining)) {
      const t = placedTasks.find((x) => x.id === id)!;
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
    ...placedTasks.filter((t) => t.effectiveStatus !== "done").map((t) => rowByTask.get(t.id) ?? 0),
  );
  for (const t of placedTasks) {
    if (t.effectiveStatus === "done")
      rowByTask.set(t.id, Math.max(rowByTask.get(t.id) ?? 0, maxActiveRow + 1));
  }

  // ── SCHRITT 2: Chains finden und Col-Offsets zuweisen ─────────────────────
  // Chains die keine gemeinsamen Nodes teilen, können in separaten Col-Gruppen
  // nebeneinander gestapelt werden → reduziert Breite erheblich
  const chains = findConnectedChains(placedTasks, placedIds);
  
  // Sortiere Chains nach Größe (größte zuerst) für kompakteres Layout
  chains.sort((a, b) => b.length - a.length);
  
  // Für jeden Task: welche Chain gehört er?
  const chainByTask = new Map<string, number>();
  chains.forEach((chain, ci) => chain.forEach((id) => chainByTask.set(id, ci)));

  // ── SCHRITT 3: COL via Barycenter + Crossing-Reduction ────────────────────
  const maxRow = Math.max(...Array.from(rowByTask.values()));
  const byRow: DerivedTask[][] = Array.from({ length: maxRow + 1 }, () => []);
  for (const t of placedTasks) byRow[rowByTask.get(t.id) ?? 0].push(t);

  const colByTask = new Map<string, number>();

  // Init: nach Chain-Index dann alphabetisch, so dass Chains zusammenbleiben
  for (const rowTasks of byRow) {
    rowTasks.sort((a, b) => {
      const ca = chainByTask.get(a.id) ?? 0;
      const cb = chainByTask.get(b.id) ?? 0;
      if (ca !== cb) return ca - cb;
      return a.title.localeCompare(b.title);
    });
    rowTasks.forEach((t, i) => colByTask.set(t.id, i));
  }

  const successorsByTask = new Map<string, string[]>();
  for (const t of placedTasks)
    for (const dep of t.dependsOn) {
      if (!successorsByTask.has(dep.id)) successorsByTask.set(dep.id, []);
      successorsByTask.get(dep.id)!.push(t.id);
    }

  // 3 Barycenter-Passes (vor+rück) + Crossing-Reduction nach jedem Pass
  for (let pass = 0; pass < 3; pass++) {
    // Vorwärts: Nachfolger orientieren sich an Vorgängern
    for (let row = 1; row <= maxRow; row++) {
      const rowTasks = byRow[row];
      if (!rowTasks.length) continue;
      const sorted = rowTasks.map((t) => {
        const preds = t.dependsOn.filter((d) => placedIds.has(d.id));
        return {
          t,
          bary: preds.length
            ? preds.reduce((s, d) => s + (colByTask.get(d.id) ?? 0), 0) / preds.length
            : colByTask.get(t.id) ?? 0,
        };
      }).sort((a, b) => a.bary - b.bary);
      sorted.forEach(({ t }, i) => { colByTask.set(t.id, i); byRow[row][i] = t; });
      swapReduce(row, byRow, colByTask, placedIds, maxRow);
    }
    // Rückwärts: Vorgänger orientieren sich an Nachfolgern
    for (let row = maxRow - 1; row >= 0; row--) {
      const rowTasks = byRow[row];
      if (!rowTasks.length) continue;
      const sorted = rowTasks.map((t) => {
        const succs = (successorsByTask.get(t.id) ?? []).filter((id) => placedIds.has(id));
        return {
          t,
          bary: succs.length
            ? succs.reduce((s, id) => s + (colByTask.get(id) ?? 0), 0) / succs.length
            : colByTask.get(t.id) ?? 0,
        };
      }).sort((a, b) => a.bary - b.bary);
      sorted.forEach(({ t }, i) => { colByTask.set(t.id, i); byRow[row][i] = t; });
      swapReduce(row, byRow, colByTask, placedIds, maxRow);
    }
  }

  // ── SCHRITT 4: Pixel-Koordinaten (linksbündig) ────────────────────────────
  const maxCols = Math.max(...byRow.map((r) => r.length), 1);
  const totalWidth = PAD_X * 2 + maxCols * NODE_W + (maxCols - 1) * COL_GAP;
  const positioned: Positioned[] = [];

  for (let row = 0; row <= maxRow; row++) {
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

  return {
    positioned,
    width: Math.max(totalWidth, 360),
    height: Math.max(PAD_Y * 2 + (maxRow + 1) * NODE_H + maxRow * ROW_GAP, 400),
  };
}

// ─── Deadline-Anzeige ─────────────────────────────────────────────────────────
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

// ─── Hauptkomponente ──────────────────────────────────────────────────────────
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

  // ── Scroll-Container ──────────────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = scrollContainerRef.current;
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
    const el = scrollContainerRef.current;
    if (!el) return;
    setScrollX(el.scrollLeft);
    onScrollInfo?.({ scrollX: el.scrollLeft, containerWidth: el.clientWidth, contentWidth: width });
  }, [width, onScrollInfo]);

  // ── Scrollbar-Thumb ───────────────────────────────────────────────────────
  const scrollbarVisible = width > containerWidth;
  const thumbWidth = scrollbarVisible ? Math.max(40, (containerWidth / width) * containerWidth) : containerWidth;
  const thumbLeft = scrollbarVisible ? (scrollX / (width - containerWidth)) * (containerWidth - thumbWidth) : 0;
  const thumbDragRef = useRef<{ startX: number; startScrollX: number } | null>(null);

  const onThumbPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    thumbDragRef.current = { startX: e.clientX, startScrollX: scrollContainerRef.current?.scrollLeft ?? 0 };
  };
  const onThumbPointerMove = (e: React.PointerEvent) => {
    if (!thumbDragRef.current) return;
    const dx = e.clientX - thumbDragRef.current.startX;
    const ratio = (width - containerWidth) / (containerWidth - thumbWidth);
    if (scrollContainerRef.current)
      scrollContainerRef.current.scrollLeft = thumbDragRef.current.startScrollX + dx * ratio;
  };
  const onThumbPointerUp = () => { thumbDragRef.current = null; };

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
      const dx = ev.clientX - s.startClientX;
      const dy = ev.clientY - s.startClientY;
      if (!s.activated) {
        if (!s.longPressReady) return;
        if (dx * dx + dy * dy < 64) return;
        s.activated = true; s.suppressClick = true;
      }
      const rect = scrollContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setNodeDrag({
        taskId: s.taskId,
        cx: ev.clientX - rect.left + (scrollContainerRef.current?.scrollLeft ?? 0),
        cy: ev.clientY - rect.top + (scrollContainerRef.current?.scrollTop ?? 0),
      });
    };
    const onUp = () => {
      if (s.longPressTimer) window.clearTimeout(s.longPressTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      nodeDragInit.current = null;
      setNodeDrag(null);
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
      {/* Canvas – vertikal scrollbar per normalem Touch, horizontal per Scrollbar */}
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className="flex-1 overflow-x-auto overflow-y-auto"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div style={{ width, height, position: "relative", flexShrink: 0 }}>
          {/* SVG-Pfeile */}
          <svg width={width} height={height} className="absolute inset-0 pointer-events-none">
            <defs>
              <marker id="arrow-main" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0,1 L9,5 L0,9 z" fill="#a78bfa" />
              </marker>
              <marker id="arrow-cross" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0,1 L9,5 L0,9 z" fill="#6366f1" />
              </marker>
              {users.map((u) => {
                const c = ownerStyle(u).main;
                return (
                  <linearGradient key={u.id} id={`done-grad-${u.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.1} />
                  </linearGradient>
                );
              })}
            </defs>

            {positioned.flatMap((p) =>
              p.task.dependsOn.map((dep) => {
                const from = posById.get(dep.id);
                if (!from) return null;
                const x1 = from.x + NODE_W / 2;
                const y1 = from.y + NODE_H;
                const x2 = p.x + NODE_W / 2;
                const y2 = p.y;
                const midY = (y1 + y2) / 2;
                const depDone = dep.status === "done";
                const crossRow = Math.abs(from.row - p.row) > 1;
                return (
                  <path
                    key={`${dep.id}-${p.task.id}`}
                    d={`M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`}
                    stroke={depDone ? `url(#done-grad-${from.task.owner_id ?? ""})` : crossRow ? "#6366f1" : "#a78bfa"}
                    strokeWidth={depDone ? 1.5 : 2}
                    fill="none"
                    strokeDasharray={depDone ? "4 4" : crossRow ? "3 5" : undefined}
                    markerEnd={depDone ? undefined : crossRow ? "url(#arrow-cross)" : "url(#arrow-main)"}
                  />
                );
              }),
            )}
          </svg>

          {/* Task-Nodes */}
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
                  border: `${done ? 1 : 1.5}px ${blocked || ghost ? "dashed" : "solid"} ${
                    ghost ? withAlpha(style.main, 0.4) : done ? withAlpha(style.main, 0.25) : style.main
                  }`,
                  opacity: isDragging ? 0.2 : ghost ? 0.3 : done ? 0.4 : 1,
                  boxShadow,
                  cursor: ghost ? "default" : connectMode ? "crosshair" : "pointer",
                  touchAction: "none",
                }}
              >
                {area && (
                  <span
                    className="absolute -top-[10px] right-2 rounded-sm px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide"
                    style={{
                      color: style.accent,
                      background: withAlpha(style.main, 0.18),
                      border: `1px solid ${withAlpha(style.main, 0.3)}`,
                    }}
                  >
                    {area.name}
                  </span>
                )}
                <div className="flex h-full flex-col justify-between p-2">
                  {done ? (
                    <p className="text-[11px] font-semibold leading-tight line-clamp-3 line-through text-muted-foreground">
                      {p.task.title}
                    </p>
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

          {/* Drag-Ghost */}
          {nodeDrag && (() => {
            const p = posById.get(nodeDrag.taskId);
            if (!p) return null;
            const owner = users.find((u) => u.id === p.task.owner_id);
            const st = ownerStyle(owner);
            return (
              <div className="absolute pointer-events-none cut-corner"
                style={{
                  left: nodeDrag.cx - NODE_W / 2, top: nodeDrag.cy - NODE_H / 2,
                  width: NODE_W, height: NODE_H, background: st.bg,
                  border: `1.5px solid ${st.main}`, opacity: 0.55,
                  boxShadow: `0 12px 32px ${withAlpha(st.main, 0.45)}`, zIndex: 50,
                }}
              >
                <div className="flex h-full items-start p-2">
                  <p className="text-[12px] font-semibold leading-tight line-clamp-2 text-foreground">{p.task.title}</p>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Horizontale Scrollbar – immer sichtbar wenn nötig */}
      {scrollbarVisible && (
        <div className="relative mx-4 my-2 rounded-full flex-shrink-0"
          style={{ height: 4, background: "rgba(167,139,250,0.12)" }}>
          <div
            className="absolute top-0 rounded-full cursor-grab active:cursor-grabbing"
            style={{ left: thumbLeft, width: thumbWidth, height: 4, background: "rgba(167,139,250,0.55)", touchAction: "none" }}
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerUp}
            onPointerCancel={onThumbPointerUp}
          />
        </div>
      )}
    </div>
  );
}
