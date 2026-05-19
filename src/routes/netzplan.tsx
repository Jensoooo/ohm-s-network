import { createFileRoute } from "@tanstack/react-router";
import { NetworkCanvas } from "@/components/NetworkCanvas";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/netzplan")({
  component: NetzplanPage,
});

function NetzplanPage() {
  const openEdit = useStore((s) => s.openEdit);
  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center justify-between px-4 pt-6 pb-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-gradient">Netzplan</h1>
          <p className="text-xs text-muted-foreground">Ziehen zum Verschieben</p>
        </div>
        <Button onClick={() => openEdit("new")} size="icon" className="h-11 w-11 rounded-full gradient-brand text-white">
          <Plus className="h-5 w-5" />
        </Button>
      </header>
      <div className="flex-1 overflow-hidden">
        <NetworkCanvas />
      </div>
    </div>
  );
}
