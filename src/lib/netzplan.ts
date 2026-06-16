import type { DerivedTask } from "./types"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TaskWithGraph extends DerivedTask {
  upstream: Set<string>   // alle Task-IDs die diesen Task transitiv blockieren
  downstream: Set<string> // alle Task-IDs die dieser Task transitiv blockiert
  urgencyScore: number
  isMergeRef?: boolean        // Schritt 4: Task kommt in mehreren Ketten vor, Verlierer-Kette
  mergeIntoChainId?: string   // Schritt 4: ID der Gewinner-Kette
}

export interface NetzplanChain {
  id: string
  tasks: TaskWithGraph[]
  headScore: number // urgencyScore des ersten Tasks der Kette
}

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

// ── Schritt 4: Merge-Tasks auflösen ──────────────────────────────────────────

export function resolveMergeTasks(chains: NetzplanChain[]): NetzplanChain[] {
  const chainById = new Map(chains.map((c) => [c.id, c]))

  // task → alle Chain-IDs die ihn enthalten
  const taskToChainIds = new Map<string, Set<string>>()
  for (const chain of chains) {
    for (const task of chain.tasks) {
      if (!taskToChainIds.has(task.id)) taskToChainIds.set(task.id, new Set())
      taskToChainIds.get(task.id)!.add(chain.id)
    }
  }

  for (const [taskId, chainIdSet] of taskToChainIds) {
    if (chainIdSet.size < 2) continue

    // Re-check: welche Ketten enthalten diesen Task noch (manche wurden bereits truncated)
    const active = [...chainIdSet]
      .map((id) => chainById.get(id)!)
      .filter((c) => c.tasks.some((t) => t.id === taskId))

    if (active.length < 2) continue

    // Gewinner = höchster headScore (Gleichstand: erster gewinnt)
    const winner = active.reduce((best, c) => (c.headScore > best.headScore ? c : best))

    for (const loser of active) {
      if (loser.id === winner.id) continue
      const idx = loser.tasks.findIndex((t) => t.id === taskId)
      if (idx === -1) continue
      loser.tasks[idx].isMergeRef = true
      loser.tasks[idx].mergeIntoChainId = winner.id
      loser.tasks.splice(idx + 1)
    }
  }

  return chains
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
  chains: NetzplanChain[]
} {
  const taskMap = buildGraph(derivedTasks)   // Schritt 1
  computeUrgencyScores(taskMap)              // Schritt 2
  const chains = buildChains(taskMap)        // Schritt 3
  resolveMergeTasks(chains)                  // Schritt 4
  // Schritt 5: Sortierung ist bereits in buildChains() enthalten
  return { taskMap, chains }
}
