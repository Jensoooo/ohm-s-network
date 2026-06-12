import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { NetworkCanvas } from "@/components/NetworkCanvas";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { ownerStyle } from "@/lib/colors";
import { Plus, Link2, Unlink } from "lucide-react";

export const Route = createFileRoute("/netzplan")({
  component: NetzplanPage,
});

function NetzplanPage() {
  const openEdit = useStore((s) => s.openEdit);
  const areas = useStore((s) => s.areas);
  const users = useStore((s) => s.users);
  const projects = useStore((s) => s.projects);
  const filterAreaIds = useStore((s) => s.filterAreaIds);
  const filterOwnerIds = useStore((s) => s.filterOwnerIds);
  const filterProjectIds = useStore((s) => s.filterProjectIds);
  const toggleFilterArea = useStore((s) => s.toggleFilterArea);
  const toggleFilterOwner = useStore((s) => s.toggleFilterOwner);
  const toggleFilterProject = useStore((s) => s.toggleFilterProject);
  const clearFilterAreas = useStore((s) => s.clearFilterAreas);
  const clearFilterOwners = useStore((s) => s.clearFilterOwners);
  const clearFilterProjects = useStore((s) => s.clearFilterProjects);
  const toggleDependency = useStore((s) => s.toggleDependency);


  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const exitConnectMode = () => { setConnectMode(false); setConnectSource(null); };

  const handleConnectTap = async (taskId: string) => {
    if (!connectSource) {
      setConnectSource(taskId);
    } else if (connectSource === taskId) {
      setConnectSource(null);
    } else {
      await toggleDependency(connectSource, taskId);
      setConnectSource(null);
    }
  };

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center justify-between px-4 pt-6 pb-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-gradient">Netzplan</h1>
          <p className="text-xs text-muted-foreground">
            {connectMode
              ? connectSource
                ? "Zweiten Task antippen zum Verbinden"
                : "Ersten Task antippen"
              : "Ziehen zum Verschieben"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#c084fc]"
            />
            Erledigte
          </label>
          {connectMode && (
            <Button onClick={exitConnectMode} variant="outline" className="rounded-full border-border text-xs px-3 py-1.5 h-auto">
              Fertig
            </Button>
          )}
          <Button
            onClick={() => { setConnectMode((v) => !v); setConnectSource(null); }}
            size="icon"
            className={"h-11 w-11 rounded-full " + (connectMode ? "bg-[#14b8a6] text-white" : "gradient-brand text-white")}
          >
            {connectMode ? <Unlink className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}
          </Button>
          {!connectMode && (
            <Button onClick={() => openEdit("new")} size="icon" className="h-11 w-11 rounded-full gradient-brand text-white">
              <Plus className="h-5 w-5" />
            </Button>
          )}
        </div>
      </header>
      <div className="px-4 pb-2 space-y-2">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
          <Chip label="Alle" active={filterAreaIds.length === 0} onClick={clearFilterAreas} />
          {areas.map((a) => (
            <Chip key={a.id} label={a.name} active={filterAreaIds.includes(a.id)} onClick={() => toggleFilterArea(a.id)} />
          ))}
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
          <Chip label="Alle" active={filterOwnerIds.length === 0} onClick={clearFilterOwners} />
          {users.map((u) => {
            const st = ownerStyle(u);
            return (
              <Chip
                key={u.id}
                label={u.name}
                active={filterOwnerIds.includes(u.id)}
                onClick={() => toggleFilterOwner(u.id)}
                dotColor={st.main}
              />
            );
          })}
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
          <Chip label="Alle Baustellen" active={filterProjectIds.length === 0} onClick={clearFilterProjects} />
          {projects.map((p) => (
            <Chip key={p.id} label={p.name} active={filterProjectIds.includes(p.id)} onClick={() => toggleFilterProject(p.id)} />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <NetworkCanvas
          connectMode={connectMode}
          connectSource={connectSource}
          onConnectTap={handleConnectTap}
        />
      </div>
    </div>
  );
}


function Chip({ label, active, onClick, dotColor }: { label: string; active: boolean; onClick: () => void; dotColor?: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition " +
        (active
          ? "border-transparent gradient-brand text-white"
          : "border-border bg-card-raw text-muted-foreground")
      }
    >
      {dotColor && <span className="h-2 w-2 rounded-full" style={{ background: dotColor }} />}
      {label}
    </button>
  );
}
