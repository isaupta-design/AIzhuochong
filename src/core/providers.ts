import { invoke } from "@tauri-apps/api/core";
import { AppSettings, ChatMessage, GameObservation, ScreenContext, VoicePlaybackInfo } from "../types";
import { fallbackObservation, gameGenre, gamePhase, sanitizeObservationForContext } from "./game";
import { personaById } from "./personas";

const PRESETS = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  bailian: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-vl-plus" }
};

export function applyPreset(kind: "openai" | "deepseek" | "bailian") {
  return { ...PRESETS[kind], visionModel: PRESETS[kind].model };
}

function url(base: string) {
  return `${base.replace(/\/$/, "")}/chat/completions`;
}

export function personaPrompt(settings: AppSettings) {
  const preset = personaById(settings.selectedPreset);
  const custom = settings.customPersona.trim();
  const identity = custom
    ? `当前启用自定义人格。角色预设名为“${preset.name}”，但必须优先遵守用户写入的自定义人格。`
    : `当前角色身份锁定为“${preset.name}”。如果用户问你是谁、叫什么、是什么角色，必须回答你是“${preset.name}”，不要自创其他代号或名字。`;
  return `${identity}\n${custom || preset.systemPrompt}\n统一要求：文字聊天和看屏回复必须保持同一角色语气；不要自称为未在当前角色/自定义人格中出现的名字。`;
}

