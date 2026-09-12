import { AppSettings, LightScreenCheck } from "../types";

const ERROR_WORDS = /error|failed|failure|exception|traceback|panic|denied|unauthorized|timeout|cannot|can't|无法连接|连接失败|报错|错误|失败|异常|超时|崩溃|拒绝|不可用/i;

export interface SmartDecisionState {
  lastModelAt: number;
  sceneCache: Record<string, number>;
}

export interface SmartDecision {
  trigger: boolean;
  reason: "initial" | "window_change" | "error" | "visual_change" | "ocr_change" | "manual";
  score: number;
  sceneKey: string;
  skippedReason?: "model_cooldown" | "cache" | "no_change";
  remainingMs?: number;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").toLowerCase().slice(0, 300);
}

function hammingRatio(left: string, right: string) {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let diff = Math.abs(left.length - right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) diff += 1;
  }
  return diff / Math.max(left.length, right.length);
}

function sceneKeyOf(check: LightScreenCheck) {
  const title = check.window.title.toLowerCase().slice(0, 80);
  const processName = check.window.processName.toLowerCase().slice(-80);
  const ocr = normalizeText(check.ocrText).slice(0, 80);
  return `${processName}|${title}|${check.visualHash.slice(0, 96)}|${ocr}`;
}

export function effectiveSmartModelMinIntervalMs(settings: AppSettings) {
  const seconds = settings.lowSpecMode
    ? Math.max(25, settings.smartModelMinIntervalSeconds)
    : settings.smartModelMinIntervalSeconds;
  return Math.max(5, seconds) * 1000;
}

export function smartLocalCheckIntervalMs(settings: AppSettings) {
  return Math.max(1, settings.smartLocalCheckIntervalSeconds) * 1000;
}

export function smartOcrIntervalMs(settings: AppSettings) {
  return settings.lowSpecMode ? 10000 : 5000;
}

export function decideSmartObservation(
  settings: AppSettings,
  current: LightScreenCheck,
  previous: LightScreenCheck | null,
  state: SmartDecisionState,
  nowMs = Date.now()
): SmartDecision {
  const sceneKey = sceneKeyOf(current);
  const minIntervalMs = effectiveSmartModelMinIntervalMs(settings);
  const sinceModel = nowMs - state.lastModelAt;
  const cachedAt = state.sceneCache[sceneKey] || 0;
  const cacheMs = Math.max(10, settings.smartSameSceneCacheSeconds) * 1000;

  if (!previous) {
    if (sinceModel < minIntervalMs) {
      return { trigger: false, reason: "initial", score: 10, sceneKey, skippedReason: "model_cooldown", remainingMs: minIntervalMs - sinceModel };
    }
    if (cachedAt && nowMs - cachedAt < cacheMs) {
      return { trigger: false, reason: "initial", score: 10, sceneKey, skippedReason: "cache", remainingMs: cacheMs - (nowMs - cachedAt) };
    }
    return { trigger: true, reason: "initial", score: 10, sceneKey };
  }

  let reason: SmartDecision["reason"] = "initial";
  let score = 0;

  const windowChanged = Boolean(previous && (
    previous.window.title !== current.window.title ||
    previous.window.processName !== current.window.processName
  ));
  const visualDelta = previous ? hammingRatio(previous.visualHash, current.visualHash) : 1;
  const currentOcr = normalizeText(current.ocrText);
  const previousOcr = normalizeText(previous?.ocrText || "");
  const ocrChanged = Boolean(previous && currentOcr && (
    !previousOcr ||
    Math.abs(currentOcr.length - previousOcr.length) >= 12 ||
    hammingRatio(currentOcr, previousOcr) > 0.22
  ));
  const hasError = settings.smartErrorTriggerEnabled && ERROR_WORDS.test(`${current.window.title} ${current.ocrText}`);

  if (hasError) {
    reason = "error";
    score = 10;
  } else if (settings.smartWindowChangeTriggerEnabled && windowChanged) {
    reason = "window_change";
    score = Math.max(score, 7);
  } else if (settings.smartVisualChangeTriggerEnabled && visualDelta >= (settings.lowSpecMode ? 0.26 : 0.18)) {
    reason = "visual_change";
    score = Math.max(score, settings.lowSpecMode ? 6 : 5);
  } else if (settings.smartOcrChangeTriggerEnabled && ocrChanged) {
    reason = "ocr_change";
    score = Math.max(score, settings.lowSpecMode ? 6 : 5);
  }

  if (score <= 0) return { trigger: false, reason, score, sceneKey, skippedReason: "no_change" };
  if (sinceModel < minIntervalMs && reason !== "error") {
    return { trigger: false, reason, score, sceneKey, skippedReason: "model_cooldown", remainingMs: minIntervalMs - sinceModel };
  }
  if (cachedAt && nowMs - cachedAt < cacheMs && reason !== "error") {
    return { trigger: false, reason, score, sceneKey, skippedReason: "cache", remainingMs: cacheMs - (nowMs - cachedAt) };
  }
  return { trigger: true, reason, score, sceneKey };
}

export function rememberSmartScene(cache: Record<string, number>, sceneKey: string, nowMs = Date.now()) {
  cache[sceneKey] = nowMs;
  const entries = Object.entries(cache);
  if (entries.length <= 80) return cache;
  const keep = entries.sort((a, b) => b[1] - a[1]).slice(0, 80);
  return Object.fromEntries(keep);
}
