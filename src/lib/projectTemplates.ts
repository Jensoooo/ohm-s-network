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
  "Wohnzimmer",
  "Schlafzimmer",
  "Küche",
  "Bad",
  "WC",
  "Flur",
  "Treppenhaus",
  "Keller",
  "Dachboden",
  "Garage",
  "Außenbereich",
] as const;

export const FLOOR_TEMPLATES = ["Neubau Wohngebäude", "Renovierung / Umbau"];

const GENERAL_TASKS = [
  "Aufmaß vor Ort",
  "Angebot erstellen",
  "Angebot freigeben lassen",
  "Material kalkulieren",
  "Material bestellen",
  "Zählerschrank / UV planen",
  "Abnahme durchführen",
  "Prüfprotokoll erstellen",
  "Rechnung stellen",
];

// Sequenz pro Raum — Reihenfolge bestimmt automatische Abhängigkeiten
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
  key: string;            // stable id within wizard
  title: string;
  selected: boolean;
  group: "Allgemein" | string; // group label (e.g. "Küche 1" oder "Allgemein")
  depends_on_keys: string[];
}

export function generateTasksForProject(
  template: string,
  floors: FloorConfig[],
): GeneratedTask[] {
  const out: GeneratedTask[] = [];

  for (const title of GENERAL_TASKS) {
    out.push({
      key: `gen-${title}`,
      title,
      selected: true,
      group: "Allgemein",
      depends_on_keys: [],
    });
  }

  if (!FLOOR_TEMPLATES.includes(template)) return out;

  // Count per room type across all floors for numbering "Küche 1", "Küche 2"
  const counter: Record<string, number> = {};
  for (const floor of floors) {
    for (const room of floor.rooms) {
      if (room.count < 1) continue;
      for (let i = 0; i < room.count; i++) {
        counter[room.type] = (counter[room.type] ?? 0) + 1;
        const totalForType = totalCountForType(floors, room.type);
        const roomName =
          totalForType > 1 ? `${room.type} ${counter[room.type]}` : room.type;

        const roomKeys: string[] = [];
        let prevKey: string | null = null;
        for (const step of ROOM_SEQUENCE) {
          const key = `room-${roomName}-${step}`;
          out.push({
            key,
            title: `${step} (${roomName})`,
            selected: true,
            group: roomName,
            depends_on_keys: prevKey ? [prevKey] : [],
          });
          roomKeys.push(key);
          prevKey = key;
        }
      }
    }
  }

  return out;
}

function totalCountForType(floors: FloorConfig[], type: string): number {
  let n = 0;
  for (const f of floors) for (const r of f.rooms) if (r.type === type) n += r.count;
  return n;
}

export const DEFAULT_PRIORITY: Priority = "mittel";
