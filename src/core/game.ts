import { AppSettings, GameGenre, GameObservation, GamePhase, ReplyFrequency, ScreenContext } from "../types";

export const HISTORY_LIMIT = 12;

const GAME_WORDS = /steam|game|unity|unreal|tarkov|escape|titanfall|gta|cs2|valorant|launcher/i;
const RTS_WORDS = /starcraft|sc2|warcraft|age of empires|aoe|red alert|command.*conquer|星际|争霸|魔兽/i;
const SHOOTER_WORDS = /titanfall|cs2|counter-strike|valorant|apex|battlefield|call of duty|cod|overwatch|helldivers|泰坦陨落|战地|守望/i;
const EXTRACTION_WORDS = /tarkov|escape from tarkov|arena breakout|gray zone|dayz|pubg|逃离塔科夫|暗区|搜打撤|撤离/i;
const RPG_WORDS = /elden ring|baldur|diablo|cyberpunk|witcher|skyrim|fallout|monster hunter|原神|崩坏|赛博朋克|巫师|暗黑|怪物猎人/i;
const RACING_WORDS = /forza|assetto|f1|racing|dirt|need for speed|euro truck|american truck|地平线|赛车|卡车|竞速/i;
const SIM_WORDS = /cities|skylines|rimworld|factorio|satisfactory|civilization|stellaris|paradox|simcity|城市天际线|文明|群星|环世界|异星工厂|戴森球/i;
const MOBA_WORDS = /league of legends|dota|王者荣耀|英雄联盟|刀塔/i;
const WORK_WORDS = /excel|word|wps|office|sheet|spreadsheet|form|chrome|edge|browser|notion|飞书|钉钉|腾讯文档/i;

export function isLikelyGame(context: ScreenContext) {
  const text = `${context.window.title} ${context.window.processName} ${context.ocrText}`;
  return GAME_WORDS.test(text) || RTS_WORDS.test(text);
}

export function isLikelyRts(context: ScreenContext) {
  return RTS_WORDS.test(`${context.window.title} ${context.window.processName} ${context.ocrText}`);
}

export function gameGenre(context: ScreenContext): GameGenre {
  const text = `${context.window.title} ${context.window.processName} ${context.ocrText}`;
  if (RTS_WORDS.test(text)) return "rts";
  if (EXTRACTION_WORDS.test(text)) return "extraction";
  if (SHOOTER_WORDS.test(text)) return "shooter";
  if (RPG_WORDS.test(text)) return "rpg";
  if (RACING_WORDS.test(text)) return "racing";
  if (SIM_WORDS.test(text)) return "sim";
  if (MOBA_WORDS.test(text)) return "moba";
  return "general";
}

export function gameGuidance(context: ScreenContext) {
  switch (gameGenre(context)) {
    case "rts":
      return "游戏类型疑似 RTS/战略：必须判断阶段 opening/early/mid/late/menu/result；优先看经济、农民/矿工、补给、产能、科技、侦查、扩张、编队、多线、对手可见单位/建筑和交战时机；建议要包含未来 30~90 秒 nextPlan，不要只说继续挖矿；不要套用掩体/血量建议，除非画面明确是单位交火和单位状态。";
    case "extraction":
      return "游戏类型疑似撤离/生存搜刮：优先看撤离安全、背包负重、弹药/医疗、声音风险、路线、战利品取舍；不要编造物价和隐藏敌人。";
    case "shooter":
      return "游戏类型疑似射击/动作：优先看掩体、角度、血量/护盾、弹药、敌人方向、换位和交火节奏；不要给采矿/补给人口/建造产能建议。";
    case "rpg":
      return "游戏类型疑似 RPG/开放世界：优先看任务目标、技能/装备、背包整理、消耗品、敌我状态和探索路线；不要编造未显示的任务攻略。";
    case "racing":
      return "游戏类型疑似驾驶/竞速：优先看路线、刹车点、入弯出弯、车损、速度、排名和失误恢复；不要说掩体、采矿或背包装备。";
    case "sim":
      return "游戏类型疑似模拟/建造/大战略：优先看资源瓶颈、生产链、人口/财政、规划、扩张、风险提示和下一步建设；不要说血量、掩体或枪线。";
    case "moba":
      return "游戏类型疑似 MOBA：优先看兵线、视野、技能冷却、血量蓝量、站位、团战/带线/回城时机；不要说采矿或建造产能。";
    default:
      return "未知游戏类型：先根据画面判断是战斗、搜刮、菜单、结算、驾驶、建造还是任务场景；只给可见信息支持的通用建议。";
  }
}

