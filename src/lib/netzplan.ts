import type { DerivedTask } from "./types"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TaskWithGraph extends DerivedTask {
  upstream: Set<string>
  downstream: Set<string>
  urgencyScore: number
}

export interface NetzplanChain {
  id: string
  tasks: TaskWithGraph[]
  headScore: number
}

// Einfache Kette ohne Merge
export interface SimpleNetzplanItem {
  type: 'simple'
  id: string
  tasks: TaskWithGraph[]
  headScore: number
}

// Ein Eingangspfad vor dem Merge-Punkt
export interface MergedNetzplanPath {
  tasks: TaskWithGraph[]
  headScore: number
}

// Zusammengeführte Kette: mehrere Pfade → ein gemeinsamer Schwanz
export interface MergedNetzplanItem {
  type: 'merged'
  id: string
  paths: MergedNetzplanPath[]   // sortiert desc nach headScore; höchster = oben
  sharedTail: TaskWithGraph[]   // Merge-Task + alle folgenden Tasks
  combinedScore: number         // Durchschnitt der path.headScores (für Sortierung)
}

export type NetzplanItem = SimpleNetzplanItem | MergedNetzplanItem

// ── Schritt 1: Transitiven Graphen aufbauen ───────────────────────────────────
// BFS statt Rekursion um Stack Overflow bei tiefen Graphen zu vermeiden

function buildTransitiveSet(
  startId: string,
  adjacency: Map<string, string[]>,
): Set<string> {
  const visited = new Set<string>()
  const queue: string[] = [...(adjacency.get(startId) ?? [])]
  while (queue.length > 0) {
    const curr = queue.shift()!
    if (visited.has(curr)) continue
    visited.add(curr)
    for (const next of adjacency.get(curr) ?? []) {
      if (!visited.has(next)) queue.push(next)
    }
  }
  return visited
}

export function buildGraph(derivedTasks: DerivedTask[]): Map<string, TaskWithGraph> {
  const directPreds = new Map<string, string[]>()
  const directSuccs = new Map<string, string[]>()

  for (const t of derivedTasks) {
    directPreds.set(t.id, t.dependsOn.map((d) => d.id))
    directSuccs.set(t.id, t.blocks.map((b) => b.id))
  }

  const result = new Map<string, TaskWithGraph>()
  for (const t of derivedTasks) {
    result.set(t.id, {
      ...t,
      upstream: buildTransitiveSet(t.id, directPreds),
      downstream: buildTransitiveSet(t.id, directSuccs),
      urgencyScore: 0,
    })
  }
  return result
}

// ── Schritt 2: Urgency Score ──────────────────────────────────────────────────

