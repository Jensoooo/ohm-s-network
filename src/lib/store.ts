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
  // filters
  filterAreaId: string | "all";
  filterOwnerId: string | "all";
  // sheet state (single source of truth)
  detailTaskId: string | null;
  editingTaskId: string | null | "new";

  load: () => Promise<void>;
  setCurrentUser: (id: string) => void;
  setFilterArea: (id: string | "all") => void;
  setFilterOwner: (id: string | "all") => void;
  openDetail: (id: string | null) => void;
  openEdit: (id: string | null | "new") => void;

  createTask: (input: Partial<Task> & { title: string; area_id: string; owner_id: string; priority: Priority; deadline: string | null; no_deadline: boolean }, deps: string[]) => Promise<void>;
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
  filterAreaId: "all",
  filterOwnerId: "all",
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
  setFilterArea: (id) => set({ filterAreaId: id }),
  setFilterOwner: (id) => set({ filterOwnerId: id }),
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

// ---------- Derived selectors (single source of truth) ----------

export function deriveTasks(
  tasks: Task[],
  dependencies: Dependency[],
): DerivedTask[] {
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
  return tasks.map((t) => {
    const dependsOn = dependsMap.get(t.id) ?? [];
    const blocks = blocksMap.get(t.id) ?? [];
    const isBlocked = t.status !== "done" && dependsOn.some((d) => d.status !== "done");
    const effectiveStatus: TaskStatus =
      t.status === "done" ? "done" : isBlocked ? "blocked" : t.status;
    return { ...t, dependsOn, blocks, isBlocked, effectiveStatus };
  });
}

const priorityRank: Record<Priority, number> = { hoch: 0, mittel: 1, niedrig: 2 };

export function sortAsap(a: DerivedTask, b: DerivedTask): number {
  // done at bottom
  if (a.effectiveStatus === "done" && b.effectiveStatus !== "done") return 1;
  if (b.effectiveStatus === "done" && a.effectiveStatus !== "done") return -1;
  // blocked after non-blocked
  if (a.isBlocked !== b.isBlocked) return a.isBlocked ? 1 : -1;
  // priority
  if (a.priority !== b.priority) return priorityRank[a.priority] - priorityRank[b.priority];
  // deadline soonest first; no_deadline last
  if (a.no_deadline !== b.no_deadline) return a.no_deadline ? 1 : -1;
  if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
  return 0;
}