export function gamePhase(context: ScreenContext, observation?: Pick<GameObservation, "summary" | "situation" | "eventType" | "recommendation">): GamePhase {
  const text = `${context.window.title} ${context.window.processName} ${context.ocrText} ${observation?.summary || ""} ${observation?.situation || ""} ${observation?.eventType || ""} ${observation?.recommendation || ""}`.toLowerCase();
  if (/result|victory|defeat|score|结算|胜利|失败|战绩|统计|排名|奖励/.test(text)) return "result";
  if (/menu|setting|lobby|开始游戏|载入|选项|菜单|大厅|匹配|队列/.test(text)) return "menu";
  if (/开局|opening|初始|基地|主基地|农民|scv|probe|drone|工蜂|探机|探针|第.?一|补给站|水晶塔/.test(text)) return "opening";
  if (/前期|early|侦查|探路|二矿|扩张|兵营|气矿|瓦斯|科技建筑|首个|开矿/.test(text)) return "early";
  if (/中期|mid|科技|升级|三矿|多线|空投|推进|压制|地图控制|会战|兵种克制/.test(text)) return "mid";
  if (/后期|late|满人口|200|决战|终极|高阶|转型|大后期|四矿|五矿|航母|大和|雷兽|母舰/.test(text)) return "late";
  return "unknown";
}

export function remember(history: GameObservation[], observation: GameObservation) {
  return [...history, observation].slice(-HISTORY_LIMIT);
}

export function recentSummary(history: GameObservation[]) {
  return history.slice(-4).map((item) =>
    `${item.sceneKind}/${item.eventType}:${item.situation || item.summary}; 建议:${item.recommendation || item.advice || "无"}`
  ).join(" | ");
}

export function isRoundBoundary(observation?: Partial<Pick<GameObservation, "gamePhase" | "eventType" | "sceneKind" | "changeKey" | "summary" | "situation">>) {
  if (!observation) return false;
  const text = `${observation.gamePhase || ""} ${observation.eventType || ""} ${observation.sceneKind || ""} ${observation.changeKey || ""} ${observation.summary || ""} ${observation.situation || ""}`.toLowerCase();
  return observation.gamePhase === "menu"
    || observation.gamePhase === "result"
    || observation.eventType === "result"
    || /menu|lobby|setting|result|victory|defeat|score|stats|结算|胜利|失败|菜单|大厅|设置|匹配|得分|战绩/.test(text);
}

export function isNewRoundStart(observation: Pick<GameObservation, "gamePhase" | "eventType" | "changeKey" | "summary" | "situation">, previous?: Pick<GameObservation, "gamePhase" | "eventType" | "changeKey" | "summary" | "situation">) {
  if (!previous) return false;
  const phase = observation.gamePhase;
  const text = `${phase || ""} ${observation.eventType || ""} ${observation.changeKey || ""} ${observation.summary || ""} ${observation.situation || ""}`.toLowerCase();
  const starts = phase === "opening" || phase === "early" || /opening|start|new match|开局|新局|出生|第一波|初始/.test(text);
  return starts && isRoundBoundary(previous);
}

export function recentSessionSummary(history: GameObservation[]) {
  let boundaryIndex = -1;
  for (let index = history.length - 1; index >= 0; index--) {
    if (isRoundBoundary(history[index])) {
      boundaryIndex = index;
      break;
    }
  }
  const currentRound = boundaryIndex >= 0 ? history.slice(boundaryIndex + 1) : history;
  if (currentRound.length === 0 && boundaryIndex >= 0) return "上一局已经结束或当前在菜单；不要继承上一局的扩张、兵种、敌情和战术计划。";
  return recentSummary(currentRound.length ? currentRound : history);
}

export function rememberInCurrentRound(history: GameObservation[], observation: GameObservation) {
  const previous = history.at(-1);
  if (isNewRoundStart(observation, previous)) return [observation];
  if (isRoundBoundary(observation)) return [observation];
  const activeHistory = isRoundBoundary(previous) ? [] : history;
  return remember(activeHistory, observation);
}

export function gameModeState(settings: AppSettings, context: ScreenContext): "off" | "auto" | "manual" {
  if (!settings.gameAwarenessEnabled) return "off";
  if (!settings.gameModeAuto) return "manual";
  return isLikelyGame(context) ? "auto" : "off";
}

export function captureDelayMs(settings: AppSettings, gameActive: boolean) {
  if (settings.lowSpecMode) {
    if (settings.gameAwarenessEnabled && (!settings.gameModeAuto || gameActive)) return 8000;
    return settings.captureRate === "high" ? 10000 : 25000;
  }
  if (settings.gameAwarenessEnabled && (!settings.gameModeAuto || gameActive)) return 3000;
  return settings.captureRate === "high" ? 5000 : 20000;
}

