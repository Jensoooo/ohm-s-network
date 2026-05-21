import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import {
  PROJECT_TEMPLATES,
  ROOM_TYPES,
  FLOOR_TEMPLATES,
  generateTasksForProject,
  type GeneratedTask,
} from "@/lib/projectTemplates";
import type { FloorConfig, Priority } from "@/lib/types";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Minus, X, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function BaustelleWizard({ open, onClose }: Props) {
  const customers = useStore((s) => s.customers);
  const users = useStore((s) => s.users);
  const areas = useStore((s) => s.areas);
  const createCustomer = useStore((s) => s.createCustomer);
  const createProject = useStore((s) => s.createProject);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // step 1
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [template, setTemplate] = useState<string>(PROJECT_TEMPLATES[0]);
  const [customerId, setCustomerId] = useState<string | "new" | "">("");
  const [newCustomer, setNewCustomer] = useState({ name: "", address: "", phone: "", email: "" });

  // step 2
  const [floors, setFloors] = useState<FloorConfig[]>([
    { id: uid(), name: "Erdgeschoss (EG)", rooms: ROOM_TYPES.map((t) => ({ type: t, count: 0 })) },
  ]);

  // step 3
  const [tasks, setTasks] = useState<GeneratedTask[]>([]);
  const [saving, setSaving] = useState(false);

  const hasFloors = FLOOR_TEMPLATES.includes(template);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setName(""); setAddress(""); setTemplate(PROJECT_TEMPLATES[0]);
      setCustomerId(""); setNewCustomer({ name: "", address: "", phone: "", email: "" });
      setFloors([{ id: uid(), name: "Erdgeschoss (EG)", rooms: ROOM_TYPES.map((t) => ({ type: t, count: 0 })) }]);
      setTasks([]);
    }
  }, [open]);

  const goNext = async () => {
    if (step === 1) {
      if (!name.trim()) return toast.error("Projektname fehlt");
      if (!template) return toast.error("Vorlage fehlt");
      if (customerId === "new" && !newCustomer.name.trim()) return toast.error("Kundenname fehlt");
      if (hasFloors) setStep(2);
      else {
        setTasks(generateTasksForProject(template, []));
        setStep(3);
      }
    } else if (step === 2) {
      setTasks(generateTasksForProject(template, floors));
      setStep(3);
    }
  };

  const goBack = () => {
    if (step === 3 && hasFloors) setStep(2);
    else if (step === 3 && !hasFloors) setStep(1);
    else if (step === 2) setStep(1);
  };

  const addFloor = () => {
    setFloors((f) => [
      ...f,
      { id: uid(), name: `Etage ${f.length + 1}`, rooms: ROOM_TYPES.map((t) => ({ type: t, count: 0 })) },
    ]);
  };

  const removeFloor = (id: string) => setFloors((f) => f.filter((x) => x.id !== id));
  const renameFloor = (id: string, n: string) => setFloors((f) => f.map((x) => (x.id === id ? { ...x, name: n } : x)));
  const setRoomCount = (floorId: string, roomType: string, delta: number) =>
    setFloors((f) =>
      f.map((x) =>
        x.id !== floorId
          ? x
          : {
              ...x,
              rooms: x.rooms.map((r) => (r.type === roomType ? { ...r, count: Math.max(0, r.count + delta) } : r)),
            },
      ),
    );

  const toggleTask = (key: string) =>
    setTasks((ts) => ts.map((t) => (t.key === key ? { ...t, selected: !t.selected } : t)));

  const handleCreate = async () => {
    setSaving(true);
    try {
      let cid: string | null = null;
      if (customerId === "new") {
        const c = await createCustomer({
          name: newCustomer.name.trim(),
          address: newCustomer.address.trim() || null,
          phone: newCustomer.phone.trim() || null,
          email: newCustomer.email.trim() || null,
        });
        cid = c.id;
      } else if (customerId) {
        cid = customerId;
      }

      const defaultArea = areas[0]?.id ?? "";
      const defaultOwner = users[0]?.id ?? "";
      if (!defaultArea || !defaultOwner) {
        toast.error("Bitte zuerst Bereiche und Bearbeiter anlegen");
        setSaving(false);
        return;
      }

      const selected = tasks.filter((t) => t.selected);
      const selectedKeys = new Set(selected.map((t) => t.key));

      const newTasks = selected.map((t) => ({
        title: t.title,
        area_id: defaultArea,
        owner_id: defaultOwner,
        priority: "mittel" as Priority,
        deadline: null,
        no_deadline: true,
        depends_on_titles: t.depends_on_keys
          .filter((k) => selectedKeys.has(k))
          .map((k) => tasks.find((x) => x.key === k)!.title),
      }));

      await createProject({
        name: name.trim(),
        address: address.trim() || null,
        template_type: template,
        customer_id: cid,
        floors: hasFloors ? floors : [],
        tasks: newTasks,
      });
      toast.success("Baustelle erstellt");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, GeneratedTask[]>();
    for (const t of tasks) {
      if (!map.has(t.group)) map.set(t.group, []);
      map.get(t.group)!.push(t);
    }
    return [...map.entries()];
  }, [tasks]);

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent className="bg-surface border-border max-h-[94vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-foreground">
            Neue Baustelle · Schritt {step}/{hasFloors ? 3 : 2}
          </DrawerTitle>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-24">
          {step === 1 && (
            <>
              <div>
                <Label>Projektname *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Neubau Familie Müller" className="bg-card-raw border-border" />
              </div>
              <div>
                <Label>Adresse</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Musterstraße 12, Nagold" className="bg-card-raw border-border" />
              </div>
              <div>
                <Label>Vorlage *</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {PROJECT_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => setTemplate(tpl)}
                      className={
                        "rounded-full border px-3 py-1.5 text-xs transition " +
                        (template === tpl
                          ? "gradient-brand text-white border-transparent"
                          : "border-border bg-card-raw text-muted-foreground")
                      }
                    >
                      {tpl}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Kunde</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomerId("")}
                    className={
                      "rounded-full border px-3 py-1.5 text-xs transition " +
                      (customerId === ""
                        ? "border-primary bg-primary/20 text-foreground"
                        : "border-border bg-card-raw text-muted-foreground")
                    }
                  >
                    Kein Kunde
                  </button>
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCustomerId(c.id)}
                      className={
                        "rounded-full border px-3 py-1.5 text-xs transition " +
                        (customerId === c.id
                          ? "border-primary bg-primary/20 text-foreground"
                          : "border-border bg-card-raw text-muted-foreground")
                      }
                    >
                      {c.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomerId("new")}
                    className={
                      "rounded-full border px-3 py-1.5 text-xs transition " +
                      (customerId === "new"
                        ? "gradient-brand text-white border-transparent"
                        : "border-dashed border-border bg-card-raw text-muted-foreground")
                    }
                  >
                    + Neuer Kunde
                  </button>
                </div>
              </div>
              {customerId === "new" && (
                <div className="space-y-3 rounded-2xl border border-border bg-card-raw p-3">
                  <div>
                    <Label>Kundenname *</Label>
                    <Input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} className="bg-surface border-border" />
                  </div>
                  <div>
                    <Label>Adresse</Label>
                    <Input value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} className="bg-surface border-border" />
                  </div>
                  <div>
                    <Label>Telefon</Label>
                    <Input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} className="bg-surface border-border" />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} className="bg-surface border-border" />
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && hasFloors && (
            <>
              <p className="text-xs text-muted-foreground">Etagen von unten nach oben.</p>
              <div className="space-y-4">
                {floors.map((floor) => (
                  <div key={floor.id} className="rounded-2xl border border-border bg-card-raw p-3">
                    <div className="mb-3 flex items-center gap-2">
                      <Input
                        value={floor.name}
                        onChange={(e) => renameFloor(floor.id, e.target.value)}
                        className="h-8 flex-1 bg-surface border-border"
                      />
                      {floors.length > 1 && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeFloor(floor.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {floor.rooms.map((r) => {
                        const active = r.count >= 1;
                        return (
                          <div
                            key={r.type}
                            className="flex items-center justify-between rounded-xl px-2 py-1.5 transition"
                            style={{
                              opacity: active ? 1 : 0.45,
                              background: active ? "rgba(20,184,166,0.08)" : "transparent",
                              border: active ? "1px solid rgba(20,184,166,0.4)" : "1px solid transparent",
                            }}
                          >
                            <span className="text-sm text-foreground">{r.type}</span>
                            <div className="flex items-center gap-2">
                              <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" onClick={() => setRoomCount(floor.id, r.type, -1)}>
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <span
                                className="w-6 text-center text-sm font-semibold"
                                style={{ color: active ? "#14b8a6" : undefined }}
                              >
                                {r.count}
                              </span>
                              <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" onClick={() => setRoomCount(floor.id, r.type, 1)}>
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <Button onClick={addFloor} variant="outline" className="w-full rounded-full border-border">
                  <Plus className="mr-2 h-4 w-4" /> Etage hinzufügen
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-xs text-muted-foreground">
                {tasks.filter((t) => t.selected).length} von {tasks.length} Aufgaben werden erstellt.
              </p>
              <div className="space-y-3">
                {grouped.map(([group, items]) => (
                  <div key={group} className="rounded-2xl border border-border bg-card-raw">
                    <div className="border-b border-border/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group}
                    </div>
                    {items.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => toggleTask(t.key)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm border-b border-border/60 last:border-b-0"
                      >
                        <span className={t.selected ? "text-foreground" : "text-muted-foreground line-through"}>{t.title}</span>
                        <span
                          className={
                            "ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border " +
                            (t.selected ? "gradient-brand border-transparent text-white" : "border-border")
                          }
                        >
                          {t.selected && <Check className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-border bg-surface px-4 py-3 safe-bottom">
          {step > 1 ? (
            <Button variant="ghost" onClick={goBack} className="rounded-full">
              <ChevronLeft className="mr-1 h-4 w-4" /> Zurück
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose} className="rounded-full">Abbrechen</Button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <Button onClick={goNext} className="gradient-brand rounded-full text-white">
              Weiter <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={saving} className="gradient-brand rounded-full text-white">
              {saving ? "Speichert…" : "Baustelle erstellen"}
            </Button>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
