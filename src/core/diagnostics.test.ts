import { describe, expect, it } from "vitest";
import { appendDiagnostic, DiagnosticLog, formatDiagnostics, sanitizeLogText } from "./diagnostics";

describe("diagnostics", () => {
  it("keeps a bounded in-memory log", () => {
    let items: DiagnosticLog[] = [];
    for (let i = 0; i < 205; i++) items = appendDiagnostic(items, `entry-${i}`);
    expect(items).toHaveLength(200);
    expect(formatDiagnostics(items)).toContain("entry-204");
    expect(formatDiagnostics(items)).not.toContain("entry-0");
  });

  it("redacts screenshots, secrets, and local paths", () => {
    const text = sanitizeLogText("api_key=sk-secret123 C:\\Users\\me\\Desktop\\a.png data:image/png;base64,AAAA");
    expect(text).toContain("[secret]");
    expect(text).toContain("[local-path]");
    expect(text).toContain("[image-data-url]");
    expect(text).not.toContain("sk-secret123");
    expect(text).not.toContain("base64,AAAA");
  });
});
