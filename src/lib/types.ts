export type Priority = "hoch" | "mittel" | "niedrig";
export type TaskStatus = "open" | "active" | "blocked" | "done";

export interface User {
  id: string;
  name: string;
  role: string | null;
  color: string;
  initials: string;
}

export interface Area {
  id: string;
  name: string;
  sort_order: number;
}

export interface FloorConfig {
  id: string;
  name: string;
  rooms: { type: string; count: number }[];
}

export interface Project {
  id: string;
  name: string;
  customer_id: string | null;
  customer: string | null;
  address: string | null;
  status: string | null;
  template_type: string | null;
  floors: FloorConfig[];
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  area_id: string | null;
  project_id: string | null;
  owner_id: string | null;
  priority: Priority;
  deadline: string | null;
  no_deadline: boolean;
  status: TaskStatus;
  done_at: string | null;
  estimated_minutes: number | null;
  tools_needed: string | null;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
}

export interface Dependency {
  id: string;
  task_id: string;       // wartet auf
  depends_on_id: string; // Vorgänger
}

export interface DerivedTask extends Task {
  dependsOn: Task[];
  blocks: Task[];
  isBlocked: boolean;
  effectiveStatus: TaskStatus;
  topoRank: number;
}
