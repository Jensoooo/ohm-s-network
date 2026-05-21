import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { Priority } from "@/lib/types";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { toast } from "sonner";

const priorities: Priority[] = ["hoch", "mittel", "niedrig"];

export function TaskFormSheet() {
  const editingTaskId = useStore((s) => s.editingTaskId);
  const open = editingTaskId !== null;
  const openEdit = useStore((s) => s.openEdit);
  const tasks = useStore((s) => s.tasks);
  const deps = useStore((s) => s.dependencies);
  const users = useStore((s) => s.users);
  const areas = useStore((s) => s.areas);
  const projects = useStore((s) => s.projects);
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);

  const existing = editingTaskId && editingTaskId !== "new"
    ? tasks.find((t) => t.id === editingTaskId) ?? null
    : null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("mittel");
  const [ownerId, setOwnerId] = useState<string>("");
  const [areaId, setAreaId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [noDeadline, setNoDeadline] = useState(false);
  const [deadline, setDeadline] = useState<string>("");
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);


  useEffect(() => {
    if (!open) return;
    if (existing) {
      setTitle(existing.title);
      setDescription(existing.description ?? "");
      setPriority(existing.priority);
      setOwnerId(existing.owner_id ?? "");
      setAreaId(existing.area_id ?? "");
      setProjectId(existing.project_id ?? "");
      setNoDeadline(existing.no_deadline);
      setDeadline(existing.deadline ? existing.deadline.slice(0, 10) : "");
      setSelectedDeps(deps.filter((d) => d.task_id === existing.id).map((d) => d.depends_on_id));
    } else {
      setTitle(""); setDescription(""); setPriority("mittel");
      setOwnerId(users[0]?.id ?? ""); setAreaId(areas[0]?.id ?? "");
      setProjectId("");
      setNoDeadline(false); setDeadline(""); setSelectedDeps([]);
    }
  }, [open, existing, users, areas, deps]);


  const candidateDeps = useMemo(
    () => tasks.filter((t) => !existing || t.id !== existing.id),
    [tasks, existing],
  );

  const handleSave = async () => {
    if (!title.trim()) return toast.error("Titel fehlt");
    if (!areaId) return toast.error("Bereich fehlt");
    if (!ownerId) return toast.error("Zuständiger fehlt");
    if (!noDeadline && !deadline) return toast.error('Frist oder "keine Frist" wählen');
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      owner_id: ownerId,
      area_id: areaId,
      deadline: noDeadline ? null : new Date(deadline).toISOString(),
      no_deadline: noDeadline,
    };
    if (existing) {
      await updateTask(existing.id, payload, selectedDeps);
      toast.success("Gespeichert");
    } else {
      await createTask(payload as any, selectedDeps);
      toast.success("Aufgabe erstellt");
    }
    openEdit(null);
  };

  const handleDelete = async () => {
    if (!existing) return;
    if (!confirm("Aufgabe löschen?")) return;
    await deleteTask(existing.id);
    toast.success("Gelöscht");
    openEdit(null);
  };

  return (
    <Drawer open={open} onOpenChange={(v) => !v && openEdit(null)}>
      <DrawerContent className="bg-surface border-border max-h-[92vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-foreground">
            {existing ? "Aufgabe bearbeiten" : "Neue Aufgabe"}
          </DrawerTitle>
        </DrawerHeader>
        <div className="space-y-4 overflow-y-auto px-4 pb-6">
          <div>
            <Label>Titel *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Kabel verlegen" className="bg-card-raw border-border" />
          </div>
          <div>
            <Label>Beschreibung</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="bg-card-raw border-border" />
          </div>
          <div>
            <Label>Priorität *</Label>
            <div className="mt-1 flex gap-2">
              {priorities.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={
                    "flex-1 rounded-full border px-3 py-2 text-sm capitalize transition " +
                    (priority === p ? "gradient-brand text-white border-transparent" : "border-border bg-card-raw text-muted-foreground")
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Bereich *</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {areas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAreaId(a.id)}
                  className={
                    "rounded-full border px-3 py-1.5 text-sm transition " +
                    (areaId === a.id ? "border-primary bg-primary/20 text-foreground" : "border-border bg-card-raw text-muted-foreground")
                  }
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Zuständig *</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setOwnerId(u.id)}
                  className={
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition " +
                    (ownerId === u.id ? "border-transparent text-white" : "border-border bg-card-raw text-muted-foreground")
                  }
                  style={ownerId === u.id ? { background: u.color } : undefined}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: u.color }}>{u.initials}</span>
                  {u.name}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="nd">Keine Frist</Label>
            <Switch id="nd" checked={noDeadline} onCheckedChange={setNoDeadline} />
          </div>
          {!noDeadline && (
            <div>
              <Label>Frist *</Label>
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="bg-card-raw border-border" />
            </div>
          )}
          <div>
            <Label>Wartet auf (Vorgänger)</Label>
            <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-border bg-card-raw">
              {candidateDeps.length === 0 && <p className="p-3 text-sm text-muted-foreground">Keine anderen Aufgaben.</p>}
              {candidateDeps.map((t) => {
                const checked = selectedDeps.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setSelectedDeps((prev) =>
                        prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                      )
                    }
                    className="flex w-full items-center justify-between border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0"
                  >
                    <span className="truncate text-foreground">{t.title}</span>
                    <span
                      className={
                        "ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border " +
                        (checked ? "gradient-brand border-transparent text-white" : "border-border")
                      }
                    >
                      {checked && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            {existing && (
              <Button variant="destructive" onClick={handleDelete} className="rounded-full">Löschen</Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => openEdit(null)} className="rounded-full">Abbrechen</Button>
            <Button onClick={handleSave} className="gradient-brand rounded-full text-white hover:opacity-90">Speichern</Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
