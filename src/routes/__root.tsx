import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { BottomNav } from "@/components/BottomNav";
import { TaskDetailSheet } from "@/components/TaskDetailSheet";
import { TaskFormSheet } from "@/components/TaskFormSheet";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4 text-center">
      <div>
        <h1 className="text-6xl font-bold text-gradient">404</h1>
        <p className="mt-2 text-muted-foreground">Seite nicht gefunden</p>
        <Link to="/" className="mt-4 inline-block rounded-full gradient-brand px-5 py-2 text-sm font-semibold text-white">Zur App</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  console.error(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Etwas ist schiefgelaufen</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-4 rounded-full gradient-brand px-5 py-2 text-sm font-semibold text-white"
        >
          Neu laden
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#08011a" },
      { title: "OHMERA — Elektriker-Aufgaben" },
      { name: "description", content: "Aufgaben-Management mit Abhängigkeiten und Netzplan für Elektrikerbetriebe." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const load = useStore((s) => s.load);
  const loaded = useStore((s) => s.loaded);
  useEffect(() => { if (!loaded) void load(); }, [load, loaded]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-app pb-24">
        <Outlet />
      </div>
      <BottomNav />
      <TaskDetailSheet />
      <TaskFormSheet />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
