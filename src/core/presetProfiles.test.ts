import { describe, expect, it } from "vitest";
import { defaults } from "../types";
import { exportSettings } from "./settings";
import { addBundleFromCurrent, applyBundle, deleteBundle, importPresetJson } from "./presetProfiles";

describe("custom preset profiles", () => {
  it("copies current settings into a removable bundle", () => {
    const withBundle = addBundleFromCurrent({ ...defaults, customPersona: "你是测试角色", voiceVolume: 42 }, "测试方案");
    expect(withBundle.customBundles).toHaveLength(1);
    expect(withBundle.customCharacters[0].systemPrompt).toBe("你是测试角色");
    expect(withBundle.customVoiceProfiles[0].volume).toBe(42);

    const applied = applyBundle({ ...withBundle, customPersona: "" }, withBundle.customBundles[0].id);
    expect(applied.customPersona).toBe("你是测试角色");
    expect(applied.voiceVolume).toBe(42);

    const removed = deleteBundle(applied, withBundle.customBundles[0].id);
    expect(removed.customBundles).toHaveLength(0);
  });

  it("imports exported preset JSON without secrets", () => {
    const withBundle = addBundleFromCurrent({ ...defaults, provider: { ...defaults.provider, apiKey: "secret" }, speech: { ...defaults.speech, apiKey: "speech-secret" } }, "导出方案");
    const exported = exportSettings(withBundle);
    expect(exported).not.toContain("secret");
    expect(exported).not.toContain("speech-secret");

    const imported = importPresetJson(defaults, exported);
    expect(imported.customBundles.some((bundle) => bundle.name === "导出方案")).toBe(true);
  });
});
