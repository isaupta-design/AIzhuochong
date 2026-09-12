import { CSSProperties, useEffect, useRef, useState } from "react";
import gugu from "../assets/gugu/gugu.png";
import { PetAction, PetMode, PetTrigger, choosePetAction, petActionForPointer } from "../core/pet";

export type PetPointer = { x: number; y: number; speed: number; pressed: boolean; timestamp: number };

const label: Record<PetAction, string> = {
  idle: "发呆", look: "观察", walk: "散步", run: "追光标", talk: "说话中", "click-react": "被摸到啦", dragged: "被拖着走", sleep: "睡着了", "wake-up": "醒来", fall: "摔倒"
};

export function GuguPet({ mode, enabled, size, lowSpec, speaking, pointer }: { mode: PetMode; enabled: boolean; size: number; lowSpec: boolean; speaking: boolean; pointer: PetPointer | null }) {
  const [action, setAction] = useState<PetAction>("idle");
  const [mood, setMood] = useState(70);
  const lastPointer = useRef(0);
  const decision = useRef({ action: "idle" as PetAction, trigger: "system" as PetTrigger, startedAt: 0, until: 0 });
  const request = (next: PetAction, trigger: PetTrigger) => {
    const chosen = choosePetAction(decision.current, { action: next, trigger, at: Date.now() });
    decision.current = chosen;
    setAction(chosen.action);
    if (chosen.until > Date.now()) window.setTimeout(() => {
      if (decision.current.action === chosen.action && Date.now() >= chosen.until) request("idle", "system");
    }, chosen.until - Date.now() + 20);
  };

  useEffect(() => {
    if (!enabled || mode === "game") { request("idle", "system"); return; }
    if (speaking) { request("talk", "voice"); return; }
    if (!pointer || Date.now() - lastPointer.current < 260) return;
    const intent = petActionForPointer(mode, 80, pointer.speed, pointer.pressed, false);
    if (intent) {
      lastPointer.current = Date.now();
      request(intent.action, intent.trigger);
      setMood((old) => Math.min(100, old + (intent.action === "click-react" ? 5 : 1)));
    }
  }, [enabled, lowSpec, mode, pointer, speaking]);

  useEffect(() => {
    if (mode !== "interactive" || !enabled) return;
    const timer = window.setInterval(() => {
      if (decision.current.action === "idle" && Math.random() > .55) request("look", "autonomous");
      setMood((old) => Math.max(20, old - 1));
    }, 8000);
    return () => window.clearInterval(timer);
  }, [enabled, mode]);

  if (!enabled || mode === "game") return null;
  const style = { "--pet-size": size, "--pet-rate": lowSpec ? "3s" : "1.65s" } as CSSProperties;
  return <section className={`gugu-pet action-${action} mode-${mode}`} style={style} aria-label={`咕咕嘎嘎，${label[action]}`}>
    <div className="gugu-aura" aria-hidden="true" />
    <img className="gugu-body" src={gugu} alt="咕咕嘎嘎企鹅桌宠" draggable={false} onMouseDown={(event) => { event.stopPropagation(); request("click-react", "click"); setMood((old) => Math.min(100, old + 6)); }} />
    <span className="gugu-status">咕咕嘎嘎 · {label[action]}</span>
    {action === "sleep" && <span className="gugu-z">Z</span>}
    <span className="gugu-mood" title="心情">♥ {mood}</span>
  </section>;
}
