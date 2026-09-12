import { describe, expect, it } from "vitest";
import { defaults, GameObservation } from "../types";
import { addBtCompanionLine, resetBtCompanionLineHistory } from "./btCompanion";

const observation = (eventType: GameObservation["eventType"] = "combat"): GameObservation => ({
  capturedAt: "now",
  window: { title: "Cyberpunk 2077", processName: "game.exe" },
  ocrText: "",
  sceneKind: "game",
  summary: "combat",
  visibleFacts: [],
  situation: "combat",
  eventType,
  confidence: 0.9,
  changeKey: "combat",
  recommendation: "先换掩体再推进。",
  reason: "",
  shouldSpeak: true,
  advice: "先换掩体再推进。"
});

describe("BT companion tone", () => {
  it("does not add BT lines to non-BT personas", () => {
    resetBtCompanionLineHistory();
    const result = addBtCompanionLine("先换掩体再推进。", observation(), { ...defaults, selectedPreset: "companion" });
    expect(result).toBe("先换掩体再推进。");
  });

  it("avoids repeating recent BT companion lines", () => {
    resetBtCompanionLineHistory();
    const settings = { ...defaults, selectedPreset: "bt" };
    const lines = new Set<string>();
    for (let index = 0; index < 6; index++) {
      const result = addBtCompanionLine(`先换掩体再推进 ${index}。`, observation(), settings);
      lines.add(result.replace(/^先换掩体再推进 \d。 /, ""));
    }
    expect(lines.size).toBe(6);
  });

  it("does not force an extra line when the answer already has companion tone", () => {
    resetBtCompanionLineHistory();
    const result = addBtCompanionLine("铁驭，先换掩体再推进。", observation(), { ...defaults, selectedPreset: "bt" });
    expect(result).toBe("铁驭，先换掩体再推进。");
  });
});
