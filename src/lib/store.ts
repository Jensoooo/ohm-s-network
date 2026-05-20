import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import type { Task, User, Area, Project, Dependency, DerivedTask, TaskStatus, Priority } from "./types";

interface StoreState {
  tasks: Task[];
  users: User[];
  areas: Area[];
  projects: Project[];
  dependencies: Dependency[];
  currentUserId: string | null;
  loaded: boolean;
  // multi-select filters (empty array = all)
  filterAreaIds: string[];
  filterOwnerIds: string[];
  // sheet state
  detailTaskId: string | null;
  editingTaskId: string | null | "new";

  load: () => Promise<void>;
  setCurrentUser: (id: string) => void;
  toggleFilterArea: (id: string) => void;
  toggleFilterOwner: (id: string) => void;
  clearFilterAreas: () => void;
  clearFilterOwners: () => void;
  openDetail: (id: string | null) => void;
  openEdit: (id: string | null | "new") => void;

  createTask: (input: Partial<Task> & { title: string; area_id: string; owner_id: string; priority: Priority; deadline: string | null; no_deadline: boolean }, deps: string[]) => Promise<void>;
  toggleDependency: (predecessorId: string, successorId: string) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>, deps?: string[]) => Promise<void>;
  setStatus: (id: string, status: TaskStatus) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
}

export const useStore = create<StoreState>((set, get) => ({
  tasks: [],
  users: [],
  areas: [],
  projects: [],
  dependencies: [],
  currentUserId: null,
  loaded: false,
  filterAreaIds: [],
  filterOwnerIds: [],
  detailTaskId: null,
  editingTaskId: null,

  load: async () => {
    const [t, u, a, p, d] = await Promise.all([
      supabase.from("tasks").select("*").order("created_at", { ascending: false }),
      supabase.from("users").select("*").order("name"),
      supabase.from("areas").select("*").order("sort_order"),
      supabase.from("projects").select("*").order("name"),
      supabase.from("task_dependencies").select("*"),
    ]);
    set({
      tasks: (t.data ?? []) as Task[],
      users: (u.data ?? []) as User[],
      areas: (a.data ?? []) as Area[],
      projects: (p.data ?? []) as Project[],
      dependencies: (d.data ?? []) as Dependency[],
      loaded: true,
      currentUserId: get().currentUserId ?? (u.data?.[0]?.id ?? null),
    });
  },

  setCurrentUser: (id) => set({ currentUserId: id }),
  toggleFilterArea: (id) =>
    set((s) => ({
      filterAreaIds: s.filterAreaIds.includes(id)
        ? s.filterAreaIds.filter((x) => x !== id)
        : [...s.filterAreaIds, id],
    })),
  toggleFilterOwner: (id) =>
    set((s) => ({
      filterOwnerIds: s.filterOwnerIds.includes(id)
        ? s.filterOwnerIds.filter((x) => x !== id)
        : [...s.filterOwnerIds, id],
    })),
  clearFilterAreas: () => set({ filterAreaIds: [] }),
  clearFilterOwners: () => set({ filterOwnerIds: [] }),
  openDetail: (id) => set({ detailTaskId: id }),
  openEdit: (id) => set({ editingTaskId: id }),

  createTask: async (input, deps) => {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: input.title,
        description: input.description ?? null,
        area_id: input.area_id,
        owner_id: input.owner_id,
        priority: input.priority,
        deadline: input.no_deadline ? null : input.deadline,
        no_deadline: input.no_deadline,
        status: "open",
      })
      .select()
      .single();
    if (error || !data) return;
    if (deps.length > 0) {
      await supabase.from("task_dependencies").insert(
        deps.map((dep) => ({ task_id: data.id, depends_on_id: dep })),
      );
    }
    await get().load();
  },

  updateTask: async (id, patch, deps) => {
    await supabase.from("tasks").update(patch).eq("id", id);
    if (deps) {
      await supabase.from("task_dependencies").delete().eq("task_id", id);
      if (deps.length) {
        await supabase.from("task_dependencies").insert(deps.map((dep) => ({ task_id: id, depends_on_id: dep })));
      }
    }
    await get().load();
  },

  setStatus: async (id, status) => {
    await supabase
      .from("tasks")
      .update({ status, done_at: status === "done" ? new Date().toISOString() : null })
      .eq("id", id);
    await get().load();
  },

  deleteTask: async (id) => {
    await supabase.from("tasks").delete().eq("id", id);
    await get().load();
  },
}));

// ---------- Derived ----------

export function deriveTasks(tasks: Task[], dependencies: Dependency[]): DerivedTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dependsMap = new Map<string, Task[]>();
  const blocksMap = new Map<string, Task[]>();
  for (const d of dependencies) {
    const waiter = byId.get(d.task_id);
    const blocker = byId.get(d.depends_on_id);
    if (!waiter || !blocker) continue;
    if (!dependsMap.has(d.task_id)) dependsMap.set(d.task_id, []);
    dependsMap.get(d.task_id)!.push(blocker);
    if (!blocksMap.has(d.depends_on_id)) blocksMap.set(d.depends_on_id, []);
    blocksMap.get(d.depends_on_id)!.push(waiter);
  }

  // Topological rank: depth of longest dep chain
  const rank = new Map<string, number>();
  const compute = (id: string, stack: Set<string>): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const deps = dependsMap.get(id) ?? [];
    const r = deps.length ? Math.max(...deps.map((d) => compute(d.id, stack))) + 1 : 0;
    stack.delete(id);
    rank.set(id, r);
    return r;
  };
  for (const t of tasks) compute(t.id, new Set());

  return tasks.map((t) => {
    const dependsOn = dependsMap.get(t.id) ?? [];
    const blocks = blocksMap.get(t.id) ?? [];
    const isBlocked = t.status !== "done" && dependsOn.some((d) => d.status !== "done");
    const effectiveStatus: TaskStatus =
      t.status === "done" ? "done" : isBlocked ? "blocked" : t.status;
    return { ...t, dependsOn, blocks, isBlocked, effectiveStatus, topoRank: rank.get(t.id) ?? 0 };
  });
}

const priorityRank: Record<Priority, number> = { hoch: 0, mittel: 1, niedrig: 2 };

export function sortAsap(a: DerivedTask, b: DerivedTask): number {
  // done at bottom
  if (a.effectiveStatus === "done" && b.effectiveStatus !== "done") return 1;
  if (b.effectiveStatus === "done" && a.effectiveStatus !== "done") return -1;
  // unblocked before blocked
  if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1;
  // topological: predecessors before successors
  if (a.topoRank !== b.topoRank) return a.topoRank - b.topoRank;
  // priority
  if (a.priority !== b.priority) return priorityRank[a.priority] - priorityRank[b.priority];
  // deadline soonest first; no_deadline last
  if (a.no_deadline !== b.no_deadline) return a.no_deadline ? 1 : -1;
  if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
  return 0;
}