export function nextCaptureWaitMs(lastStartedAt: number, delayMs: number, nowMs = Date.now()) {
  if (!lastStartedAt) return 300;
  return Math.max(500, delayMs - (nowMs - lastStartedAt));
}

export function shouldSpeak(
  frequency: ReplyFrequency,
  observation: GameObservation,
  history: GameObservation[],
  lastSpokenAt: number,
  lastSpokenKey = "",
  minCooldownMs = 0,
  omniscientMode = false
) {
  const previous = history.at(-1);
  const changed = !previous || previous.changeKey !== observation.changeKey;
  const recentDuplicate = history.slice(-4).some((item) => sameAdvice(item, observation));
  const repeatedRecently = lastSpokenKey === observation.changeKey && Date.now() - lastSpokenAt < Math.max(10000, minCooldownMs);
  const globallyCoolingDown = lastSpokenAt > 0 && Date.now() - lastSpokenAt < minCooldownMs;
  const keyEvent = observation.eventType !== "none" && observation.confidence >= 0.65;
  const highlightEvent = observation.eventType === "highlight" && observation.confidence >= 0.55;
  const workEvent = ["form", "spreadsheet"].includes(observation.eventType) && observation.confidence >= 0.55;
  const modelWantsToSpeak = observation.shouldSpeak !== false && Boolean(observation.recommendation || observation.advice || observation.situation);
  const hasAnyUsefulText = Boolean(observation.recommendation || observation.advice || observation.situation || (observation.summary && observation.confidence > 0));
  const omniscientScene = ["media", "chat", "work"].includes(observation.sceneKind);
  const omniscientWantsToSpeak = omniscientMode && omniscientScene && hasAnyUsefulText && observation.confidence >= 0.35;
  const silentFor = Date.now() - lastSpokenAt;

  if (globallyCoolingDown || repeatedRecently || recentDuplicate) return false;
  if (frequency === "high") return hasAnyUsefulText;
  if (frequency === "normal") return (modelWantsToSpeak && (highlightEvent || keyEvent || workEvent || changed || silentFor >= 60000)) || (omniscientWantsToSpeak && (changed || silentFor >= Math.max(30000, minCooldownMs)));
  return (modelWantsToSpeak && (highlightEvent || ((keyEvent || workEvent) && observation.confidence >= 0.8) || silentFor >= 180000)) || (omniscientWantsToSpeak && (changed || silentFor >= Math.max(90000, minCooldownMs)));
}

export function topicCooldownMs(frequency: ReplyFrequency) {
  if (frequency === "high") return 45000;
  if (frequency === "normal") return 90000;
  return 180000;
}

export function bypassesTopicCooldown(observation: Pick<GameObservation, "eventType">) {
  return ["combat", "highlight", "risk", "result"].includes(observation.eventType);
}

export function topicCooldownRemainingMs(topic: string, lastTopicAt: number | undefined, frequency: ReplyFrequency, nowMs = Date.now()) {
  if (!topic || !lastTopicAt) return 0;
  return Math.max(0, topicCooldownMs(frequency) - (nowMs - lastTopicAt));
}

export function speechTopic(observation: GameObservation) {
  if (observation.sceneKind !== "game") return observation.eventType !== "none" ? `${observation.sceneKind}-${observation.eventType}` : "";
  const text = `${observation.sceneKind} ${observation.eventType} ${observation.summary} ${observation.situation} ${observation.recommendation} ${observation.reason} ${observation.advice}`.toLowerCase();
  if (/采矿|挖矿|矿工|农民|工蜂|探机|探针|scv|经济|水晶矿|气矿|瓦斯|gas|worker|economy/.test(text)) return "rts-economy";
  if (/补给|人口|房子|水晶塔|领主|supply|pylon|overlord/.test(text)) return "rts-supply";
  if (/侦查|探路|视野|雷达|扫描|scout|vision/.test(text)) return "rts-scout";
  if (/扩张|二矿|三矿|开矿|基地|分矿|expand|expansion/.test(text)) return "rts-expand";
  if (/兵营|产能|科技|升级|编队|兵种|建造|production|tech|upgrade/.test(text)) return "rts-production";
  if (/血量|残血|低血|回血|生命值|health|hp/.test(text)) return "fps-health";
  if (/掩体|掩护|找掩体|找掩护|cover/.test(text)) return "fps-cover";
  if (/角度|枪线|换位|弹药|护盾|敌人|交火|reload|ammo|shield|angle/.test(text)) return "shooter-combat";
  if (/战利品|背包|装备|物品|loot|inventory/.test(text)) return "loot";
  if (/撤离|撤退|负重|医疗|止血|路线|extract|extraction|weight|med/.test(text)) return "extraction-survival";
  if (/刹车|入弯|出弯|车损|速度|排名|路线|brake|corner|speed|race/.test(text)) return "racing";
  if (/财政|人口|生产链|电力|道路|规划|建设|资源瓶颈|build|city|factory/.test(text)) return "sim-build";
  if (/兵线|视野|技能|冷却|团战|带线|回城|gank|lane|cooldown/.test(text)) return "moba";
  return "";
}

