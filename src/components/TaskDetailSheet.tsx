import { useStore, deriveTasks } from "@/lib/store";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Pencil, Lock, ArrowRight, ArrowLeft, CheckCircle2, Play, RotateCcw, Calendar, Flag } from "lucide-react";
import { ownerStyle, PRIORITY_DOT, withAlpha } from "@/lib/colors";

function formatDeadlineLong(task: { no_deadline: boolean; deadline: string | null }):
  | { text: string; sub: string; color: string }
  | null {
  if (task.no_deadline) return { text: "Keine Frist", sub: "", color: "#94a3b8" };
  if (!task.deadline) return null;
  const d = new Date(task.deadline);
  const now = new Date();
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
  const base = d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long", year: "numeric" });
  let sub = "";
  let color = "#60a5fa";
  if (diff < 0) { sub = `überfällig · ${-diff}d`; color = "#ef4444"; }
  else if (diff === 0) { sub = "heute"; color = "#f59e0b"; }
  else if (diff === 1) { sub = "morgen"; color = "#f59e0b"; }
  else if (diff <= 3) { sub = `in ${diff} Tagen`; color = "#f59e0b"; }
  else sub = `in ${diff} Tagen`;
  return { text: base, sub, color };
}

export function TaskDetailSheet() {
  const detailTaskId = useStore((s) => s.detailTaskId);
  const open = detailTaskId !== null;
  const openDetail = useStore((s) => s.openDetail);
  const openEdit = useStore((s) => s.openEdit);
  const tasks = useStore((s) => s.tasks);
  const deps = useStore((s) => s.dependencies);
  const users = useStore((s) => s.users);
  const areas = useStore((s) => s.areas);
  const setStatus = useStore((s) => s.setStatus);

  const derived = deriveTasks(tasks, deps);
  const task = detailTaskId ? derived.find((t) => t.id === detailTaskId) ?? null : null;
  const owner = users.find((u) => u.id === task?.owner_id);
  const area = areas.find((a) => a.id === task?.area_id);
  const style = ownerStyle(owner);
  const deadlineInfo = task ? formatDeadlineLong(task) : null;

  return (
    <Drawer open={open} onOpenChange={(v) => !v && openDetail(null)}>
      <DrawerContent className="bg-surface border-border max-h-[92vh]">
        {task && (
          <>
            <DrawerHeader className="text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-[10px] w-[10px] shrink-0 rounded-full"
                      style={{ background: PRIORITY_DOT[task.priority] }}
                    />
                    <DrawerTitle className="text-foreground">{task.title}</DrawerTitle>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {area && <span className="rounded-full bg-card-raw px-2 py-0.5">{area.name}</span>}
                    {owner && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                        style={{ background: style.bg, color: style.accent }}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: style.main }} />
                        {owner.name}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-card-raw px-2 py-0.5 capitalize">
                      <Flag className="h-3 w-3" style={{ color: PRIORITY_DOT[task.priority] }} />
                      {task.priority}
                    </span>
                    {task.isBlocked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--amber)]/15 px-2 py-0.5 text-[var(--amber)]">
                        <Lock className="h-3 w-3" /> blockiert
                      </span>
                    )}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => openEdit(task.id)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            </DrawerHeader>
            <div className="space-y-5 overflow-y-auto px-4 pb-6">
              {deadlineInfo && (
                <div
                  className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                  style={{
                    background: withAlpha(deadlineInfo.color, 0.08),
                    borderColor: withAlpha(deadlineInfo.color, 0.35),
                  }}
                >
                  <Calendar className="h-5 w-5 shrink-0" style={{ color: deadlineInfo.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Frist</div>
                    <div className="text-sm font-semibold text-foreground">{deadlineInfo.text}</div>
                  </div>
                  {deadlineInfo.sub && (
                    <span
                      className="rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{ background: withAlpha(deadlineInfo.color, 0.18), color: deadlineInfo.color }}
                    >
                      {deadlineInfo.sub}
                    </span>
                  )}
                </div>
              )}

              <section>
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Beschreibung
                </h4>
                {task.description ? (
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap">{task.description}</p>
                ) : (
                  <p className="text-sm text-muted-foreground/60 italic">Keine Beschreibung</p>
                )}
              </section>

              <section>
                <h4 className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <ArrowLeft className="h-3 w-3" /> Wartet auf
                </h4>
                {task.dependsOn.length === 0 ? (
                  <p className="text-sm text-muted-foreground/70">—</p>
                ) : (
                  <ul className="space-y-1.5">
                    {task.dependsOn.map((d) => (
                      <li key={d.id}>
                        <button
                          onClick={() => openDetail(d.id)}
                          className="flex w-full items-center justify-between rounded-xl bg-card-raw px-3 py-2 text-left text-sm"
                        >
                          <span className="truncate">{d.title}</span>
                          <span className={"ml-2 text-xs " + (d.status === "done" ? "text-[var(--teal)]" : "text-[var(--amber)]")}>
                            {d.status === "done" ? "✓ fertig" : "offen"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <ArrowRight className="h-3 w-3" /> Blockt
                </h4>
                {task.blocks.length === 0 ? (
                  <p className="text-sm text-muted-foreground/70">—</p>
                ) : (
                  <ul className="space-y-1.5">
                    {task.blocks.map((d) => (
                      <li key={d.id}>
                        <button
                          onClick={() => openDetail(d.id)}
                          className="flex w-full items-center justify-between rounded-xl bg-card-raw px-3 py-2 text-left text-sm"
                        >
                          <span className="truncate">{d.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex flex-wrap gap-2 pt-2">
                {task.status !== "done" ? (
                  <>
                    {task.status !== "active" && !task.isBlocked && (
                      <Button onClick={() => setStatus(task.id, "active")} className="gradient-brand rounded-full text-white">
                        <Play className="mr-1 h-4 w-4" /> Aktiv
                      </Button>
                    )}
                    <Button
                      onClick={() => setStatus(task.id, "done")}
                      disabled={task.isBlocked}
                      className="rounded-full bg-[var(--teal)] text-black hover:opacity-90"
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Erledigt
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setStatus(task.id, "open")} className="rounded-full">
                    <RotateCcw className="mr-1 h-4 w-4" /> Wieder öffnen
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