export async function askModel(settings: AppSettings, messages: ChatMessage[], context?: ScreenContext) {
  if (!settings.provider.apiKey) throw new Error("请先在设置中填写 API Key。");
  const visualPrompt = `${messages.at(-1)?.content || "请简短评论当前正在使用的应用。"}
当前前台窗口：${context?.window.title || "未知"}
当前进程：${context?.window.processName || "未知"}
本地 OCR：${context?.ocrText || "未识别到文字"}`;
  const supportsVision = settings.provider.kind === "bailian" || (settings.provider.kind !== "deepseek" && !settings.provider.model.toLowerCase().includes("deepseek"));
  const content: unknown = context
    ? (supportsVision ? [{ type: "text", text: visualPrompt }, { type: "image_url", image_url: { url: context.imageDataUrl } }] : visualPrompt)
    : messages.at(-1)?.content;
  const persona = `${personaPrompt(settings)}\n分析屏幕时必须优先根据“当前前台窗口”和 OCR 判断用户在使用什么应用；不要把任何内容笼统称为“桌面”，除非前台窗口确实是桌面。`;
  const body = {
    model: context ? (settings.provider.visionModel || settings.provider.model) : settings.provider.model,
    messages: [
      { role: "system", content: persona },
      ...messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
      { role: "user", content }
    ],
    temperature: 0.7,
    max_tokens: 500
  };
  const response = await fetch(url(settings.provider.baseUrl), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.provider.apiKey}` }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`模型请求失败：${response.status} ${await response.text()}`);
  const json = await response.json();
  return String(json.choices?.[0]?.message?.content || "模型没有返回内容。").trim();
}

const SCENE_KINDS = ["game", "work", "chat", "media", "idle", "unknown"];
const EVENT_TYPES = ["combat", "highlight", "result", "loot", "loadout", "skill", "form", "spreadsheet", "risk", "none"];
const GAME_GENRES = ["rts", "shooter", "extraction", "rpg", "racing", "sim", "moba", "general"];
const GAME_PHASES = ["opening", "early", "mid", "late", "menu", "result", "unknown"];

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 5) : [];
}

function clampConfidence(value: unknown) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function extractJson(raw: string) {
  const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  return start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
}

function parseModelJson(raw: string) {
  const json = extractJson(raw);
  try {
    return JSON.parse(json);
  } catch {
    return JSON.parse(json.replace(/\\(?!["\\/bfnrtu])/g, "\\\\"));
  }
}

export async function analyzeGameFrame(settings: AppSettings, context: ScreenContext, recentHistory: string, gameAnalysisActive = false): Promise<GameObservation> {
  const modeHint = gameAnalysisActive
    ? "当前启用游戏副驾驶：把画面当作游戏决策场景优先分析。"
    : "当前是普通桌宠观察：先判断是否为工作、表格、聊天、媒体、番剧、网页或静态画面。";
  const omniscientRules = !settings.gameAwarenessEnabled ? `
全知型陪伴规则：
1. 当前关闭游戏感知，不要只把自己当游戏副驾驶。番剧、网页、聊天、工作画面也要像陪伴型桌宠一样观察。
2. 媒体/番剧场景可以简短吐槽氛围、评价镜头或提醒“像要反转”，但不要剧透，不要编造未看见剧情。
3. 工作/表格/表单场景优先给下一步检查建议，例如必填项、日期、金额、单位、重复项、保存/提交前核对。
4. 画面静止且没有可行动作时 shouldSpeak=false。` : "";

  const request = `你是一个“情境建议型桌宠”，不是截图解说员。${modeHint}
${genrePrompt(context)}
${omniscientRules}

当前角色人格：
${personaPrompt(settings)}

近期轻量观察：${recentHistory || "无"}。
前台窗口：${context.window.title}
进程：${context.window.processName}
OCR：${context.ocrText || "无"}

任务：
1. 必须先判断用户处境，再给下一步建议；禁止只说“这是某某界面/页面/桌面”。
2. 游戏场景先判断游戏类型，再给类型匹配建议：RTS 看经济/补给/侦查/产能/扩张/编队；射击看掩体/血量/弹药/角度/换位；撤离搜刮看路线/背包/医疗/撤离；RPG 看任务/技能/装备；竞速看路线/刹车点；模拟建造看瓶颈/规划；MOBA 看兵线/视野/技能冷却。
3. 不确定敌我或隐藏信息时必须说“不确定”，建议先侦查/确认，不要编造。
4. 推荐内容要像搭子短促提醒，不要像系统提示。
5. 只返回 JSON，不要 markdown。

JSON 形状：
{"sceneKind":"game|work|chat|media|idle|unknown","gameGenre":"rts|shooter|extraction|rpg|racing|sim|moba|general","gamePhase":"opening|early|mid|late|menu|result|unknown","summary":"一句客观状态","visibleFacts":["确定看见的信息"],"situation":"当前处境判断","opponentRead":"对敌方/对局状态的可见推断，不确定就写暂无可靠敌情","nextPlan":"未来30到90秒建议","eventType":"combat|highlight|result|loot|loadout|skill|form|spreadsheet|risk|none","confidence":0到1,"changeKey":"稳定去重键","recommendation":"一句可执行建议，适合语音播报，35字以内","reason":"一句理由，20字以内","speakReason":"为什么该说或不该说","shouldSpeak":true或false,"advice":"兼容字段，等同 recommendation"}`;

  const raw = await askModel(settings, [{ role: "user", content: request, createdAt: new Date().toISOString() }], context);
  try {
    const parsed = parseModelJson(raw);
    const parsedGenre = GAME_GENRES.includes(parsed.gameGenre) ? parsed.gameGenre : gameGenre(context);
    const parsedPhase = GAME_PHASES.includes(parsed.gamePhase) ? parsed.gamePhase : gamePhase(context, parsed);
    const nextPlan = String(parsed.nextPlan || "").trim();
    const recommendation = String(parsed.recommendation || parsed.advice || nextPlan || "").trim();
    const summary = String(parsed.summary || parsed.situation || "画面状态已记录").trim();
    const eventType = EVENT_TYPES.includes(parsed.eventType) ? parsed.eventType : "none";
    const observation: GameObservation = {
      capturedAt: context.capturedAt,
      window: context.window,
      ocrText: context.ocrText,
      sceneKind: SCENE_KINDS.includes(parsed.sceneKind) ? parsed.sceneKind : (gameAnalysisActive ? "game" : "unknown"),
      summary,
      visibleFacts: asStringArray(parsed.visibleFacts),
      situation: String(parsed.situation || summary).trim(),
      eventType,
      confidence: clampConfidence(parsed.confidence),
      changeKey: String(parsed.changeKey || `${context.window.title}:${eventType}:${context.ocrText.slice(0, 80)}`).slice(0, 120),
      recommendation,
      reason: String(parsed.reason || "").trim(),
      shouldSpeak: typeof parsed.shouldSpeak === "boolean" ? parsed.shouldSpeak : Boolean(recommendation),
      advice: recommendation,
      gameGenre: parsedGenre,
      gamePhase: parsedPhase,
      opponentRead: String(parsed.opponentRead || "").trim(),
      nextPlan,
      matchState: String(parsed.matchState || "").trim(),
      speakReason: String(parsed.speakReason || "").trim()
    };
    return sanitizeObservationForContext(context, observation);
  } catch {
    const fallback = fallbackObservation(context);
    console.warn("Screen analysis JSON parse failed; skipping speech for raw model output.", raw);
    return {
      ...fallback,
      summary: "模型返回格式异常，已跳过本次播报",
      situation: "",
      recommendation: "",
      advice: "",
      reason: "",
      shouldSpeak: false,
      changeKey: `parse-error:${context.window.title}:${context.capturedAt}`
    };
  }
}

function genrePrompt(context: ScreenContext) {
  switch (gameGenre(context)) {
    case "rts":
      return "疑似 RTS/战略游戏：判断 opening/early/mid/late/menu/result；优先看经济、工人、补给、产能、科技、侦查、扩张、编队、多线和可见交战；不要只说继续采矿。";
    case "extraction":
      return "疑似撤离/生存搜刮：优先看撤离安全、背包负重、弹药、医疗、声音风险、路线和战利品取舍；不要编造实时物价和隐藏敌人。";
    case "shooter":
      return "疑似射击/动作游戏：优先看掩体、角度、血量、护盾、弹药、敌人方向、换位和交火节奏；不要给采矿、补人口或建造产能建议。";
    case "rpg":
      return "疑似 RPG/开放世界：优先看任务目标、技能、装备、背包整理、消耗品、敌我状态和探索路线；不要编造未显示的任务攻略。";
    case "racing":
      return "疑似驾驶/竞速：优先看路线、刹车点、入弯出弯、车损、速度、排名和失误恢复；不要说掩体、采矿或背包装备。";
    case "sim":
      return "疑似模拟/建造/大战略：优先看资源瓶颈、生产链、人口、财政、规划、扩张、风险提示和下一步建议；不要说血量、掩体或枪线。";
    case "moba":
      return "疑似 MOBA：优先看兵线、视野、技能冷却、血量蓝量、站位、团战、带线和回城时机；不要说采矿或建造产能。";
    default:
      return "未知游戏类型：先根据画面判断是战斗、搜刮、菜单、结算、驾驶、建造还是任务场景；只给可见信息支持的通用建议。";
  }
}

export async function synthesize(settings: AppSettings, text: string): Promise<VoicePlaybackInfo | undefined> {
  if (!settings.voice.enabled || settings.voice.engine === "none" || !text) return undefined;
  return await invoke<VoicePlaybackInfo>("synthesize_sovits", {
    endpoint: settings.voice.endpoint,
    text,
    referenceAudio: settings.localSovits.referenceAudio,
    referenceText: settings.localSovits.referenceText,
    textLanguage: settings.voice.language,
    referenceLanguage: settings.localSovits.referenceLanguage,
    volume: settings.voiceVolume,
    fadeIn: settings.voiceFadeInEnabled,
    fadeOut: settings.voiceFadeOutEnabled,
    timeoutSeconds: settings.ttsTimeoutSeconds
  });
}

export async function loadLocalSovitsWeights(settings: AppSettings) {
  if (!settings.localSovits.gptWeight || !settings.localSovits.sovitsWeight) throw new Error("请填写 GPT 和 SoVITS 权重路径。");
  await invoke("load_sovits_weights", { endpoint: settings.voice.endpoint, gptWeight: settings.localSovits.gptWeight, sovitsWeight: settings.localSovits.sovitsWeight });
}

export async function waitForLocalSovits(settings: AppSettings, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await invoke<boolean>("sovits_is_ready", { endpoint: settings.voice.endpoint })) return;
    } catch {
      // model is still loading
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("GPT-SoVITS 启动超时：请检查显卡显存、模型文件和启动日志。");
}
