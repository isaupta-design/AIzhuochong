import { describe, expect, it } from "vitest";
import { defaults } from "../types";
import { isBlocked, loadSettings, saveSettings } from "./settings";

const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: (key: string) => store[key] || null,
  setItem: (key: string, value: string) => { store[key] = value; },
  clear: () => { for (const key of Object.keys(store)) delete store[key]; }
}});

describe("window blacklist", () => {
  it("matches title and process name without case sensitivity", () => {
    expect(isBlocked({ ...defaults, blacklist: ["bank", "KeePass"] }, { title: "My BANK", processName: "chrome.exe" })).toBe(true);
    expect(isBlocked({ ...defaults, blacklist: ["bank"] }, { title: "Editor", processName: "code.exe" })).toBe(false);
  });

  it("migrates removed and invalid saved settings to safe values", () => {
    localStorage.clear();
    localStorage.setItem("desktop-pet-settings", JSON.stringify({
      voice: { engine: "piper" },
      commentCooldownSeconds: -1,
      memoryEngine: "off",
      memoryEnabled: true,
      blacklist: [" qq ", "", 123],
      provider: { kind: "bad", model: "qwen-vl-plus" }
    }));

    const settings = loadSettings();
    expect(settings.voice.engine).toBe("gpt-sovits");
    expect(settings.commentCooldownSeconds).toBe(5);
    expect(settings.memoryEngine).toBe("off");
    expect(settings.memoryEnabled).toBe(false);
    expect(settings.blacklist).toEqual(["qq", "123"]);
    expect(settings.provider.kind).toBe(defaults.provider.kind);
    expect(settings.provider.visionModel).toBe("qwen-vl-plus");
    expect(settings.voicePanelEnabled).toBe(true);
    expect(settings.voiceSubtitleEnabled).toBe(true);
    expect(settings.voiceBarsMode).toBe("dynamic");
    expect(settings.voiceVolume).toBe(100);
    expect(settings.voiceFadeInEnabled).toBe(true);
    expect(settings.voiceFadeOutEnabled).toBe(true);
    expect(settings.startOnLaunch).toBe(false);
    expect(settings.paused).toBe(true);
    expect(settings.startupVoiceCueEnabled).toBe(true);
    expect(settings.gameAwarenessEnabled).toBe(true);
    expect(settings.lowSpecMode).toBe(false);
    expect(settings.maxSpokenChars).toBe(100);
    expect(settings.ttsTimeoutSeconds).toBe(35);
    expect(settings.speech.enabled).toBe(false);
    expect(settings.speech.mode).toBe("push-to-talk");
    expect(settings.speech.provider).toBe("local-http");
    expect(settings.speech.hotkeyEnabled).toBe(false);
    expect(settings.speech.hotkeyVk).toBe(119);
    expect(settings.speech.pttCueEnabled).toBe(true);
    expect(localStorage.getItem("desktop-pet-settings")).not.toContain("piper");
    expect(localStorage.getItem("desktop-pet-settings")).not.toContain("\"apiKey\"");
  });

  it("migrates old auto-running installs into standby unless startOnLaunch is set", () => {
    localStorage.clear();
    localStorage.setItem("desktop-pet-settings", JSON.stringify({ paused: false, gameModeEnabled: false }));
    let settings = loadSettings();
    expect(settings.startOnLaunch).toBe(false);
    expect(settings.paused).toBe(true);
    expect(settings.gameAwarenessEnabled).toBe(false);

    localStorage.setItem("desktop-pet-settings", JSON.stringify({ startOnLaunch: true, paused: false }));
    settings = loadSettings();
    expect(settings.startOnLaunch).toBe(true);
    expect(settings.paused).toBe(false);
  });

  it("clamps desktop voice volume during settings migration", () => {
    localStorage.clear();
    localStorage.setItem("desktop-pet-settings", JSON.stringify({ voiceVolume: 999, voicePanelEnabled: false, voiceSubtitleEnabled: false, voiceBarsMode: "static", voiceFadeInEnabled: false, voiceFadeOutEnabled: false }));
    let settings = loadSettings();
    expect(settings.voiceVolume).toBe(100);
    expect(settings.voicePanelEnabled).toBe(false);
    expect(settings.voiceSubtitleEnabled).toBe(false);
    expect(settings.voiceBarsMode).toBe("static");
    expect(settings.voiceFadeInEnabled).toBe(false);
    expect(settings.voiceFadeOutEnabled).toBe(false);

    localStorage.setItem("desktop-pet-settings", JSON.stringify({ voiceVolume: -20, voiceBarsMode: "bad" }));
    settings = loadSettings();
    expect(settings.voiceVolume).toBe(0);
    expect(settings.voiceBarsMode).toBe("dynamic");
  });

  it("uses low spec defaults and clamps voice performance settings", () => {
    localStorage.clear();
    localStorage.setItem("desktop-pet-settings", JSON.stringify({ lowSpecMode: true }));
    let settings = loadSettings();
    expect(settings.lowSpecMode).toBe(true);
    expect(settings.maxSpokenChars).toBe(24);
    expect(settings.ttsTimeoutSeconds).toBe(75);

    localStorage.setItem("desktop-pet-settings", JSON.stringify({ lowSpecMode: true, maxSpokenChars: 999, ttsTimeoutSeconds: 999 }));
    settings = loadSettings();
    expect(settings.maxSpokenChars).toBe(200);
    expect(settings.ttsTimeoutSeconds).toBe(180);

    localStorage.setItem("desktop-pet-settings", JSON.stringify({ maxSpokenChars: 1, ttsTimeoutSeconds: 1 }));
    settings = loadSettings();
    expect(settings.maxSpokenChars).toBe(8);
    expect(settings.ttsTimeoutSeconds).toBe(10);
  });

  it("does not persist API keys in local settings", () => {
    localStorage.clear();
    saveSettings({ ...defaults, provider: { ...defaults.provider, apiKey: "secret" }, speech: { ...defaults.speech, apiKey: "speech-secret" } });
    expect(localStorage.getItem("desktop-pet-settings")).not.toContain("secret");
    expect(localStorage.getItem("desktop-pet-settings")).not.toContain("speech-secret");
  });
});
