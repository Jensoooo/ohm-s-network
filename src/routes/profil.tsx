import { createFileRoute } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { useDerivedTasks } from "@/components/TaskCard";
import { Check } from "lucide-react";

export const Route = createFileRoute("/profil")({
  component: ProfilPage,
});

function ProfilPage() {
  const users = useStore((s) => s.users);
  const currentUserId = useStore((s) => s.currentUserId);
  const setCurrentUser = useStore((s) => s.setCurrentUser);
  const derived = useDerivedTasks();

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-gradient">Profil</h1>
        <p className="mt-1 text-xs text-muted-foreground">Mitarbeiter wechseln</p>
      </header>

      <ul className="space-y-2">
        {users.map((u) => {
          const userTasks = derived.filter((t) => t.owner_id === u.id);
          const open = userTasks.filter((t) => t.effectiveStatus !== "done").length;
          const done = userTasks.filter((t) => t.effectiveStatus === "done").length;
          const blocked = userTasks.filter((t) => t.isBlocked).length;
          const active = currentUserId === u.id;
          return (
            <li key={u.id}>
              <button
                onClick={() => setCurrentUser(u.id)}
                className={
                  "cut-corner flex w-full items-center gap-3 bg-card-raw p-4 text-left transition " +
                  (active ? "ring-2 ring-primary" : "")
                }
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: u.color }}>
                  {u.initials}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground">{u.name}</p>
                    {active && <Check className="h-4 w-4 text-[var(--teal)]" />}
                  </div>
                  <p className="text-xs text-muted-foreground">{u.role ?? "Mitarbeiter"}</p>
                  <div className="mt-2 flex gap-4 text-xs">
                    <span className="text-foreground">{open} offen</span>
                    <span className="text-[var(--teal)]">{done} fertig</span>
                    <span className="text-[var(--amber)]">{blocked} blockiert</span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