function daysUntilDue(deadline: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(deadline)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

function calcUrgencyScore(task: TaskWithGraph, taskMap: Map<string, TaskWithGraph>): number {
  // A – Eigenes Fälligkeitsdatum
  let A = 0
  if (task.deadline && !task.no_deadline) {
    const days = daysUntilDue(task.deadline)
    if (days < 0) A = 100
    else if (days === 0) A = 80
    else if (days <= 3) A = 60
    else if (days <= 7) A = 40
  }

  // B – Downstream-Gewicht (komplette Kette, alle Ebenen)
  let B = 0
  for (const downId of task.downstream) {
    B += 5
    const down = taskMap.get(downId)
    if (down?.deadline && !down.no_deadline) {
      B += 10
      if (daysUntilDue(down.deadline) < 0) B += 20
    }
  }

  // C – Manuelle Priorität
  let C = 0
  if (task.priority === "hoch") C = 15
  else if (task.priority === "mittel") C = 5

  return A + B + C
}

export function computeUrgencyScores(taskMap: Map<string, TaskWithGraph>): void {
  for (const task of taskMap.values()) {
    task.urgencyScore = calcUrgencyScore(task, taskMap)
  }
}

// ── Schritt 3: Ketten identifizieren ─────────────────────────────────────────

export function buildChains(taskMap: Map<string, TaskWithGraph>): NetzplanChain[] {
  // Wurzel-Tasks = niemand blockiert sie (upstream leer)
  const rootTasks = [...taskMap.values()].filter((t) => t.upstream.size === 0)

  const allChains: NetzplanChain[] = []
  let chainCounter = 0

  for (const root of rootTasks) {
    const traverse = (
      current: TaskWithGraph,
      currentChain: TaskWithGraph[],
      pathIds: Set<string>, // Zyklus-Erkennung
    ) => {
      if (pathIds.has(current.id)) {
        console.warn(
          `[Netzplan] Zyklus erkannt bei Task "${current.title}" (${current.id}) – Kette wird hier beendet`,
        )
        allChains.push({
          id: `chain-${chainCounter++}`,
          tasks: [...currentChain],
          headScore: currentChain[0]?.urgencyScore ?? 0,
        })
        return
      }

      const chain = [...currentChain, current]
      const newPath = new Set(pathIds)
      newPath.add(current.id)

      const successors = current.blocks
        .map((b) => taskMap.get(b.id))
        .filter((t): t is TaskWithGraph => t !== undefined)

      if (successors.length === 0) {
        // Blatt-Task → Kette endet hier
        allChains.push({
          id: `chain-${chainCounter++}`,
          tasks: chain,
          headScore: chain[0].urgencyScore,
        })
      } else {
        // Bei Verzweigung: jeder Ast wird eigene Kette
        for (const next of successors) {
          traverse(next, chain, newPath)
        }
      }
    }

    traverse(root, [], new Set())
  }

  // Vorab nach Score sortieren (Schritt 5 Vorgriff, für console.log sinnvoll)
  allChains.sort((a, b) => b.headScore - a.headScore)

  return allChains
}

// ── Schritt 4: Ketten zu NetzplanItems zusammenführen ────────────────────────
// Tasks die in mehreren Ketten vorkommen = Merge-Punkt.
// Alle betroffenen Ketten werden zu einem MergedNetzplanItem zusammengefasst:
// Eingangspfade gestapelt (höchster Score oben) → gemeinsamer Schwanz.

export function buildNetzplanItems(chains: NetzplanChain[]): NetzplanItem[] {
  if (chains.length === 0) return []

  const chainById = new Map(chains.map((c) => [c.id, c]))

  // task → IDs aller Ketten die diesen Task enthalten
  const taskToChainIds = new Map<string, Set<string>>()
  for (const chain of chains) {
    for (const task of chain.tasks) {
      if (!taskToChainIds.has(task.id)) taskToChainIds.set(task.id, new Set())
      taskToChainIds.get(task.id)!.add(chain.id)
    }
  }

  // IDs aller Tasks die in 2+ Ketten vorkommen (= Merge-Punkte)
  const mergeTaskIdSet = new Set<string>(
    [...taskToChainIds.entries()]
      .filter(([, s]) => s.size >= 2)
      .map(([id]) => id),
  )

  const processedChainIds = new Set<string>()
  const handledMergeTaskIds = new Set<string>()
  const items: NetzplanItem[] = []

  for (const chain of chains) {
    if (processedChainIds.has(chain.id)) continue

    // Ersten Merge-Task in dieser Kette suchen
    const firstMergeIdx = chain.tasks.findIndex((t) => mergeTaskIdSet.has(t.id))

    if (firstMergeIdx === -1) {
      items.push({ type: 'simple', id: chain.id, tasks: chain.tasks, headScore: chain.headScore })
      processedChainIds.add(chain.id)
      continue
    }

    const mergeTaskId = chain.tasks[firstMergeIdx].id

    if (handledMergeTaskIds.has(mergeTaskId)) {
      processedChainIds.add(chain.id)
      continue
    }

    // Alle Ketten dieser Merge-Gruppe zusammenholen
    const groupChainIds = [...(taskToChainIds.get(mergeTaskId) ?? new Set<string>())]
    const groupChains = groupChainIds
      .map((id) => chainById.get(id))
      .filter((c): c is NetzplanChain => c !== undefined)

    const paths: MergedNetzplanPath[] = []
    let sharedTail: TaskWithGraph[] = []

    for (const gc of groupChains) {
      const idx = gc.tasks.findIndex((t) => t.id === mergeTaskId)
      if (idx === -1) continue
      paths.push({ tasks: gc.tasks.slice(0, idx), headScore: gc.headScore })
      if (sharedTail.length === 0) sharedTail = gc.tasks.slice(idx)
      processedChainIds.add(gc.id)
    }

    handledMergeTaskIds.add(mergeTaskId)

    if (paths.length < 2) {
      items.push({ type: 'simple', id: chain.id, tasks: chain.tasks, headScore: chain.headScore })
      continue
    }

    // Höchster Score oben
    paths.sort((a, b) => b.headScore - a.headScore)

    const combinedScore = Math.round(paths.reduce((s, p) => s + p.headScore, 0) / paths.length)

    items.push({
      type: 'merged',
      id: `merged-${mergeTaskId}`,
      paths,
      sharedTail,
      combinedScore,
    })
  }

  // Nach Score sortieren
  items.sort((a, b) => {
    const sa = a.type === 'merged' ? a.combinedScore : a.headScore
    const sb = b.type === 'merged' ? b.combinedScore : b.headScore
    return sb - sa
  })

  return items
}

// ── Orchestrierung Schritte 1–3 (Debug-Export) ────────────────────────────────

export function runNetzplanSteps123(derivedTasks: DerivedTask[]): {
  taskMap: Map<string, TaskWithGraph>
  chains: NetzplanChain[]
} {
  const taskMap = buildGraph(derivedTasks)
  computeUrgencyScores(taskMap)
  const chains = buildChains(taskMap)
  return { taskMap, chains }
}

// ── Vollständiger Algorithmus Schritte 1–5 ────────────────────────────────────

export function runNetzplanAlgorithm(derivedTasks: DerivedTask[]): {
  taskMap: Map<string, TaskWithGraph>
  items: NetzplanItem[]
} {
  const taskMap = buildGraph(derivedTasks)
  computeUrgencyScores(taskMap)
  const chains = buildChains(taskMap)
  const items = buildNetzplanItems(chains)
  return { taskMap, items }
}
