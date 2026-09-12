import { describe, expect, it } from "vitest";
import { GameObservation } from "../types";
import { bypassesTopicCooldown, captureDelayMs, gameGenre, gameGuidance, gameModeState, gamePhase, isLikelyGame, nextCaptureWaitMs, remember, sanitizeObservationForContext, shouldSpeak, speechTopic, topicCooldownMs, topicCooldownRemainingMs } from "./game";

const observation = (key: string, eventType: GameObservation["eventType"] = "none", shouldSpeakFlag = true): GameObservation => ({
  capturedAt: "now",
  window: { title: "Game", processName: "game.exe" },
  ocrText: "",
  sceneKind: "game",
  summary: "state",
  visibleFacts: ["visible"],
  situation: "state",
  eventType,
  confidence: eventType === "none" ? 0.3 : 0.9,
  changeKey: key,
  recommendation: "move",
  reason: "safe",
  shouldSpeak: shouldSpeakFlag,
  advice: "move"
});

describe("game reply policy", () => {
  it("keeps a rolling twelve-frame history", () => {
    let items: GameObservation[] = [];
    for (let i = 0; i < 15; i++) items = remember(items, observation(String(i)));
    expect(items).toHaveLength(12);
    expect(items[0].changeKey).toBe("3");
  });

  it("only speaks for meaningful low-frequency observations", () => {
    expect(shouldSpeak("low", observation("same"), [observation("same")], Date.now())).toBe(false);
    expect(shouldSpeak("low", observation("loot", "loot"), [], Date.now())).toBe(true);
  });

  it("uses high frequency as one analyzed frame, one reply when text exists", () => {
    expect(shouldSpeak("high", observation("idle", "none", false), [], 0)).toBe(true);
  });

  it("does not speak parse-error observations even on high frequency", () => {
    const broken = { ...observation("parse-error"), confidence: 0, summary: "模型返回格式异常，已跳过本次播报", situation: "", recommendation: "", advice: "", shouldSpeak: false };
    expect(shouldSpeak("high", broken, [], 0)).toBe(false);
  });

  it("respects repeated cooldown", () => {
    expect(shouldSpeak("high", observation("same"), [], Date.now(), "same", 30000)).toBe(false);
  });

  it("uses comment cooldown as a global minimum speaking interval", () => {
    expect(shouldSpeak("high", observation("new-key"), [], Date.now() - 5000, "old-key", 20000)).toBe(false);
  });

  it("suppresses near-duplicate advice even when change keys differ", () => {
    const previous = { ...observation("economy-a"), recommendation: "继续补农民采矿", advice: "继续补农民采矿" };
    const next = { ...observation("economy-b"), recommendation: "建议继续补农民采矿。", advice: "建议继续补农民采矿。" };
    expect(shouldSpeak("normal", next, [previous], 0, "", 0)).toBe(false);
  });

  it("does not use low frequency as every-sample speaking", () => {
    const quiet = observation("quiet", "none");
    expect(shouldSpeak("low", quiet, [], Date.now() - 20000, "", 20000)).toBe(false);
  });

  it("uses game-mode-off as omniscient companion mode for media/chat/work scenes", () => {
    const media = {
      ...observation("anime-shot", "none", false),
      sceneKind: "media" as const,
      confidence: 0.7,
      summary: "角色正在对峙",
      situation: "像是剧情转折前的铺垫",
      recommendation: "这个镜头气氛压下来了，可能要转折。"
    };
    expect(shouldSpeak("normal", media, [], 0, "", 0, false)).toBe(false);
    expect(shouldSpeak("normal", media, [], 0, "", 0, true)).toBe(true);
  });

  it("classifies repeat-prone strategy topics", () => {
    expect(speechTopic({ ...observation("eco"), recommendation: "继续补农民采矿" })).toBe("rts-economy");
    expect(speechTopic({ ...observation("cover"), recommendation: "找掩体恢复血量" })).toBe("fps-health");
    expect(speechTopic({ ...observation("weather"), sceneKind: "media", eventType: "none", recommendation: "注意强对流预警，合理安排行程。" })).toBe("");
  });

  it("separates game sampling from reply frequency", () => {
    const settings = { gameAwarenessEnabled: true, gameModeEnabled: true, gameModeAuto: true, captureRate: "high" } as const;
    expect(gameModeState(settings as never, { imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "Titanfall 2", processName: "game.exe" } })).toBe("auto");
    expect(captureDelayMs(settings as never, true)).toBe(3000);
    expect(captureDelayMs({ ...settings, gameAwarenessEnabled: false, gameModeEnabled: false } as never, false)).toBe(5000);
  });

  it("slows capture intervals in low spec mode", () => {
    const settings = { lowSpecMode: true, gameAwarenessEnabled: true, gameModeAuto: true, captureRate: "high" } as const;
    expect(captureDelayMs(settings as never, true)).toBe(8000);
    expect(captureDelayMs({ ...settings, gameAwarenessEnabled: false } as never, false)).toBe(10000);
    expect(captureDelayMs({ ...settings, captureRate: "low", gameAwarenessEnabled: false } as never, false)).toBe(25000);
  });

  it("does not restart automatic capture immediately after state refreshes", () => {
    expect(nextCaptureWaitMs(0, 20000, 100000)).toBe(300);
    expect(nextCaptureWaitMs(100000, 20000, 105000)).toBe(15000);
    expect(nextCaptureWaitMs(100000, 20000, 130000)).toBe(500);
  });

  it("uses reply-frequency specific topic cooldowns", () => {
    expect(topicCooldownMs("high")).toBe(45000);
    expect(topicCooldownMs("normal")).toBe(90000);
    expect(topicCooldownMs("low")).toBe(180000);
    expect(topicCooldownRemainingMs("rts-economy", 100000, "normal", 130000)).toBe(60000);
  });

  it("lets key events bypass topic cooldown while global cooldown remains separate", () => {
    expect(bypassesTopicCooldown(observation("combat", "combat"))).toBe(true);
    expect(bypassesTopicCooldown(observation("risk", "risk"))).toBe(true);
    expect(bypassesTopicCooldown(observation("eco", "none"))).toBe(false);
    expect(shouldSpeak("normal", observation("combat", "combat"), [], Date.now(), "", 20000)).toBe(false);
  });

  it("treats RTS titles as games for automatic game mode", () => {
    expect(isLikelyGame({ imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "StarCraft II", processName: "SC2_x64.exe" } })).toBe(true);
  });

  it("classifies common game genres for tailored guidance", () => {
    expect(gameGenre({ imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "StarCraft II", processName: "SC2_x64.exe" } })).toBe("rts");
    expect(gameGenre({ imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "Titanfall 2", processName: "game.exe" } })).toBe("shooter");
    expect(gameGenre({ imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "Escape From Tarkov", processName: "tarkov.exe" } })).toBe("extraction");
    expect(gameGenre({ imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "Forza Horizon", processName: "forza.exe" } })).toBe("racing");
    expect(gameGuidance({ imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "Cities: Skylines", processName: "cities.exe" } })).toContain("资源瓶颈");
  });

  it("classifies RTS phases for predictive coaching", () => {
    expect(gamePhase({ imageDataUrl: "", ocrText: "开局 主基地 农民 补给站", capturedAt: "now", window: { title: "StarCraft II", processName: "SC2_x64.exe" } })).toBe("opening");
    expect(gamePhase({ imageDataUrl: "", ocrText: "侦查 二矿 兵营 科技建筑", capturedAt: "now", window: { title: "StarCraft II", processName: "SC2_x64.exe" } })).toBe("early");
    expect(gamePhase({ imageDataUrl: "", ocrText: "中期 科技 升级 多线 地图控制", capturedAt: "now", window: { title: "StarCraft II", processName: "SC2_x64.exe" } })).toBe("mid");
    expect(gamePhase({ imageDataUrl: "", ocrText: "满人口 200 决战 大后期", capturedAt: "now", window: { title: "StarCraft II", processName: "SC2_x64.exe" } })).toBe("late");
    expect(gamePhase({ imageDataUrl: "", ocrText: "胜利 结算 统计", capturedAt: "now", window: { title: "StarCraft II", processName: "SC2_x64.exe" } })).toBe("result");
  });

  it("filters shooter advice in RTS contexts even when game mode is off", () => {
    const context = { imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "StarCraft II", processName: "SC2_x64.exe" } };
    const filtered = sanitizeObservationForContext(context, { ...observation("bad-advice"), recommendation: "先找掩体恢复血量", situation: "运营阶段", reason: "血量较低" });
    expect(filtered.shouldSpeak).toBe(false);
    expect(filtered.confidence).toBe(0);
    expect(filtered.recommendation).toBe("");
  });

  it("filters cross-genre advice in shooter, racing, and sim contexts", () => {
    const shooter = { imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "Titanfall 2", processName: "game.exe" } };
    expect(sanitizeObservationForContext(shooter, { ...observation("bad-shooter"), recommendation: "继续补农民采矿" }).shouldSpeak).toBe(false);

    const racing = { imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "Forza Horizon", processName: "forza.exe" } };
    expect(sanitizeObservationForContext(racing, { ...observation("bad-racing"), recommendation: "找掩体恢复血量" }).shouldSpeak).toBe(false);

    const sim = { imageDataUrl: "", ocrText: "", capturedAt: "now", window: { title: "Cities: Skylines", processName: "cities.exe" } };
    expect(sanitizeObservationForContext(sim, { ...observation("bad-sim"), recommendation: "注意弹药，找掩体换弹" }).shouldSpeak).toBe(false);
  });
});
