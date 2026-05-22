import type { FloorConfig, Priority } from "./types";

export const PROJECT_TEMPLATES = [
  "Neubau Wohngebäude",
  "Renovierung / Umbau",
  "Zählerschrank / Unterverteilung",
  "Außenanlage",
  "Gewerbe / Büro",
  "Wartung & Prüfung",
  "Leere Baustelle",
] as const;

export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];

export const ROOM_TYPES = [
  "Wohnzimmer", "Schlafzimmer", "Küche", "Bad", "WC",
  "Flur", "Treppenhaus", "Keller", "Dachboden", "Garage", "Außenbereich",
] as const;

export const FLOOR_TEMPLATES = ["Neubau Wohngebäude", "Renovierung / Umbau"];

const GENERAL_TASK_DEFS: { title: string; depends_on: string[]; autoAssignRole?: string }[] = [
  { title: "Aufmaß vor Ort",         depends_on: [] },
  { title: "Angebot erstellen",       depends_on: ["Aufmaß vor Ort"] },
  { title: "Angebot freigeben lassen",depends_on: ["Angebot erstellen"] },
  { title: "Zählerschrank / UV planen", depends_on: ["Aufmaß vor Ort"] },
  { title: "Material kalkulieren",    depends_on: ["Angebot freigeben lassen"] },
  { title: "Material bestellen",      depends_on: ["Material kalkulieren"] },
  { title: "Abnahme durchführen",     depends_on: [], autoAssignRole: "Meister" },
  { title: "Prüfprotokoll erstellen", depends_on: ["Abnahme durchführen"], autoAssignRole: "Meister" },
  { title: "Rechnung stellen",        depends_on: ["Prüfprotokoll erstellen"] },
];

const ROOM_SEQUENCE = [
  "Planung",
  "Schlitzen",
  "Kabelweg machen",
  "Kabel ziehen",
  "Dosen setzen",
  "Steckdosen / Schalter montieren",
  "Beleuchtung installieren",
  "Prüfen",
];

export interface GeneratedTask {
  key: string;
  title: string;
  selected: boolean;
  group: "Allgemein" | string;
  depends_on_keys: string[];
  autoAssignRole?: string;
}

export function generateTasksForProject(
  template: string,
  floors: FloorConfig[],
): GeneratedTask[] {
  const out: GeneratedTask[] = [];

  for (const def of GENERAL_TASK_DEFS) {
    out.push({
      key: `gen-${def.title}`,
      title: def.title,
      selected: true,
      group: "Allgemein",
      depends_on_keys: def.depends_on.map((d) => `gen-${d}`),
      autoAssignRole: def.autoAssignRole,
    });
  }

  if (!FLOOR_TEMPLATES.includes(template)) return out;

  const counter: Record<string, number> = {};
  const allPruefenKeys: string[] = [];

  for (const floor of floors) {
    for (const room of floor.rooms) {
      if (room.count < 1) continue;
      for (let i = 0; i < room.count; i++) {
        counter[room.type] = (counter[room.type] ?? 0) + 1;
        const totalForType = totalCountForType(floors, room.type);
        const roomName = totalForType > 1
          ? `${room.type} ${counter[room.type]}`
          : room.type;

        let prevKey: string | null = null;
        for (const step of ROOM_SEQUENCE) {
          const key = `room-${roomName}-${step}`;
          const extraDeps: string[] = [];

          if (step === "Planung") {
            extraDeps.push("gen-Zählerschrank / UV planen");
            extraDeps.push("gen-Angebot freigeben lassen");
          }
          if (step === "Kabel ziehen") {
            extraDeps.push("gen-Material bestellen");
          }

          out.push({
            key,
            title: `${step} (${roomName})`,
            selected: true,
            group: roomName,
            depends_on_keys: [
              ...(prevKey ? [prevKey] : []),
              ...extraDeps,
            ],
          });

          if (step === "Prüfen") allPruefenKeys.push(key);
          prevKey = key;
        }
      }
    }
  }

  const abnahme = out.find((t) => t.key === "gen-Abnahme durchführen");
  if (abnahme) {
    abnahme.depends_on_keys = [...abnahme.depends_on_keys, ...allPruefenKeys];
  }

  return out;
}

function totalCountForType(floors: FloorConfig[], type: string): number {
  let n = 0;
  for (const f of floors) for (const r of f.rooms) if (r.type === type) n += r.count;
  return n;
}

export const DEFAULT_PRIORITY: Priority = "mittel";
