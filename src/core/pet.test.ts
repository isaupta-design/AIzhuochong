import { describe, expect, it } from "vitest";
import { choosePetAction, petActionForPointer } from "./pet";

describe("pet action priority", () => {
  it("lets direct drag replace cursor movement", () => {
    const current = { action: "look" as const, trigger: "cursor" as const, startedAt: 0, until: 1000 };
    expect(choosePetAction(current, { action: "dragged", trigger: "drag", at: 20 }).action).toBe("dragged");
  });
  it("does not create cursor actions outside interactive mode", () => {
    expect(petActionForPointer("office", 20, 0, false, false)).toBeNull();
  });
});
