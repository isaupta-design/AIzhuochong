import { beforeEach, describe, expect, it } from "vitest";
import { memoryPrompt, rememberExplicitFact } from "./memory";
describe("local summary memory", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { value: {
    clear: () => values.clear(), getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  }, configurable: true });
  beforeEach(() => localStorage.clear());
  it("keeps only explicit facts", () => { rememberExplicitFact("记住：我偏好简短回复"); expect(memoryPrompt()).toContain("偏好简短回复"); });
});
