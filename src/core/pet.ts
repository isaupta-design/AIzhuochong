export type PetMode = "office" | "interactive" | "game";
export type PetAction = "idle" | "look" | "walk" | "run" | "talk" | "click-react" | "dragged" | "sleep" | "wake-up" | "fall";
export type PetTrigger = "system" | "sleep" | "autonomous" | "scene" | "cursor" | "voice" | "click" | "drag" | "wake" | "close";

export interface PetIntent { action: PetAction; trigger: PetTrigger; at: number; }
export interface PetDecision { action: PetAction; trigger: PetTrigger; startedAt: number; until: number; }

const priorities: Record<PetTrigger, number> = {
  close: 100, wake: 90, drag: 80, click: 70, voice: 60, cursor: 50, scene: 40, autonomous: 30, sleep: 20, system: 0
};

export const petActionMeta: Record<PetAction, { minMs: number; cooldownMs: number; interruptible: boolean; fallback: PetAction }> = {
  idle: { minMs: 0, cooldownMs: 0, interruptible: true, fallback: "idle" },
  look: { minMs: 550, cooldownMs: 300, interruptible: true, fallback: "idle" },
  walk: { minMs: 900, cooldownMs: 700, interruptible: true, fallback: "idle" },
  run: { minMs: 700, cooldownMs: 900, interruptible: true, fallback: "idle" },
  talk: { minMs: 700, cooldownMs: 0, interruptible: false, fallback: "idle" },
  "click-react": { minMs: 850, cooldownMs: 800, interruptible: false, fallback: "idle" },
  dragged: { minMs: 180, cooldownMs: 0, interruptible: false, fallback: "idle" },
  sleep: { minMs: 4000, cooldownMs: 10000, interruptible: true, fallback: "idle" },
  "wake-up": { minMs: 900, cooldownMs: 1500, interruptible: false, fallback: "idle" },
  fall: { minMs: 900, cooldownMs: 2500, interruptible: false, fallback: "idle" }
};

export function choosePetAction(current: PetDecision, next: PetIntent): PetDecision {
  const now = next.at;
  const active = now < current.until;
  const currentPriority = active ? priorities[current.trigger] : -1;
  const nextPriority = priorities[next.trigger];
  const meta = petActionMeta[current.action];
  if (active && !meta.interruptible && nextPriority <= currentPriority) return current;
  const nextMeta = petActionMeta[next.action];
  return { action: next.action, trigger: next.trigger, startedAt: now, until: now + nextMeta.minMs };
}

export function petActionForPointer(mode: PetMode, distance: number, speed: number, pressed: boolean, hit: boolean): PetIntent | null {
  const at = Date.now();
  if (mode !== "interactive") return null;
  if (pressed && hit) return { action: "dragged", trigger: "drag", at };
  if (hit && speed < 0.2) return { action: "click-react", trigger: "click", at };
  if (distance < 115) return { action: speed > 1.2 ? "run" : "look", trigger: "cursor", at };
  return null;
}
