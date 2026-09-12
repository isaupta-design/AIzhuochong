export interface DiagnosticLog {
  at: string;
  message: string;
}

const PATH_RE = /[A-Za-z]:\\(?:[^\\\s]+\\){1,}[^\\\s]*/g;
const DATA_URL_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
const SECRET_RE = /(sk-[A-Za-z0-9_-]{8,}|dashscope[A-Za-z0-9_-]*|api[_-]?key\s*[:=]\s*["']?[^"'\s]+)/gi;

export function sanitizeLogText(value: unknown) {
  return String(value)
    .replace(DATA_URL_RE, "[image-data-url]")
    .replace(PATH_RE, "[local-path]")
    .replace(SECRET_RE, "[secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

export function appendDiagnostic(items: DiagnosticLog[], message: string, limit = 200): DiagnosticLog[] {
  return [...items, { at: new Date().toLocaleTimeString("zh-CN", { hour12: false }), message: sanitizeLogText(message) }].slice(-limit);
}

export function formatDiagnostics(items: DiagnosticLog[]) {
  return items.map((item) => `${item.at} ${item.message}`).join("\n");
}
