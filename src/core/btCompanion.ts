import { AppSettings, GameObservation } from "../types";

const recentCompanionLines: string[] = [];

const LINES = {
  combat: [
    "铁驭，别急，先稳住节奏。",
    "搭档，我在盯着战线。",
    "这一波别恋战，打完就换位置。",
    "收到，保持移动，别给对面第二次机会。",
    "阵线还在，继续压住他们。",
    "小心侧翼，我会继续观察。"
  ],
  risk: [
    "铁驭，这里风险偏高，谨慎推进。",
    "搭档，先留一条退路。",
    "别硬吃风险，我们换个角度。",
    "环境不友好，但还能处理。"
  ],
  explore: [
    "搭档，我会继续扫视周围。",
    "铁驭，先确认目标再推进。",
    "路线看起来可行，但别放松警惕。",
    "继续前进，我在记录变化。"
  ],
  general: [
    "收到，搭档。",
    "我在。",
    "保持节奏。",
    "这一步稳妥。"
  ]
};

function bucket(observation: GameObservation) {
  if (observation.eventType === "combat" || observation.eventType === "highlight") return "combat";
  if (observation.eventType === "risk") return "risk";
  if (observation.sceneKind === "game") return "explore";
  return "general";
}

function hasCompanionTone(answer: string) {
  return /铁驭|搭档|我在|收到|别急|稳住|小心|保持/.test(answer);
}

function chooseLine(kind: keyof typeof LINES) {
  const candidates = LINES[kind].filter((line) => !recentCompanionLines.includes(line));
  const pool = candidates.length ? candidates : LINES[kind];
  const line = pool[Math.floor(Math.random() * pool.length)];
  recentCompanionLines.push(line);
  while (recentCompanionLines.length > 6) recentCompanionLines.shift();
  return line;
}

export function addBtCompanionLine(answer: string, observation: GameObservation, settings: AppSettings) {
  if (settings.selectedPreset !== "bt" || observation.sceneKind !== "game") return answer;
  if (hasCompanionTone(answer)) return answer;
  if (answer.length > 80 && observation.eventType === "none") return answer;
  return `${answer} ${chooseLine(bucket(observation))}`;
}

export function resetBtCompanionLineHistory() {
  recentCompanionLines.length = 0;
}