export function sanitizeObservationForContext(context: ScreenContext, observation: GameObservation): GameObservation {
  const genre = gameGenre(context);
  const phase = observation.gamePhase || gamePhase(context, observation);
  const text = `${observation.recommendation} ${observation.situation} ${observation.reason}`;
  const unsupportedSpecificExpansion = genre === "rts"
    && /[二两三四五六七八九十]\s*(矿|基地|分矿|资源点)|第\s*[二两三四五六七八九十]\s*(个)?\s*(矿|基地|分矿|资源点)|second|third|fourth|fifth|sixth|seventh|eighth|ninth/i.test(text)
    && !/[二两三四五六七八九十]\s*(矿|基地|分矿|资源点)|第\s*[二两三四五六七八九十]\s*(个)?\s*(矿|基地|分矿|资源点)|second|third|fourth|fifth|sixth|seventh|eighth|ninth/i.test(context.ocrText);
  const badForRts = /血量|残血|低血|回血|掩体|掩护|找掩护|找掩体|cover|health|hp/i;
  const badForShooter = /采矿|挖矿|矿工|农民|工蜂|探机|补给|人口|水晶塔|产能|开矿|分矿|worker|supply|pylon|economy/i;
  const badForRacing = /掩体|掩护|血量|背包|战利品|采矿|补给|cover|health|loot|inventory|worker|supply/i;
  const badForSim = /掩体|掩护|找掩体|枪线|血量|残血|弹药|换弹|cover|health|ammo|reload/i;
  let reason = "";
  if (genre === "rts" && badForRts.test(text)) reason = "RTS 场景过滤了射击游戏建议";
  if (genre === "shooter" && badForShooter.test(text)) reason = "射击场景过滤了战略建造建议";
  if (genre === "racing" && badForRacing.test(text)) reason = "竞速场景过滤了无关游戏建议";
  if (genre === "sim" && badForSim.test(text)) reason = "模拟建造场景过滤了战斗建议";
  if (unsupportedSpecificExpansion) {
    return {
      ...observation,
      gameGenre: observation.gameGenre || genre,
      gamePhase: phase,
      recommendation: "先确认经济、侦查和产能，再决定扩张或转科技。",
      advice: "先确认经济、侦查和产能，再决定扩张或转科技。",
      reason: "画面证据不足，避免乱报资源点数量",
      shouldSpeak: observation.shouldSpeak,
      confidence: Math.min(observation.confidence, 0.65),
      changeKey: `rts-safe-plan:${phase}:${observation.eventType}`
    };
  }
  if (!reason) return observation;
  return {
    ...observation,
    gameGenre: observation.gameGenre || genre,
    gamePhase: phase,
    recommendation: "",
    advice: "",
    reason,
    shouldSpeak: false,
    confidence: 0,
    changeKey: `filtered-${genre}:${context.window.title}:${context.capturedAt}`
  };
}

function sameAdvice(a: GameObservation, b: GameObservation) {
  const left = normalizeAdvice(a.recommendation || a.advice || a.situation);
  const right = normalizeAdvice(b.recommendation || b.advice || b.situation);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function normalizeAdvice(value: string) {
  return value
    .replace(/[，。！？、,.!?;；：:\s]/g, "")
    .replace(/你可以|建议|注意|继续|当前|画面|界面|页面/g, "")
    .slice(0, 28);
}

export function fallbackObservation(context: ScreenContext): GameObservation {
  const text = `${context.window.title} ${context.window.processName} ${context.ocrText}`;
  const isWork = WORK_WORDS.test(text);
  return {
    capturedAt: context.capturedAt,
    window: context.window,
    ocrText: context.ocrText,
    sceneKind: isLikelyGame(context) ? "game" : isWork ? "work" : "unknown",
    summary: "画面状态已记录",
    visibleFacts: [],
    situation: "暂未识别到明确可行动作",
    eventType: "none",
    confidence: 0,
    changeKey: `${context.window.title}:${context.ocrText.slice(0, 80)}`,
    recommendation: "",
    reason: "",
    shouldSpeak: false,
    advice: "",
    gameGenre: gameGenre(context),
    gamePhase: gamePhase(context),
    opponentRead: "",
    nextPlan: "",
    speakReason: "fallback"
  };
}
