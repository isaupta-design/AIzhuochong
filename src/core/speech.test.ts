import { describe, expect, it } from "vitest";
import { canStartSpeechInput, postVoiceBlockedUntil } from "./speech";

describe("speech input pacing", () => {
  it("blocks speech recognition while voice is busy", () => {
    expect(canStartSpeechInput("idle", true, 0, 1000)).toBe(false);
  });

  it("blocks speech recognition until the post-voice delay expires", () => {
    const blockedUntil = postVoiceBlockedUntil(3000, 2, 1000);
    expect(blockedUntil).toBe(6000);
    expect(canStartSpeechInput("idle", false, blockedUntil, 5000)).toBe(false);
    expect(canStartSpeechInput("idle", false, blockedUntil, 6000)).toBe(true);
  });

  it("does not start while already recording or transcribing", () => {
    expect(canStartSpeechInput("recording", false, 0, 1000)).toBe(false);
    expect(canStartSpeechInput("transcribing", false, 0, 1000)).toBe(false);
  });
});
