const KEY = "desktop-pet-memory-v1";
export interface MemorySummary { facts: string[] }
export function loadMemory(): MemorySummary { try { return JSON.parse(localStorage.getItem(KEY) || '{"facts":[]}'); } catch { return { facts: [] }; } }
/** Stores only explicit user-authored preferences, never screenshots/OCR or full chat logs. */
export function rememberExplicitFact(text: string): MemorySummary {
  const current = loadMemory(); const fact = text.replace(/^记住[：:\s]*/u, "").trim();
  const facts = fact ? [...new Set([...current.facts, fact])].slice(-20) : current.facts;
  const next = { facts }; localStorage.setItem(KEY, JSON.stringify(next)); return next;
}
export function memoryPrompt(): string | undefined { const facts = loadMemory().facts; return facts.length ? `用户明确允许保留的偏好：\n- ${facts.join("\n- ")}` : undefined; }
