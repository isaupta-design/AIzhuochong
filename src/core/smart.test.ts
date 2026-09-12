import { describe, expect, it } from "vitest";
import { defaults, LightScreenCheck } from "../types";
import { decideSmartObservation, effectiveSmartModelMinIntervalMs, rememberSmartScene } from "./smart";

const check = (patch: Partial<LightScreenCheck> = {}): LightScreenCheck => ({
  capturedAt: "now",
  visualHash: "0".repeat(576),
  ocrText: "",
  signature: "sig",
  window: { title: "Desktop", processName: "explorer.exe" },
  ...patch
});

describe("smart observation", () => {
  it("triggers on first frame", () => {
    const decision = decideSmartObservation(defaults, check(), null, { lastModelAt: 0, sceneCache: {} }, 100000);
    expect(decision.trigger).toBe(true);
    expect(decision.reason).toBe("initial");
  });

  it("skips unchanged frame", () => {
    const previous = check();
    const decision = decideSmartObservation(defaults, check(), previous, { lastModelAt: 0, sceneCache: {} }, 100000);
    expect(decision.trigger).toBe(false);
    expect(decision.skippedReason).toBe("no_change");
  });

  it("uses a longer minimum model interval in low spec mode", () => {
    expect(effectiveSmartModelMinIntervalMs({ ...defaults, lowSpecMode: true, smartModelMinIntervalSeconds: 5 })).toBe(25000);
  });

  it("detects error text even during model cooldown", () => {
    const current = check({ ocrText: "无法连接 GPT-SoVITS" });
    const decision = decideSmartObservation(defaults, current, check(), { lastModelAt: 99990, sceneCache: {} }, 100000);
    expect(decision.trigger).toBe(true);
    expect(decision.reason).toBe("error");
  });

  it("uses cache to skip the same scene", () => {
    const current = check({ visualHash: "1".repeat(576) });
    const first = decideSmartObservation(defaults, current, check(), { lastModelAt: 0, sceneCache: {} }, 100000);
    const cache = rememberSmartScene({}, first.sceneKey, 100000);
    const second = decideSmartObservation(defaults, current, check(), { lastModelAt: 0, sceneCache: cache }, 101000);
    expect(second.trigger).toBe(false);
    expect(second.skippedReason).toBe("cache");
  });
});
