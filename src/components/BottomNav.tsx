import { Link } from "@tanstack/react-router";
import { ListChecks, Network, Timer, User } from "lucide-react";

const items = [
  { to: "/", label: "Aufgaben", icon: ListChecks },
  { to: "/netzplan", label: "Netzplan", icon: Network },
  { to: "/timer", label: "Timer", icon: Timer },
  { to: "/profil", label: "Profil", icon: User },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/95 backdrop-blur safe-bottom">
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-2">
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              className="flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium text-muted-foreground transition-colors data-[status=active]:text-foreground"
              activeProps={{ className: "text-foreground" }}
              activeOptions={{ exact: true }}
            >
              {({ isActive }) => (
                <>
                  <span
                    className={
                      "flex h-9 w-9 items-center justify-center rounded-full transition-all " +
                      (isActive ? "gradient-brand text-white shadow-[0_8px_24px_-8px_#7c3aed]" : "bg-transparent")
                    }
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>{label}</span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
