import { createFileRoute } from "@tanstack/react-router";
import { Timer } from "lucide-react";

export const Route = createFileRoute("/timer")({
  component: TimerPage,
});

function TimerPage() {
  return (
    <div className="mx-auto flex min-h-[80dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-3xl gradient-brand shadow-[0_16px_48px_-16px_#7c3aed]">
        <Timer className="h-10 w-10 text-white" />
      </span>
      <h1 className="mt-6 text-2xl font-extrabold tracking-tight text-gradient">Timer</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Zeiterfassung pro Aufgabe kommt in einer der nächsten Versionen.
      </p>
    </div>
  );
}
