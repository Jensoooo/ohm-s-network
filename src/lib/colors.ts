import type { User } from "./types";

export interface OwnerStyle {
  main: string;
  bg: string;
  accent: string;
}

const FALLBACK: OwnerStyle = {
  main: "#7c3aed",
  bg: "rgba(124,58,237,0.13)",
  accent: "#c084fc",
};

const BY_NAME: Record<string, OwnerStyle> = {
  // Ben: grün-türkis
  Ben: { main: "#10b981", bg: "rgba(16,185,129,0.13)", accent: "#34d399" },
  // Jens: blau-türkis
  Jens: { main: "#06b6d4", bg: "rgba(6,182,212,0.13)", accent: "#22d3ee" },
  // Stefan: dunkles beige
  Stefan: { main: "#a8895c", bg: "rgba(168,137,92,0.14)", accent: "#d4b896" },
  // Beide: lila (Firmenfarbe)
  Beide: { main: "#9333ea", bg: "rgba(147,51,234,0.13)", accent: "#c084fc" },
  Extern: { main: "#f59e0b", bg: "rgba(245,158,11,0.13)", accent: "#fcd34d" },
};

export function ownerStyle(user?: User | null): OwnerStyle {
  if (!user) return FALLBACK;
  return BY_NAME[user.name] ?? FALLBACK;
}

export const PRIORITY_DOT: Record<string, string> = {
  hoch: "#ef4444",
  mittel: "#f59e0b",
  niedrig: "#22c55e",
};

// rgba helper from #rrggbb + alpha
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
