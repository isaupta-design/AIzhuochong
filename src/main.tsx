import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { analyzeGameFrame, askModel, applyPreset, loadLocalSovitsWeights, synthesize, waitForLocalSovits } from "./core/providers";
import { captureScreen, lightScreenCheck } from "./core/screen";
import { memoryPrompt, rememberExplicitFact } from "./core/memory";
import { appendDiagnostic, DiagnosticLog, formatDiagnostics, sanitizeLogText } from "./core/diagnostics";
import { PERSONAS, personaById } from "./core/personas";
import { exportSettings, loadSettings, saveSettings } from "./core/settings";
import { addBtCompanionLine } from "./core/btCompanion";
import { addBundleFromCurrent, applyBundle, deleteBundle, importPresetJson } from "./core/presetProfiles";
import { canStartSpeechInput, configureSpeechHotkey, deleteRecordedAudio, getSpeechApiKey, playBuiltinPttCue, postVoiceBlockedUntil, setSpeechApiKey, startRecordingCommand, stopRecordingCommand, transcribeAudio } from "./core/speech";
import { AppSettings, ChatMessage, GameObservation, LightScreenCheck, SpeakingPanelState, SpeechRuntimeState, VoiceBarsMode, VoiceEngine } from "./types";
import { bypassesTopicCooldown, captureDelayMs, gameGenre, gameModeState, nextCaptureWaitMs, recentSessionSummary, rememberInCurrentRound, shouldSpeak, speechTopic, topicCooldownMs, topicCooldownRemainingMs } from "./core/game";
import { decideSmartObservation, effectiveSmartModelMinIntervalMs, rememberSmartScene, smartLocalCheckIntervalMs, smartOcrIntervalMs } from "./core/smart";
import "./style.css";
import btCommPanel from "./assets/bt-7274-comm.png";
import { GuguPet, PetPointer } from "./components/GuguPet";

const spokenVoiceText = (answer: string, readParentheticals: boolean, maxChars = 100) => {
  const text = readParentheticals
    ? answer
    : answer.replace(/（[^）]{1,120}）/g, "").replace(/\([^)]{1,120}\)/g, "");
  return text.replace(/\s+/g, " ").trim().slice(0, Math.max(8, maxChars));
};

const characterLine = (answer: string, observation: GameObservation, activeSettings: AppSettings) => {
  if (activeSettings.selectedPreset !== "bt" || observation.sceneKind !== "game") return answer;
  if (/铁驭|搭档|我在|别急|稳住|收到/.test(answer)) return answer;
  const tail = observation.eventType === "combat" || observation.eventType === "risk"
    ? "，铁驭，稳住，我在看着侧翼。"
    : "，搭档，我会继续监控局势。";
  return `${answer}${tail}`;
};

const now = () => new Date().toISOString();
const keepRecentMessages = (items: ChatMessage[]) => items.slice(-30);
const voiceText = (answer: string) => answer.replace(/（[^）]{1,60}）/g, "").replace(/\([^)]{1,80}\)/g, "").trim().slice(0, 80);

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), ms); })
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const voiceOverlaySize = { width: 340, height: 190 };
const subtitleOverlaySize = { width: 1000, height: 120 };
const SUBTITLE_STATE_KEY = "desktop-pet-subtitle-state";
const defaultVoiceLevels = () => [0.18, 0.45, 0.72, 0.55, 0.86, 0.62, 0.34, 0.76, 0.5, 0.28, 0.66, 0.42];
const SPEECH_HOTKEYS = [
  { label: "F8", vk: 119 },
  { label: "F9", vk: 120 },
  { label: "F10", vk: 121 },
  { label: "F11", vk: 122 },
  { label: "F12", vk: 123 },
  { label: "CapsLock", vk: 20 }
];

async function positionVoiceOverlay(window: WebviewWindow) {
  const monitor = await currentMonitor();
  if (!monitor) return;
  const workPosition = monitor.workArea.position.toLogical(monitor.scaleFactor);
  const workSize = monitor.workArea.size.toLogical(monitor.scaleFactor);
  const x = workPosition.x + workSize.width - voiceOverlaySize.width - 42;
  const y = workPosition.y + Math.max(70, Math.round(workSize.height * 0.16));
  await window.setSize(new LogicalSize(voiceOverlaySize.width, voiceOverlaySize.height));
  await window.setPosition(new LogicalPosition(Math.max(workPosition.x, x), Math.max(workPosition.y, y)));
}

async function positionSubtitleOverlay(window: WebviewWindow) {
  const monitor = await currentMonitor();
  if (!monitor) return;
  const workPosition = monitor.workArea.position.toLogical(monitor.scaleFactor);
  const workSize = monitor.workArea.size.toLogical(monitor.scaleFactor);
  const width = Math.min(subtitleOverlaySize.width, Math.max(520, workSize.width - 140));
  const x = workPosition.x + Math.round((workSize.width - width) / 2);
  const y = workPosition.y + Math.max(16, Math.round(workSize.height * 0.035));
  await window.setSize(new LogicalSize(width, subtitleOverlaySize.height));
  await window.setPosition(new LogicalPosition(Math.max(workPosition.x, x), Math.max(workPosition.y, y)));
}

type OverlayWindowLike = {
  setIgnoreCursorEvents: (ignore: boolean) => Promise<void>;
  setSize: (size: LogicalSize) => Promise<void>;
  setPosition: (position: LogicalPosition) => Promise<void>;
  hide: () => Promise<void>;
};

async function parkOverlayWindow(window: OverlayWindowLike | null) {
  if (!window) return;
  await window.setIgnoreCursorEvents(true).catch(() => undefined);
  await window.setSize(new LogicalSize(1, 1)).catch(() => undefined);
  await window.setPosition(new LogicalPosition(-32000, -32000)).catch(() => undefined);
  await window.hide().catch(() => undefined);
}

async function showVoiceOverlay(payload: SpeakingPanelState) {
  const overlay = await WebviewWindow.getByLabel("voice_overlay");
  if (!overlay) return;
  await overlay.setAlwaysOnTop(true).catch(() => undefined);
  await overlay.setSkipTaskbar(true).catch(() => undefined);
  await overlay.setIgnoreCursorEvents(true).catch(() => undefined);
  await positionVoiceOverlay(overlay).catch(() => undefined);
  await emitTo("voice_overlay", "voice-overlay-show", payload);
  await invoke("show_voice_overlay_no_activate", { label: "voice_overlay" }).catch(() => overlay.show());
  await overlay.setIgnoreCursorEvents(true).catch(() => undefined);
}

async function showSubtitleOverlay(payload: SpeakingPanelState) {
  const overlay = await WebviewWindow.getByLabel("subtitle_overlay");
  if (!overlay) throw new Error("subtitle_overlay_not_found");
  localStorage.setItem(SUBTITLE_STATE_KEY, JSON.stringify({ ...payload, visible: true, expiresAt: Date.now() + Math.max(2500, payload.durationMs + 1500) }));
  await overlay.setAlwaysOnTop(true).catch(() => undefined);
  await overlay.setSkipTaskbar(true).catch(() => undefined);
  await overlay.setIgnoreCursorEvents(true).catch(() => undefined);
  await positionSubtitleOverlay(overlay).catch(() => undefined);
  await invoke("show_voice_overlay_no_activate", { label: "subtitle_overlay" }).catch(() => overlay.show());
  await wait(80);
  await emitTo("subtitle_overlay", "voice-subtitle-show", payload);
  await wait(80);
  await emitTo("subtitle_overlay", "voice-subtitle-show", payload).catch(() => undefined);
  await overlay.setIgnoreCursorEvents(true).catch(() => undefined);
}

async function concealMainWindow() {
  const window = getCurrentWindow();
  const monitor = await currentMonitor();
  await window.setSkipTaskbar(true).catch(() => undefined);
  if (monitor) {
    const position = monitor.workArea.position.toLogical(monitor.scaleFactor);
    await window.setPosition(new LogicalPosition(position.x - 2000, position.y - 2000)).catch(() => undefined);
  } else {
    await window.setPosition(new LogicalPosition(-2000, -2000)).catch(() => undefined);
  }
}

async function openSettingsWindow() {
  let window = await WebviewWindow.getByLabel("settings");
  if (!window) {
    window = new WebviewWindow("settings", {
      url: "index.html?overlay=settings",
      title: "AI 桌宠设置中心",
      width: 940,
      height: 720,
      resizable: true,
      visible: true
    });
  }
  await window.setTitle("AI 桌宠设置中心").catch(() => undefined);
  await window.unminimize().catch(() => undefined);
  await window.show().catch(() => undefined);
  await window.setFocus().catch(() => undefined);
}

async function restoreMainWindow() {
  const window = getCurrentWindow();
  const monitor = await currentMonitor();
  if (monitor) {
    const position = monitor.workArea.position.toLogical(monitor.scaleFactor);
    await window.setPosition(new LogicalPosition(position.x + 40, position.y + 70)).catch(() => undefined);
  }
  await window.setSkipTaskbar(false).catch(() => undefined);
  await window.show().catch(() => undefined);
  await window.setFocus().catch(() => undefined);
}

async function hideVoiceOverlay() {
  await emitTo("voice_overlay", "voice-overlay-hide").catch(() => undefined);
  const overlay = await WebviewWindow.getByLabel("voice_overlay");
  await parkOverlayWindow(overlay);
  localStorage.removeItem(SUBTITLE_STATE_KEY);
  await emitTo("subtitle_overlay", "voice-subtitle-hide").catch(() => undefined);
  const subtitle = await WebviewWindow.getByLabel("subtitle_overlay");
  await parkOverlayWindow(subtitle);
}

function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [bubble, setBubble] = useState("我来陪你啦。");
  const [status, setStatus] = useState("待命");
  const [open, setOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticLog[]>([]);
  const [gameActive, setGameActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [speakingPanel, setSpeakingPanel] = useState<SpeakingPanelState>({ visible: false, text: "", speaker: "", levels: [], startedAt: 0, durationMs: 0 });
  const [speechState, setSpeechState] = useState<SpeechRuntimeState>("idle");
  const [petPointer, setPetPointer] = useState<PetPointer | null>(null);

  const lastComment = useRef(0);
  const lastSpokenKey = useRef("");
  const busy = useRef(false);
  const observations = useRef<GameObservation[]>([]);
  const voiceBusy = useRef(false);
  const sovitsReady = useRef(false);
  const sovitsStarting = useRef<Promise<void> | null>(null);
  const voiceFailureBlockedUntil = useRef(0);
  const voiceFailureCount = useRef(0);
  const lastVoiceStarted = useRef(0);
  const lastAutoStarted = useRef(0);
  const smartLastCheck = useRef<LightScreenCheck | null>(null);
  const smartLastModelAt = useRef(0);
  const smartSceneCache = useRef<Record<string, number>>({});
  const smartLastOcrAt = useRef(0);
  const gameActiveRef = useRef(gameActive);
  const topicCooldowns = useRef<Record<string, number>>({});
  const settingsRef = useRef(settings);
  const saveTimer = useRef<number | undefined>(undefined);
  const panelTimer = useRef<number | undefined>(undefined);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const speechChunks = useRef<Blob[]>([]);
  const speechBlockedUntil = useRef(0);
  const speechStateRef = useRef<SpeechRuntimeState>("idle");
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadTimer = useRef<number | undefined>(undefined);

  const log = (message: string) => setDiagnostics((old) => appendDiagnostic(old, message));
  const running = !settings.paused && !settings.doNotDisturb;
  const showSpeakingPanel = (text: string, levels: number[], durationMs: number, failed = false) => {
    if (panelTimer.current) window.clearTimeout(panelTimer.current);
    const speaker = personaById(settingsRef.current.selectedPreset).name;
    const safeDuration = Math.max(1800, Math.min(20000, durationMs || text.length * 260));
    const payload = { visible: settingsRef.current.voicePanelEnabled || (settingsRef.current.voiceSubtitleEnabled && !failed), text, speaker, levels: levels.length ? levels : defaultVoiceLevels(), startedAt: Date.now(), durationMs: safeDuration, failed, barsMode: settingsRef.current.lowSpecMode ? "static" as const : settingsRef.current.voiceBarsMode };
    setSpeakingPanel(payload);
    if (!failed && settingsRef.current.voicePanelEnabled && settingsRef.current.voiceBarsMode === "dynamic" && levels.length <= 2) log("voice bars fallback reason=no_audio_levels mode=static");
    if (settingsRef.current.voicePanelEnabled) void showVoiceOverlay(payload);
    if (settingsRef.current.voiceSubtitleEnabled && !failed) {
      log(`subtitle show enabled=true textLen=${text.length}`);
      void showSubtitleOverlay(payload).catch((error) => log(`subtitle failed reason=${error instanceof Error ? error.message : String(error)}`));
    }
    panelTimer.current = window.setTimeout(() => {
      setSpeakingPanel((old) => ({ ...old, visible: false }));
      void hideVoiceOverlay();
    }, safeDuration + 900);
  };

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { gameActiveRef.current = gameActive; }, [gameActive]);
  useEffect(() => { speechStateRef.current = speechState; }, [speechState]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void invoke("start_pet_pointer_tracking").catch(() => undefined);
    void listen<PetPointer>("pet-pointer", (event) => setPetPointer(event.payload)).then((handler) => { unlisten = handler; });
    return () => { unlisten?.(); };
  }, []);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<AppSettings>("settings-updated", (event) => {
      settingsRef.current = event.payload;
      setSettings(event.payload);
      setStatus("设置已更新");
    }).then((handler) => { unlisten = handler; });
    return () => { unlisten?.(); };
  }, []);
  useEffect(() => { void getCurrentWindow().setSize(new LogicalSize(400, open ? 780 : 490)); }, [open]);
  useEffect(() => {
    void invoke<string | null>("get_api_key")
      .then((apiKey) => apiKey && setSettings((old) => ({ ...old, provider: { ...old.provider, apiKey } })))
      .catch(() => undefined);
    void getSpeechApiKey()
      .then((apiKey) => apiKey && setSettings((old) => ({ ...old, speech: { ...old.speech, apiKey } })))
      .catch(() => undefined);
  }, []);

  const update = (next: AppSettings) => {
    settingsRef.current = next;
    setSettings(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveSettings(next), 250);
  };

  useEffect(() => () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveSettings(settingsRef.current);
    }
    if (panelTimer.current) window.clearTimeout(panelTimer.current);
    void hideVoiceOverlay();
    if (vadTimer.current) window.clearInterval(vadTimer.current);
    void audioContextRef.current?.close();
    mediaRecorder.current?.stream.getTracks().forEach((track) => track.stop());
    mediaStream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    const pause = () => update({ ...settingsRef.current, paused: true });
    const restore = () => { void restoreMainWindow(); };
    const toggle = () => { void restoreMainWindow(); };
    window.addEventListener("desktop-pet-pause", pause);
    window.addEventListener("desktop-pet-restore", restore);
    window.addEventListener("desktop-pet-toggle", toggle);
    return () => {
      window.removeEventListener("desktop-pet-pause", pause);
      window.removeEventListener("desktop-pet-restore", restore);
      window.removeEventListener("desktop-pet-toggle", toggle);
    };
  }, []);

  const startSovits = async (activeSettings = settingsRef.current) => {
    try {
      setStatus("正在启动 GPT-SoVITS，首次加载可能需要 1 分钟…");
      await invoke("start_sovits_service", { root: activeSettings.localSovits.root });
      await waitForLocalSovits(activeSettings);
      setStatus("正在加载 BT1.0 权重…");
      await loadLocalSovitsWeights(activeSettings);
      sovitsReady.current = true;
      setStatus("GPT-SoVITS 已启动，BT1.0 权重已加载");
    } catch (error) {
      sovitsReady.current = false;
      setStatus(error instanceof Error ? error.message : "GPT-SoVITS 启动失败");
      throw error;
    }
  };

  const ensureSovits = async (activeSettings: AppSettings) => {
    if (activeSettings.voice.engine !== "gpt-sovits") return;
    if (sovitsReady.current) return;
    try {
      if (await invoke<boolean>("sovits_is_ready", { endpoint: activeSettings.voice.endpoint })) {
        sovitsReady.current = true;
        return;
      }
    } catch {
      // Continue to managed startup below.
    }
    if (!sovitsStarting.current) {
      sovitsStarting.current = startSovits(activeSettings).finally(() => { sovitsStarting.current = null; });
    }
    await sovitsStarting.current;
  };

  const speakAnswer = async (answer: string, automatic: boolean, activeSettings: AppSettings) => {
    const maxSpokenChars = activeSettings.lowSpecMode ? Math.min(activeSettings.maxSpokenChars, 24) : activeSettings.maxSpokenChars;
    const spoken = spokenVoiceText(answer, activeSettings.readParentheticals, maxSpokenChars);
    const unclipped = spokenVoiceText(answer, activeSettings.readParentheticals, 200);
    const minVoiceGap = automatic ? Math.max(activeSettings.commentCooldownSeconds * 1000, captureDelayMs(activeSettings, gameActiveRef.current), activeSettings.lowSpecMode ? 20000 : 12000) : 0;
    const voiceCoolingDown = automatic && lastVoiceStarted.current > 0 && Date.now() - lastVoiceStarted.current < minVoiceGap;
    const voiceFailureCoolingDown = automatic && Date.now() < voiceFailureBlockedUntil.current;

    if (spoken && !voiceBusy.current && !voiceCoolingDown && !voiceFailureCoolingDown) {
      lastVoiceStarted.current = Date.now();
      voiceBusy.current = true;
      setStatus("文字已回复，正在合成语音…");
      if (unclipped.length > spoken.length) log(`voice text clipped from=${unclipped.length} to=${spoken.length}`);
      log(`voice start len=${spoken.length} lowSpec=${activeSettings.lowSpecMode} maxChars=${maxSpokenChars} timeout=${activeSettings.ttsTimeoutSeconds}s`);
      void withTimeout((async () => {
        await ensureSovits(activeSettings);
        const playback = await synthesize(activeSettings, spoken);
        speechBlockedUntil.current = postVoiceBlockedUntil(playback?.durationMs || spoken.length * 260, activeSettings.speech.postVoiceListenDelaySeconds);
        showSpeakingPanel(spoken, playback?.levels || [], playback?.durationMs || 0);
      })(), Math.max(120000, (activeSettings.ttsTimeoutSeconds + 20) * 1000), `语音合成超时：GPT-SoVITS 可能卡住或正在排队（${activeSettings.ttsTimeoutSeconds}s）`)
        .then(() => {
          voiceFailureCount.current = 0;
          voiceFailureBlockedUntil.current = 0;
          log("voice ok");
          setStatus("已播放语音");
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          sovitsReady.current = false;
          voiceFailureCount.current += 1;
          const blockMs = Math.min(300000, 30000 * voiceFailureCount.current);
          voiceFailureBlockedUntil.current = Date.now() + blockMs;
          log(`voice failed reason=${detail}`);
          log(`voice disabled temporarily remaining=${Math.ceil(blockMs / 1000)}s`);
          setStatus(`文字已回复，但语音不可用：${detail}。已暂停自动语音 ${Math.ceil(blockMs / 1000)} 秒`);
        })
        .finally(() => { voiceBusy.current = false; });
    } else if (voiceBusy.current) {
      log("voice skipped reason=voice_busy");
      setStatus("文字已回复，上一条语音仍在合成，已跳过本次语音");
    } else if (voiceCoolingDown) {
      const remaining = Math.ceil((minVoiceGap - (Date.now() - lastVoiceStarted.current)) / 1000);
      log(`voice skipped reason=voice_cooldown remaining=${remaining}s`);
      setStatus("文字已回复，语音冷却中，避免连续播报");
    } else if (voiceFailureCoolingDown) {
      const remaining = Math.ceil((voiceFailureBlockedUntil.current - Date.now()) / 1000);
      log(`voice skipped reason=voice_failure_backoff remaining=${remaining}s`);
      setStatus(`文字已回复，语音服务暂不可用，${remaining} 秒后再试`);
    } else {
      setStatus("已回复文字");
    }
  };

  const startDesktopPet = async () => {
    if (starting) return;
    const activeSettings = settingsRef.current;
    setStarting(true);
    setStatus("正在启动组件，请稍候");
    log("startup begin");
    const next = { ...activeSettings, paused: false };
    update(next);
    try {
      if (next.startupVoiceCueEnabled && !next.doNotDisturb && next.voice.enabled && next.voice.engine !== "none") {
        const voiceReady = sovitsReady.current || await invoke<boolean>("sovits_is_ready", { endpoint: next.voice.endpoint }).catch(() => false);
        if (voiceReady) {
          sovitsReady.current = true;
          void speakAnswer("铁驭，程序准备完毕，正在待命。", false, next).catch((error) => {
            log(`startup voice skipped reason=${error instanceof Error ? error.message : String(error)}`);
          });
        } else {
          log("startup voice skipped reason=voice_service_not_ready");
        }
      }
      setStatus("运行中，正在待命");
      log("startup ready");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStatus(`启动完成，部分组件不可用：${detail}`);
      log(`startup partial reason=${detail}`);
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (settingsRef.current.startOnLaunch && settingsRef.current.paused) void startDesktopPet();
  }, []);

  const finishSpeechBlob = async (blob: Blob) => {
    const activeSettings = settingsRef.current;
    if (!blob.size) {
      setSpeechState(activeSettings.speech.mode === "continuous" ? "listening" : "idle");
      return;
    }
    let recordedPath = "";
    try {
      setSpeechState("transcribing");
      setStatus("正在识别语音…");
      const audioBase64 = await blobToBase64(blob);
      const recorded = await stopRecordingCommand(audioBase64, blob.type || "audio/webm");
      recordedPath = recorded.path;
      const transcript = (await transcribeAudio(activeSettings, recorded)).trim();
      log(`speech transcript bytes=${recorded.bytes} text=${transcript}`);
      if (transcript) {
        setInput(transcript);
        await respond(transcript);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log(`speech failed reason=${detail}`);
      setStatus(`语音识别失败：${detail}`);
    } finally {
      if (recordedPath) await deleteRecordedAudio(recordedPath).catch(() => undefined);
      speechChunks.current = [];
      mediaStream.current?.getTracks().forEach((track) => track.stop());
      if (vadTimer.current) window.clearInterval(vadTimer.current);
      vadTimer.current = undefined;
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      mediaStream.current = null;
      mediaRecorder.current = null;
      setSpeechState(settingsRef.current.speech.mode === "continuous" && settingsRef.current.speech.enabled ? "listening" : "idle");
    }
  };

  const startVadMonitor = (stream: MediaStream, recorder: MediaRecorder, maxMs: number) => {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, maxMs);
      return;
    }
    const context = new AudioContextCtor();
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const threshold = settingsRef.current.speech.vadThreshold;
    const startedAt = Date.now();
    let speechSeen = false;
    let lastVoiceAt = Date.now();
    vadTimer.current = window.setInterval(() => {
      if (recorder.state !== "recording") return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);
      if (rms >= threshold) {
        speechSeen = true;
        lastVoiceAt = Date.now();
      }
      const tooLong = Date.now() - startedAt >= maxMs;
      const quietAfterSpeech = speechSeen && Date.now() - lastVoiceAt >= 1200;
      if (tooLong || quietAfterSpeech) recorder.stop();
    }, 180);
  };

  const startSpeechCapture = async (autoStopMs = 0) => {
    const activeSettings = settingsRef.current;
    if (!activeSettings.speech.enabled) {
      setStatus("请先开启语音对话。");
      return;
    }
    if (!canStartSpeechInput(speechStateRef.current, voiceBusy.current, speechBlockedUntil.current)) {
      const remaining = Math.max(0, Math.ceil((speechBlockedUntil.current - Date.now()) / 1000));
      setSpeechState("blockedByVoice");
      setStatus(remaining ? `正在回复，${remaining} 秒后再听。` : "正在回复，稍后再听。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("当前环境不支持麦克风录音。");
      return;
    }
    await startRecordingCommand();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStream.current = stream;
    speechChunks.current = [];
    const recorder = new MediaRecorder(stream);
    mediaRecorder.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) speechChunks.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(speechChunks.current, { type: recorder.mimeType || "audio/webm" });
      void finishSpeechBlob(blob);
    };
    recorder.start();
    setSpeechState("recording");
    setStatus("正在听你说话…");
    if (settingsRef.current.speech.pttCueEnabled && autoStopMs === 0) void playBuiltinPttCue().catch(() => undefined);
    if (autoStopMs > 0) startVadMonitor(stream, recorder, Math.max(autoStopMs, 8000));
  };

  const stopSpeechCapture = () => {
    if (mediaRecorder.current?.state === "recording") {
      mediaRecorder.current.stop();
      setStatus("正在整理录音…");
    }
  };

  const togglePushToTalk = () => {
    if (speechState === "recording") stopSpeechCapture();
    else void startSpeechCapture();
  };

  const respond = async (text: string, automatic = false) => {
    const activeSettings = settingsRef.current;
    if (busy.current) return;
    busy.current = true;
    setStatus(automatic ? "正在看屏幕…" : "正在思考…");

    try {
      let answer: string;
      if (automatic) {
        const context = await captureScreen(activeSettings.blacklist);
        const delay = captureDelayMs(activeSettings, gameActiveRef.current);
        const game = gameModeState(activeSettings, context) !== "off";
        const genre = gameGenre(context);
        if (gameActiveRef.current !== game) {
          gameActiveRef.current = game;
          setGameActive(game);
        }

        const observation = await analyzeGameFrame(activeSettings, context, recentSessionSummary(observations.current), game);
        const speak = shouldSpeak(
          activeSettings.replyFrequency,
          observation,
          observations.current,
          lastComment.current,
          lastSpokenKey.current,
          activeSettings.commentCooldownSeconds * 1000,
          !activeSettings.gameAwarenessEnabled
        );
        const topic = speechTopic(observation);
        const topicRemaining = bypassesTopicCooldown(observation) ? 0 : topicCooldownRemainingMs(topic, topicCooldowns.current[topic], activeSettings.replyFrequency);
        const topicRecentlySpoken = topicRemaining > 0;
        const previousHistoryLength = observations.current.length;
        observations.current = rememberInCurrentRound(observations.current, observation);
        if (observations.current.length < previousHistoryLength) {
          topicCooldowns.current = {};
          lastSpokenKey.current = "";
          log(`match reset phase=${observation.gamePhase || "unknown"} event=${observation.eventType} key=${observation.changeKey}`);
        }
        log(`sample ok genre=${observation.gameGenre || genre} phase=${observation.gamePhase || "unknown"} event=${observation.eventType} confidence=${observation.confidence.toFixed(2)} topic=${topic || "none"} ocrLen=${context.ocrText.length} delay=${delay}ms speak=${speak} key=${observation.changeKey} state=${observation.matchState || ""} rec=${observation.recommendation || observation.nextPlan || ""}`);

        if (!speak) {
          log(`speak skipped reason=policy shouldSpeak=${observation.shouldSpeak} event=${observation.eventType} rec=${observation.recommendation || ""} speakReason=${observation.speakReason || ""}`);
          setStatus(`已记录 ${observations.current.length}/12 帧，${game ? "游戏副驾驶观察中" : "等待可行动作"}`);
          return;
        }
        if (topicRecentlySpoken) {
          log(`speak skipped reason=topic_cooldown topic=${topic} remaining=${Math.ceil(topicRemaining / 1000)}s`);
          setStatus(`已记录 ${observations.current.length}/12 帧，主题 ${topic} 冷却中`);
          return;
        }

        answer = observation.recommendation || observation.advice || observation.situation || observation.summary;
        if (observation.reason && !answer.includes(observation.reason)) answer = `${answer}（${observation.reason}）`;
        answer = addBtCompanionLine(answer, observation, activeSettings);
        lastComment.current = Date.now();
        lastSpokenKey.current = observation.changeKey;
        log(`speak ok topic=${topic || "none"} reason=${observation.speakReason || observation.reason || "policy"} answer=${answer}`);
        if (topic) topicCooldowns.current[topic] = Date.now();
      } else {
        if (activeSettings.memoryEnabled && activeSettings.memoryEngine === "local-summary" && /^remember[:\s]/i.test(text)) rememberExplicitFact(text);
        const memory = activeSettings.memoryEnabled && activeSettings.memoryEngine === "local-summary" ? memoryPrompt() : undefined;
        const prompt: ChatMessage[] = [
          ...(memory ? [{ role: "system", content: memory, createdAt: now() } as ChatMessage] : []),
          ...messages,
          { role: "user", content: text, createdAt: now() }
        ];
        answer = await askModel(activeSettings, prompt);
        setMessages((old) => keepRecentMessages([...old, { role: "user", content: text, createdAt: now() }]));
      }

      setBubble(answer);
      if (!automatic) setMessages((old) => keepRecentMessages([...old, { role: "assistant", content: answer, createdAt: now() }]));
      await speakAnswer(answer, automatic, activeSettings);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "请求失败";
      const hint = detail.includes("API Key") ? "请先在设置里填写 API Key。" : `模型请求失败：${detail}`;
      log(`request failed automatic=${automatic} detail=${detail}`);
      setBubble(hint);
      setStatus(detail);
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    if (settings.paused || settings.doNotDisturb) return;
    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      if (cancelled) return;
      const activeSettings = settingsRef.current;
      if (activeSettings.paused || activeSettings.doNotDisturb) return;
      const delay = activeSettings.smartObservationEnabled
        ? smartLocalCheckIntervalMs(activeSettings)
        : captureDelayMs(activeSettings, gameActiveRef.current);
      const wait = activeSettings.smartObservationEnabled
        ? delay
        : nextCaptureWaitMs(lastAutoStarted.current, delay);
      timer = window.setTimeout(run, wait);
    };

    const run = async () => {
      if (cancelled) return;
      const activeSettings = settingsRef.current;
      if (!activeSettings.smartObservationEnabled) {
        lastAutoStarted.current = Date.now();
        await respond("", true);
        schedule();
        return;
      }

      if (busy.current) {
        log("smart skipped reason=busy");
        schedule();
        return;
      }

      try {
        const nowMs = Date.now();
        const includeOcr = activeSettings.smartOcrChangeTriggerEnabled && nowMs - smartLastOcrAt.current >= smartOcrIntervalMs(activeSettings);
        if (includeOcr) smartLastOcrAt.current = nowMs;
        const check = await lightScreenCheck(activeSettings.blacklist, includeOcr);
        const decision = decideSmartObservation(
          activeSettings,
          check,
          smartLastCheck.current,
          { lastModelAt: smartLastModelAt.current, sceneCache: smartSceneCache.current },
          nowMs
        );
        smartLastCheck.current = check;
        log(`smart check window=${sanitizeLogText(check.window.title || check.window.processName || "unknown").slice(0, 48)} ocrLen=${check.ocrText.length} score=${decision.score} reason=${decision.reason}`);

        if (!decision.trigger) {
          const remaining = decision.remainingMs ? ` remaining=${Math.ceil(decision.remainingMs / 1000)}s` : "";
          log(`smart skipped reason=${decision.skippedReason || "no_change"} trigger=${decision.reason}${remaining}`);
          schedule();
          return;
        }

        if (decision.reason === "window_change" && activeSettings.smartWindowSwitchDelayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, activeSettings.smartWindowSwitchDelayMs));
          if (cancelled) return;
        }
        smartLastModelAt.current = Date.now();
        smartSceneCache.current = rememberSmartScene(smartSceneCache.current, decision.sceneKey, smartLastModelAt.current);
        lastAutoStarted.current = smartLastModelAt.current;
        log(`smart trigger reason=${decision.reason} score=${decision.score} minInterval=${Math.ceil(effectiveSmartModelMinIntervalMs(activeSettings) / 1000)}s`);
        await respond("", true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(`smart skipped reason=check_failed detail=${sanitizeLogText(detail)}`);
      }
      schedule();
    };

    schedule();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [
    settings.paused,
    settings.doNotDisturb,
    settings.captureRate,
    settings.gameAwarenessEnabled,
    settings.gameModeAuto,
    settings.lowSpecMode,
    settings.smartObservationEnabled,
    settings.smartLocalCheckIntervalSeconds,
    settings.smartModelMinIntervalSeconds,
    settings.smartSameSceneCacheSeconds,
    settings.smartWindowSwitchDelayMs,
    settings.smartErrorTriggerEnabled,
    settings.smartWindowChangeTriggerEnabled,
    settings.smartVisualChangeTriggerEnabled,
    settings.smartOcrChangeTriggerEnabled
  ]);

  useEffect(() => {
    if (settings.paused || settings.doNotDisturb || !settings.speech.enabled || settings.speech.mode !== "continuous") {
      if (speechStateRef.current === "listening" || speechStateRef.current === "blockedByVoice") setSpeechState("idle");
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const loop = () => {
      if (cancelled) return;
      if (!settingsRef.current.paused && !settingsRef.current.doNotDisturb && settingsRef.current.speech.enabled && settingsRef.current.speech.mode === "continuous") {
        if (canStartSpeechInput(speechStateRef.current, voiceBusy.current, speechBlockedUntil.current)) {
          void startSpeechCapture(4000);
        } else {
          setSpeechState("blockedByVoice");
        }
      }
      timer = window.setTimeout(loop, 5500);
    };
    setSpeechState("listening");
    timer = window.setTimeout(loop, 500);
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [settings.paused, settings.doNotDisturb, settings.speech.enabled, settings.speech.mode]);

  useEffect(() => {
    void configureSpeechHotkey(settings.speech.enabled && settings.speech.hotkeyEnabled, settings.speech.hotkeyVk)
      .catch((error) => log(`speech hotkey failed reason=${error instanceof Error ? error.message : String(error)}`));
  }, [settings.speech.enabled, settings.speech.hotkeyEnabled, settings.speech.hotkeyVk]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ pressed: boolean }>("speech-hotkey", (event) => {
      const activeSettings = settingsRef.current;
      if (!activeSettings.speech.enabled || !activeSettings.speech.hotkeyEnabled) return;
      if (activeSettings.paused || activeSettings.doNotDisturb) return;
      if (event.payload.pressed) {
        if (speechStateRef.current !== "recording") void startSpeechCapture();
      } else {
        stopSpeechCapture();
      }
    }).then((handler) => { unlisten = handler; });
    return () => { unlisten?.(); };
  }, []);

  const choosePersona = (id: string) => {
    const persona = personaById(id);
    update({
      ...settings,
      selectedPreset: id,
      customPersona: "",
      memoryEngine: persona.memoryEngine,
      memoryEnabled: persona.memoryEngine !== "off",
      voice: { ...settings.voice, speaker: persona.voiceSpeaker }
    });
  };

  const setApiKey = (apiKey: string) => {
    update({ ...settings, provider: { ...settings.provider, apiKey } });
    void invoke("set_api_key", { apiKey });
  };

  const setSpeechKey = (apiKey: string) => {
    update({ ...settings, speech: { ...settings.speech, apiKey } });
    void setSpeechApiKey(apiKey);
  };

  const copyLogs = async () => {
    const text = formatDiagnostics(diagnostics);
    await navigator.clipboard.writeText(text || "暂无日志");
    setStatus("日志已复制");
  };

  const modeLabel = settings.paused
    ? "当前：已暂停"
    : settings.doNotDisturb
      ? "当前：勿扰中"
      : settings.gameAwarenessEnabled && gameActive
        ? `当前：游戏副驾驶（${settings.lowSpecMode ? "8" : "3"} 秒采样${settings.lowSpecMode ? "，低配模式" : ""}）`
        : !settings.gameAwarenessEnabled
          ? `当前：全知型陪伴（${settings.lowSpecMode ? (settings.captureRate === "high" ? "10" : "25") : (settings.captureRate === "high" ? "5" : "20")} 秒采样${settings.lowSpecMode ? "，低配模式" : ""}）`
          : settings.captureRate === "high"
            ? `当前：普通高频（${settings.lowSpecMode ? "10" : "5"} 秒采样${settings.lowSpecMode ? "，低配模式" : ""}）`
            : `当前：普通低频（${settings.lowSpecMode ? "25" : "20"} 秒采样${settings.lowSpecMode ? "，低配模式" : ""}）`;

  const cleanModeLabel = settings.paused
    ? "当前：待命，未开始观察"
    : settings.doNotDisturb
      ? "当前：勿扰中，暂停主动打扰"
      : settings.smartObservationEnabled
        ? `当前：智能模式，本地每 ${settings.smartLocalCheckIntervalSeconds} 秒检测，触发后才调用视觉模型`
        : settings.gameAwarenessEnabled && gameActive
          ? `当前：游戏副驾驶，${settings.lowSpecMode ? "8" : "3"} 秒采样`
          : !settings.gameAwarenessEnabled
            ? "当前：全知型陪伴，番剧/网页/工作/聊天都会按需评论"
            : settings.captureRate === "high"
              ? `当前：普通高频，${settings.lowSpecMode ? "10" : "5"} 秒采样`
              : `当前：普通低频，${settings.lowSpecMode ? "25" : "20"} 秒采样`;

  return <main className="app-shell compact-shell">
    <header className="titlebar" data-tauri-drag-region onMouseDown={(event) => { if (!(event.target as HTMLElement).closest("button")) void getCurrentWindow().startDragging(); }}>
      <span data-tauri-drag-region>✦ AI 桌宠</span>
      <div className="window-controls">
        <button title="隐藏到托盘" onClick={() => void concealMainWindow()}>−</button>
        <button title="隐藏到托盘" className="close" onClick={() => void concealMainWindow()}>×</button>
      </div>
    </header>

    <section className="pet" data-tauri-drag-region onMouseDown={(event) => { if (!(event.target as HTMLElement).closest("button,input,textarea,select")) void getCurrentWindow().startDragging(); }}>
      <GuguPet mode={settings.petMode} enabled={settings.petEnabled} size={settings.petSize} lowSpec={settings.lowSpecMode} speaking={speakingPanel.visible && !speakingPanel.failed} pointer={petPointer} />
      <div className="bubble" data-tauri-drag-region>{bubble}</div>
    </section>

    {speakingPanel.visible && <section className={`bt-comm-panel ${speakingPanel.failed ? "failed" : ""}`} aria-label="BT 通讯面板">
      <img className="bt-comm-bg" src={btCommPanel} alt="" />
      <VoiceBars panel={speakingPanel} compact />
      <div className="bt-comm-link" aria-hidden="true">{speakingPanel.failed ? "LINK LOST" : "BT-7274"}</div>
    </section>}

    <section className="status-card">
      <div><strong>{running ? "运行中" : settings.paused ? "待命" : "暂停中"}</strong><span>{settings.lowSpecMode ? "低配模式" : "标准模式"}</span></div>
      <small>{cleanModeLabel}</small>
      {!settings.provider.apiKey && <small className="warn">请先在设置 → 模型与视觉里填写 API Key。</small>}
      <small>{status}</small>
    </section>

    <div className="toolbar">
      <button disabled={starting} onClick={() => settings.paused ? void startDesktopPet() : update({ ...settings, paused: true })}>{starting ? "启动中" : settings.paused ? "开始" : "暂停"}</button>
      <button onClick={() => update({ ...settings, doNotDisturb: !settings.doNotDisturb })}>{settings.doNotDisturb ? "勿扰中" : "互动中"}</button>
      <button onClick={() => void openSettingsWindow()}>设置</button>
      <button onClick={() => setLogsOpen(!logsOpen)}>日志</button>
    </div>

    <div className="speech-bar">
      <button type="button" onClick={togglePushToTalk} disabled={!settings.speech.enabled || speechState === "transcribing" || speechState === "blockedByVoice"}>
        {speechState === "recording" ? "停止说话" : "语音对话"}
      </button>
      <small>语音状态：{speechState}</small>
    </div>

    <form onSubmit={(event) => {
      event.preventDefault();
      if (input.trim()) {
        const question = input.trim();
        setInput("");
        void respond(question);
      }
    }}>
      <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="问问小伙伴..."/>
      <button>发送</button>
    </form>

    {logsOpen && <details className="quick-setup" open>
      <summary>诊断日志</summary>
      <div className="service-actions">
        <button type="button" onClick={() => void copyLogs()}>复制日志</button>
        <button type="button" onClick={() => setDiagnostics([])}>清空</button>
      </div>
      <textarea readOnly value={diagnostics.map((item) => `${item.at} ${sanitizeLogText(item.message)}`).join("\n")} placeholder="暂无日志。开始自动观察后这里会显示采样、冷却、模型和语音决策。"/>
    </details>}
  </main>;

  return <main className="app-shell legacy-settings">
    {open && <details className="quick-setup" open>
      <summary>基础运行与观察</summary>
      <div className="service-actions">
        <button type="button" disabled={starting} onClick={() => settings.paused ? void startDesktopPet() : update({ ...settings, paused: true })}>
          {starting ? "启动中..." : settings.paused ? "开始桌宠" : "暂停观察"}
        </button>
        <span className={`run-state ${running ? "running" : ""}`}>{starting ? "启动中" : running ? "运行中" : "待命"}</span>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={settings.startOnLaunch} onChange={(event) => update({ ...settings, startOnLaunch: event.target.checked })}/>
        打开应用后自动开始
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={settings.startupVoiceCueEnabled} onChange={(event) => update({ ...settings, startupVoiceCueEnabled: event.target.checked })}/>
        启动完毕后播放提示音
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={settings.lowSpecMode} onChange={(event) => update(event.target.checked
          ? { ...settings, lowSpecMode: true, maxSpokenChars: 24, ttsTimeoutSeconds: 75, voiceBarsMode: "static" }
          : { ...settings, lowSpecMode: false })}/>
        低配模式（2060/V2Pro 推荐）：降低采样与语音压力
      </label>
      <details className="smart-settings">
        <summary>智能模式：事件触发观察</summary>
        <label className="checkbox-row">
          <input type="checkbox" checked={settings.smartObservationEnabled} onChange={(event) => update({ ...settings, smartObservationEnabled: event.target.checked })}/>
          开启智能模式（关闭后恢复固定采样）
        </label>
        <small>{settings.smartObservationEnabled
          ? `本地每 ${settings.smartLocalCheckIntervalSeconds}s 轻量检测；触发后才调用当前视觉模型；模型最小间隔 ${settings.lowSpecMode ? Math.max(25, settings.smartModelMinIntervalSeconds) : settings.smartModelMinIntervalSeconds}s。`
          : "关闭后仍按普通/高频/游戏模式的固定采样逻辑运行。"}</small>
        {settings.smartObservationEnabled && <div className="speech-settings">
          <label>本地检测间隔：{settings.smartLocalCheckIntervalSeconds} 秒
            <input type="range" min="1" max="10" value={settings.smartLocalCheckIntervalSeconds} onChange={(event) => update({ ...settings, smartLocalCheckIntervalSeconds: Number(event.target.value) })}/>
          </label>
          <label>模型最小间隔：{settings.smartModelMinIntervalSeconds} 秒
            <input type="range" min="5" max="120" value={settings.smartModelMinIntervalSeconds} onChange={(event) => update({ ...settings, smartModelMinIntervalSeconds: Number(event.target.value) })}/>
          </label>
          <label>同画面缓存：{settings.smartSameSceneCacheSeconds} 秒
            <input type="range" min="10" max="300" value={settings.smartSameSceneCacheSeconds} onChange={(event) => update({ ...settings, smartSameSceneCacheSeconds: Number(event.target.value) })}/>
          </label>
          <label>窗口切换延迟：{settings.smartWindowSwitchDelayMs} ms
            <input type="range" min="0" max="3000" step="100" value={settings.smartWindowSwitchDelayMs} onChange={(event) => update({ ...settings, smartWindowSwitchDelayMs: Number(event.target.value) })}/>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={settings.smartErrorTriggerEnabled} onChange={(event) => update({ ...settings, smartErrorTriggerEnabled: event.target.checked })}/>
            报错关键词直接触发
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={settings.smartWindowChangeTriggerEnabled} onChange={(event) => update({ ...settings, smartWindowChangeTriggerEnabled: event.target.checked })}/>
            窗口/标题变化触发
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={settings.smartVisualChangeTriggerEnabled} onChange={(event) => update({ ...settings, smartVisualChangeTriggerEnabled: event.target.checked })}/>
            画面明显变化触发
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={settings.smartOcrChangeTriggerEnabled} onChange={(event) => update({ ...settings, smartOcrChangeTriggerEnabled: event.target.checked })}/>
            OCR 文本变化触发（已节流）
          </label>
        </div>}
      </details>
      <label className="checkbox-row">
        <input type="checkbox" checked={settings.gameAwarenessEnabled} onChange={(event) => update({ ...settings, gameAwarenessEnabled: event.target.checked, gameModeEnabled: event.target.checked })}/>
        游戏感知模式（关闭后为全知型陪伴）
      </label>
      <div className="speech-settings">
        <label className="checkbox-row">
          <input type="checkbox" checked={settings.speech.enabled} onChange={(event) => update({ ...settings, speech: { ...settings.speech, enabled: event.target.checked } })}/>
          开启语音对话
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={settings.speech.hotkeyEnabled} onChange={(event) => update({ ...settings, speech: { ...settings.speech, hotkeyEnabled: event.target.checked, mode: "push-to-talk" } })}/>
          游戏中启用全局按住说话
        </label>
        <label>按住说话按键
          <select value={settings.speech.hotkeyVk} onChange={(event) => update({ ...settings, speech: { ...settings.speech, hotkeyVk: Number(event.target.value), hotkeyEnabled: true, mode: "push-to-talk" } })}>
            {SPEECH_HOTKEYS.map((item) => <option key={item.vk} value={item.vk}>{item.label}</option>)}
          </select>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={settings.speech.pttCueEnabled} onChange={(event) => update({ ...settings, speech: { ...settings.speech, pttCueEnabled: event.target.checked } })}/>
          按下说话时播放固定 BT 提示音（不使用 GPT-SoVITS）
        </label>
        <label>语音模式
          <select value={settings.speech.mode} onChange={(event) => update({ ...settings, speech: { ...settings.speech, mode: event.target.value as "push-to-talk" | "continuous" } })}>
            <option value="push-to-talk">按住/点击说话</option>
            <option value="continuous">常驻监听</option>
          </select>
        </label>
        <label>语音识别
          <select value={settings.speech.provider} onChange={(event) => update({ ...settings, speech: { ...settings.speech, provider: event.target.value as "local-http" | "cloud-api" } })}>
            <option value="local-http">本地 HTTP STT</option>
            <option value="cloud-api">云端 STT API</option>
          </select>
        </label>
        <label>STT 地址
          <input value={settings.speech.endpoint} onChange={(event) => update({ ...settings, speech: { ...settings.speech, endpoint: event.target.value } })}/>
        </label>
        <label>STT 模型
          <input value={settings.speech.model} onChange={(event) => update({ ...settings, speech: { ...settings.speech, model: event.target.value } })}/>
        </label>
        <label>STT API Key（仅云端）
          <input type="password" value={settings.speech.apiKey || ""} onChange={(event) => setSpeechKey(event.target.value)} placeholder="可留空：本地 STT 不需要"/>
        </label>
        <label>回复后延迟识别：{settings.speech.postVoiceListenDelaySeconds} 秒
          <input type="range" min="0" max="10" value={settings.speech.postVoiceListenDelaySeconds} onChange={(event) => update({ ...settings, speech: { ...settings.speech, postVoiceListenDelaySeconds: Number(event.target.value) } })}/>
        </label>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={settings.voicePanelEnabled} onChange={(event) => update({ ...settings, voicePanelEnabled: event.target.checked })}/>
        说话时显示通讯面板
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={settings.voiceSubtitleEnabled} onChange={(event) => update({ ...settings, voiceSubtitleEnabled: event.target.checked })}/>
        说话时显示屏幕上方 BT 字幕条
      </label>
      <label>通讯面板音量柱模式
        <select value={settings.lowSpecMode ? "static" : settings.voiceBarsMode} onChange={(event) => update({ ...settings, voiceBarsMode: event.target.value as VoiceBarsMode })} disabled={settings.lowSpecMode}>
          <option value="dynamic">动态：跟随语音音量变化</option>
          <option value="static">静态：固定/轻微循环</option>
        </select>
      </label>
      <label>桌宠语音音量：{settings.voiceVolume}%
        <input type="range" min="0" max="100" value={settings.voiceVolume} onChange={(event) => update({ ...settings, voiceVolume: Number(event.target.value) })}/>
      </label>
      <label>最大朗读字数：{settings.maxSpokenChars} 字
        <input type="range" min="8" max="200" value={settings.maxSpokenChars} onChange={(event) => update({ ...settings, maxSpokenChars: Number(event.target.value) })}/>
      </label>
      <label>GPT-SoVITS 超时：{settings.ttsTimeoutSeconds} 秒
        <input type="range" min="10" max="180" value={settings.ttsTimeoutSeconds} onChange={(event) => update({ ...settings, ttsTimeoutSeconds: Number(event.target.value) })}/>
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={settings.voiceFadeInEnabled} onChange={(event) => update({ ...settings, voiceFadeInEnabled: event.target.checked })}/>
        语音淡入 0.7 秒
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={settings.voiceFadeOutEnabled} onChange={(event) => update({ ...settings, voiceFadeOutEnabled: event.target.checked })}/>
        语音淡出 0.7 秒
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={settings.readParentheticals} onChange={(event) => update({ ...settings, readParentheticals: event.target.checked })}/>
        朗读括号里的理由
      </label>
      <h2>情境搭子</h2>
      <label>采样频率
        <select value={settings.captureRate} onChange={(event) => update({ ...settings, captureRate: event.target.value as "low" | "high" })}>
          <option value="low">低频：20 秒看一次</option>
          <option value="high">高频：5 秒看一次</option>
        </select>
      </label>
      <label>回复状态
        <select value={settings.replyFrequency} onChange={(event) => update({ ...settings, replyFrequency: event.target.value as "high" | "normal" | "low" })}>
          <option value="high">高：有新分析就说，仍去重</option>
          <option value="normal">正常：变化、事件、高光或 60 秒静默</option>
          <option value="low">低：高光/关键事件或 180 秒静默</option>
        </select>
      </label>
      <label>评论冷却（秒）
        <input type="number" min="5" value={settings.commentCooldownSeconds} onChange={(event) => update({ ...settings, commentCooldownSeconds: Number(event.target.value) })}/>
      </label>
      <label>游戏模式
        <select aria-label="游戏模式" value={settings.gameModeAuto ? "auto" : "manual"} onChange={(event) => {
          const value = event.target.value;
          update({ ...settings, gameAwarenessEnabled: true, gameModeEnabled: true, gameModeAuto: value === "auto" });
        }}>
          <option value="auto">自动：识别到游戏后 3 秒分析</option>
          <option value="manual">手动：强制 3 秒游戏副驾驶</option>
        </select>
      </label>
      <small>{modeLabel}；关闭游戏感知=全知型陪伴，开启=游戏副驾驶。采样=多久看一次，冷却=同类内容多久内不重复开口。</small>
    </details>}

    {open && <details className="quick-setup">
      <summary>大模型与视觉</summary>
      <label>API Key（Windows Credential Manager）
        <input type="password" value={settings.provider.apiKey || ""} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..."/>
      </label>
      <label>提供商
        <select value={settings.provider.kind} onChange={(event) => {
          const kind = event.target.value as "openai" | "deepseek" | "bailian" | "custom";
          update(kind === "custom" ? { ...settings, provider: { ...settings.provider, kind } } : { ...settings, provider: { ...settings.provider, kind, ...applyPreset(kind) } });
        }}>
          <option value="bailian">阿里云百炼（支持看图）</option>
          <option value="deepseek">DeepSeek（OCR 文字）</option>
          <option value="openai">OpenAI</option>
          <option value="custom">自定义兼容接口</option>
        </select>
      </label>
      <label>模型服务地址
        <input value={settings.provider.baseUrl} onChange={(event) => update({ ...settings, provider: { ...settings.provider, baseUrl: event.target.value } })}/>
      </label>
      <label>视觉模型
        <select value={settings.provider.model} onChange={(event) => update({ ...settings, provider: { ...settings.provider, kind: "bailian", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: event.target.value, visionModel: event.target.value } })}>
          <option value="qwen-vl-plus">qwen-vl-plus（推荐）</option>
          <option value="qwen-vl-max">qwen-vl-max</option>
          <option value="qwen2.5-vl-72b-instruct">qwen2.5-vl-72b-instruct</option>
        </select>
      </label>
      <label>模型名称
        <input value={settings.provider.model} onChange={(event) => update({ ...settings, provider: { ...settings.provider, model: event.target.value, visionModel: event.target.value } })}/>
      </label>
    </details>}

    {open && <details className="quick-setup">
      <summary>本地语音</summary>
      <label>语音引擎
        <select value={settings.voice.engine} onChange={(event) => update({ ...settings, voice: { ...settings.voice, engine: event.target.value as VoiceEngine } })}>
          <option value="gpt-sovits">GPT-SoVITS</option>
          <option value="none">仅显示文字</option>
        </select>
      </label>
      <label>语音服务地址
        <input value={settings.voice.endpoint} onChange={(event) => update({ ...settings, voice: { ...settings.voice, endpoint: event.target.value } })}/>
      </label>
      <label>GPT-SoVITS 安装目录
        <input value={settings.localSovits.root} onChange={(event) => update({ ...settings, localSovits: { ...settings.localSovits, root: event.target.value } })}/>
      </label>
      <label>GPT .ckpt
        <input value={settings.localSovits.gptWeight} onChange={(event) => update({ ...settings, localSovits: { ...settings.localSovits, gptWeight: event.target.value } })}/>
      </label>
      <label>SoVITS .pth
        <input value={settings.localSovits.sovitsWeight} onChange={(event) => update({ ...settings, localSovits: { ...settings.localSovits, sovitsWeight: event.target.value } })}/>
      </label>
      <label>参考音频 .wav
        <input value={settings.localSovits.referenceAudio} onChange={(event) => update({ ...settings, localSovits: { ...settings.localSovits, referenceAudio: event.target.value } })} placeholder="D:\voices\BT1.wav"/>
      </label>
      <label>参考音频文本
        <textarea value={settings.localSovits.referenceText} onChange={(event) => update({ ...settings, localSovits: { ...settings.localSovits, referenceText: event.target.value } })}/>
      </label>
      <div className="service-actions">
        <button type="button" onClick={() => void startSovits()}>启动并加载音色</button>
        <button type="button" onClick={() => void invoke("stop_sovits_service").then(() => setStatus("GPT-SoVITS 已停止"))}>停止语音服务</button>
      </div>
    </details>}

    <header className="titlebar" data-tauri-drag-region onMouseDown={(event) => { if (!(event.target as HTMLElement).closest("button")) void getCurrentWindow().startDragging(); }}>
      <span data-tauri-drag-region>✦ AI 桌宠</span>
      <div className="window-controls">
        <button title="隐藏到托盘" onClick={() => void concealMainWindow()}>−</button>
        <button title="隐藏到托盘" className="close" onClick={() => void concealMainWindow()}>×</button>
      </div>
    </header>
    <section className="pet" data-tauri-drag-region onMouseDown={(event) => { if (!(event.target as HTMLElement).closest("button,input,textarea,select")) void getCurrentWindow().startDragging(); }}>
      <div className="orb" data-tauri-drag-region>*</div>
      <div className="bubble" data-tauri-drag-region>{bubble}</div>
    </section>
    {speakingPanel.visible && <section className={`bt-comm-panel ${speakingPanel.failed ? "failed" : ""}`} aria-label="BT 通讯面板">
      <img className="bt-comm-bg" src={btCommPanel} alt="" />
      <VoiceBars panel={speakingPanel} compact />
      <div className="bt-comm-link" aria-hidden="true">{speakingPanel.failed ? "LINK LOST" : "BT-7274"}</div>
    </section>}
    <div className="toolbar">
      <button disabled={starting} onClick={() => settings.paused ? void startDesktopPet() : update({ ...settings, paused: true })}>{starting ? "启动中" : settings.paused ? "开始" : "暂停"}</button>
      <button onClick={() => update({ ...settings, doNotDisturb: !settings.doNotDisturb })}>{settings.doNotDisturb ? "勿扰中" : "互动中"}</button>
      <button onClick={() => setOpen(!open)}>设置</button>
      <button onClick={() => setLogsOpen(!logsOpen)}>日志</button>
    </div>
    <div className="speech-bar">
      <button type="button" onClick={togglePushToTalk} disabled={!settings.speech.enabled || speechState === "transcribing" || speechState === "blockedByVoice"}>
        {speechState === "recording" ? "停止说话" : "语音对话"}
      </button>
      <small>语音状态：{speechState}</small>
    </div>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (input.trim()) {
        const question = input.trim();
        setInput("");
        void respond(question);
      }
    }}>
      <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="问问小伙伴…"/>
      <button>发送</button>
    </form>
    <small>{status}</small>

    {logsOpen && <details className="quick-setup" open>
      <summary>诊断日志</summary>
      <div className="service-actions">
        <button type="button" onClick={() => void copyLogs()}>复制日志</button>
        <button type="button" onClick={() => setDiagnostics([])}>清空</button>
      </div>
      <textarea readOnly value={diagnostics.map((item) => `${item.at} ${sanitizeLogText(item.message)}`).join("\n")} placeholder="暂无日志。开始自动观察后这里会显示采样、冷却、模型和语音决策。"/>
    </details>}

    {open && <details className="quick-setup">
      <summary>角色与隐私</summary>
      <label>角色预设
        <select value={settings.selectedPreset} onChange={(event) => choosePersona(event.target.value)}>
          {PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.description}</option>)}
        </select>
      </label>
      <label>自定义人格（覆盖预设）
        <textarea value={settings.customPersona} onChange={(event) => update({ ...settings, customPersona: event.target.value })}/>
      </label>
      <label>记忆模式
        <select value={settings.memoryEngine} onChange={(event) => update({ ...settings, memoryEngine: event.target.value as "local-summary" | "off", memoryEnabled: event.target.value === "local-summary" })}>
          <option value="local-summary">本地显式摘要</option>
          <option value="off">关闭</option>
        </select>
      </label>
      <label>窗口黑名单（逗号分隔）
        <input value={settings.blacklist.join(", ")} onChange={(event) => update({ ...settings, blacklist: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}/>
      </label>
    </details>}
  </main>;
}

function SettingsCenterApp() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [section, setSection] = useState("overview");
  const [importText, setImportText] = useState("");
  const [notice, setNotice] = useState("设置修改会自动保存，并同步到主桌宠窗口。");

  useEffect(() => {
    const current = getCurrentWindow();
    let unlistenClose: (() => void) | undefined;
    void current.onCloseRequested((event) => {
      event.preventDefault();
      void current.hide();
    }).then((handler) => { unlistenClose = handler; });
    void invoke<string | null>("get_api_key")
      .then((apiKey) => apiKey && setSettings((old) => ({ ...old, provider: { ...old.provider, apiKey } })))
      .catch(() => undefined);
    void getSpeechApiKey()
      .then((apiKey) => apiKey && setSettings((old) => ({ ...old, speech: { ...old.speech, apiKey } })))
      .catch(() => undefined);
    return () => { unlistenClose?.(); };
  }, []);

  const update = (next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
    void emit("settings-updated", next);
  };

  const setProviderApiKey = (apiKey: string) => {
    const next = { ...settings, provider: { ...settings.provider, apiKey } };
    update(next);
    void invoke("set_api_key", { apiKey });
    setNotice(apiKey ? "API Key 已保存到 Windows Credential Manager。" : "API Key 已清空。");
  };

  const addPreset = () => {
    const name = `我的方案 ${settings.customBundles.length + 1}`;
    const next = addBundleFromCurrent(settings, name);
    update(next);
    setNotice(`已保存预设：${name}`);
  };

  const exportPresets = async () => {
    await navigator.clipboard.writeText(exportSettings(settings));
    setNotice("预设 JSON 已复制；不包含 API Key、STT Key、截图或日志。");
  };

  const importPresets = () => {
    try {
      const next = importPresetJson(settings, importText);
      update(next);
      setImportText("");
      setNotice("预设导入完成。");
    } catch (error) {
      setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const nav = [
    ["overview", "总览"],
    ["model", "模型与视觉"],
    ["preset", "预设与角色"],
    ["voice", "本地语音"],
    ["pet", "咕咕嘎嘎"],
    ["speech", "语音输入"],
    ["observe", "观察与智能"],
    ["privacy", "隐私与黑名单"],
    ["diagnostics", "诊断"]
  ];

  return <main className="settings-center">
    <aside className="settings-nav">
      <h1>AI 桌宠 2.0</h1>
      {nav.map(([id, label]) => <button key={id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}
      <small>{notice}</small>
    </aside>
    <section className="settings-content">
      {section === "overview" && <div className="settings-grid">
        <article className="settings-card"><h2>运行状态</h2><p>{settings.paused ? "待命：不会自动截图或请求模型。" : settings.doNotDisturb ? "勿扰：减少主动打扰。" : "运行中：按当前观察策略工作。"}</p></article>
        <article className="settings-card"><h2>当前观察</h2><p>{settings.smartObservationEnabled ? `智能模式：${settings.smartLocalCheckIntervalSeconds}s 本地检测，${settings.smartModelMinIntervalSeconds}s 模型最小间隔。` : `固定采样：${settings.captureRate === "high" ? "高频" : "低频"}。`}</p></article>
        <article className="settings-card"><h2>语音输出</h2><p>{settings.voice.enabled && settings.voice.engine !== "none" ? `GPT-SoVITS：${settings.voice.endpoint}` : "仅文字回复。"}</p></article>
        <article className="settings-card"><h2>低配保护</h2><p>{settings.lowSpecMode ? "已开启：降低采样和朗读压力。" : "未开启：使用标准频率。"}</p></article>
      </div>}

      {section === "preset" && <div className="settings-grid">
        <article className="settings-card wide"><h2>用户预设 Bundle</h2>
          <label>当前预设
            <select value={settings.selectedBundleId} onChange={(event) => update(applyBundle(settings, event.target.value))}>
              <option value="current">当前临时设置</option>
              {settings.customBundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}
            </select>
          </label>
          <div className="service-actions">
            <button onClick={addPreset}>复制当前设置为新预设</button>
            <button onClick={exportPresets}>导出预设 JSON</button>
            <button disabled={settings.selectedBundleId === "current"} onClick={() => update(deleteBundle(settings, settings.selectedBundleId))}>删除当前自定义预设</button>
          </div>
        </article>
        <article className="settings-card wide"><h2>导入预设</h2>
          <textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="粘贴导出的预设 JSON。不会导入 API Key。"/>
          <button onClick={importPresets} disabled={!importText.trim()}>导入</button>
        </article>
        <article className="settings-card wide"><h2>角色人格</h2>
          <label>内置角色
            <select value={settings.selectedPreset} onChange={(event) => {
              const persona = personaById(event.target.value);
              update({ ...settings, selectedPreset: event.target.value, customPersona: "", memoryEngine: persona.memoryEngine, memoryEnabled: persona.memoryEngine !== "off", voice: { ...settings.voice, speaker: persona.voiceSpeaker } });
            }}>
              {PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.description}</option>)}
            </select>
          </label>
          <label>自定义人格提示词<textarea value={settings.customPersona} onChange={(event) => update({ ...settings, customPersona: event.target.value })}/></label>
        </article>
      </div>}

      {section === "model" && <div className="settings-grid">
        <article className="settings-card wide"><h2>模型接口</h2>
          <label>API Key（Windows Credential Manager）
            <input type="password" value={settings.provider.apiKey || ""} onChange={(event) => setProviderApiKey(event.target.value)} placeholder="百炼 / DeepSeek / OpenAI-compatible 的 API Key"/>
          </label>
          {!settings.provider.apiKey && <small className="warn">当前还没有填写 API Key，模型请求会失败。百炼、DeepSeek、OpenAI 兼容接口都在这里填写。</small>}
          <label>提供商<select value={settings.provider.kind} onChange={(event) => {
            const kind = event.target.value as "openai" | "deepseek" | "bailian" | "custom";
            update(kind === "custom" ? { ...settings, provider: { ...settings.provider, kind } } : { ...settings, provider: { ...settings.provider, kind, ...applyPreset(kind) } });
          }}><option value="bailian">阿里云百炼</option><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="custom">自定义兼容接口</option></select></label>
          <label>Base URL<input value={settings.provider.baseUrl} onChange={(event) => update({ ...settings, provider: { ...settings.provider, baseUrl: event.target.value } })}/></label>
          <label>模型名称<input value={settings.provider.model} onChange={(event) => update({ ...settings, provider: { ...settings.provider, model: event.target.value, visionModel: event.target.value } })}/></label>
          <label>视觉模型<input value={settings.provider.visionModel} onChange={(event) => update({ ...settings, provider: { ...settings.provider, visionModel: event.target.value } })}/></label>
          <small>API Key 通过 Windows Credential Manager 存储，不会写入普通配置，也不会出现在预设导出中。</small>
        </article>
      </div>}

      {section === "voice" && <div className="settings-grid">
        <article className="settings-card wide"><h2>GPT-SoVITS 输出</h2>
          <label>语音引擎<select value={settings.voice.engine} onChange={(event) => update({ ...settings, voice: { ...settings.voice, engine: event.target.value as VoiceEngine } })}><option value="gpt-sovits">GPT-SoVITS</option><option value="none">仅文字</option></select></label>
          <label>服务地址<input value={settings.voice.endpoint} onChange={(event) => update({ ...settings, voice: { ...settings.voice, endpoint: event.target.value } })}/></label>
          <label>参考音频<input value={settings.localSovits.referenceAudio} onChange={(event) => update({ ...settings, localSovits: { ...settings.localSovits, referenceAudio: event.target.value } })}/></label>
          <label>参考文本<textarea value={settings.localSovits.referenceText} onChange={(event) => update({ ...settings, localSovits: { ...settings.localSovits, referenceText: event.target.value } })}/></label>
          <label>音量：{settings.voiceVolume}%<input type="range" min="0" max="100" value={settings.voiceVolume} onChange={(event) => update({ ...settings, voiceVolume: Number(event.target.value) })}/></label>
          <label>最大朗读字数：{settings.maxSpokenChars}<input type="range" min="8" max="200" value={settings.maxSpokenChars} onChange={(event) => update({ ...settings, maxSpokenChars: Number(event.target.value) })}/></label>
        </article>
      </div>}

      {section === "pet" && <div className="settings-grid">
        <article className="settings-card wide"><h2>咕咕嘎嘎互动桌宠</h2>
          <label className="checkbox-row"><input type="checkbox" checked={settings.petEnabled} onChange={(event) => update({ ...settings, petEnabled: event.target.checked })}/>显示咕咕嘎嘎角色</label>
          <label>运行模式<select value={settings.petMode} onChange={(event) => update({ ...settings, petMode: event.target.value as "office" | "interactive" | "game" })}><option value="office">办公模式：固定位置、轻微动作</option><option value="interactive">完整互动：光标、心情与自主动作</option><option value="game">游戏模式：隐藏角色模型</option></select></label>
          <label>角色大小：{Math.round(settings.petSize * 100)}%<input type="range" min="0.55" max="1.6" step="0.05" value={settings.petSize} onChange={(event) => update({ ...settings, petSize: Number(event.target.value) })}/></label>
          <label>互动速度：{Math.round(settings.petSpeed * 100)}%<input type="range" min="0.4" max="2" step="0.1" value={settings.petSpeed} onChange={(event) => update({ ...settings, petSpeed: Number(event.target.value) })}/></label>
          <label>互动强度：{Math.round(settings.petInteractionStrength * 100)}%<input type="range" min="0" max="2" step="0.1" value={settings.petInteractionStrength} onChange={(event) => update({ ...settings, petInteractionStrength: Number(event.target.value) })}/></label>
          <label className="checkbox-row"><input type="checkbox" checked={settings.petSceneReactions} onChange={(event) => update({ ...settings, petSceneReactions: event.target.checked })}/>允许根据已授权的屏幕观察做表情反应</label>
          <small>桌宠不会修改真实鼠标位置。游戏模式仅隐藏模型，保留语音、字幕与游戏观察。</small>
        </article>
      </div>}

      {section === "speech" && <div className="settings-grid">
        <article className="settings-card wide"><h2>语音输入 STT</h2>
          <label className="checkbox-row"><input type="checkbox" checked={settings.speech.enabled} onChange={(event) => update({ ...settings, speech: { ...settings.speech, enabled: event.target.checked } })}/>启用语音对话</label>
          <label>模式<select value={settings.speech.mode} onChange={(event) => update({ ...settings, speech: { ...settings.speech, mode: event.target.value as "push-to-talk" | "continuous" } })}><option value="push-to-talk">按住/点击说话</option><option value="continuous">常驻监听</option></select></label>
          <label>STT 地址<input value={settings.speech.endpoint} onChange={(event) => update({ ...settings, speech: { ...settings.speech, endpoint: event.target.value } })}/></label>
          <label>回复后延迟识别：{settings.speech.postVoiceListenDelaySeconds}s<input type="range" min="0" max="10" value={settings.speech.postVoiceListenDelaySeconds} onChange={(event) => update({ ...settings, speech: { ...settings.speech, postVoiceListenDelaySeconds: Number(event.target.value) } })}/></label>
        </article>
      </div>}

      {section === "observe" && <div className="settings-grid">
        <article className="settings-card"><h2>基础观察</h2>
          <label>采样频率<select value={settings.captureRate} onChange={(event) => update({ ...settings, captureRate: event.target.value as "low" | "high" })}><option value="low">低频</option><option value="high">高频</option></select></label>
          <label>回复频率<select value={settings.replyFrequency} onChange={(event) => update({ ...settings, replyFrequency: event.target.value as "high" | "normal" | "low" })}><option value="high">高</option><option value="normal">正常</option><option value="low">低</option></select></label>
          <label>评论冷却<input type="number" min="5" value={settings.commentCooldownSeconds} onChange={(event) => update({ ...settings, commentCooldownSeconds: Number(event.target.value) })}/></label>
        </article>
        <article className="settings-card"><h2>智能模式</h2>
          <label className="checkbox-row"><input type="checkbox" checked={settings.smartObservationEnabled} onChange={(event) => update({ ...settings, smartObservationEnabled: event.target.checked })}/>事件触发观察</label>
          <label>本地检测：{settings.smartLocalCheckIntervalSeconds}s<input type="range" min="1" max="10" value={settings.smartLocalCheckIntervalSeconds} onChange={(event) => update({ ...settings, smartLocalCheckIntervalSeconds: Number(event.target.value) })}/></label>
          <label>模型最小间隔：{settings.smartModelMinIntervalSeconds}s<input type="range" min="5" max="120" value={settings.smartModelMinIntervalSeconds} onChange={(event) => update({ ...settings, smartModelMinIntervalSeconds: Number(event.target.value) })}/></label>
          <label>同画面缓存：{settings.smartSameSceneCacheSeconds}s<input type="range" min="10" max="300" value={settings.smartSameSceneCacheSeconds} onChange={(event) => update({ ...settings, smartSameSceneCacheSeconds: Number(event.target.value) })}/></label>
        </article>
        <article className="settings-card"><h2>游戏感知与低配</h2>
          <label className="checkbox-row"><input type="checkbox" checked={settings.gameAwarenessEnabled} onChange={(event) => update({ ...settings, gameAwarenessEnabled: event.target.checked, gameModeEnabled: event.target.checked })}/>游戏感知</label>
          <label className="checkbox-row"><input type="checkbox" checked={settings.lowSpecMode} onChange={(event) => update(event.target.checked ? { ...settings, lowSpecMode: true, maxSpokenChars: 24, ttsTimeoutSeconds: 75, voiceBarsMode: "static" } : { ...settings, lowSpecMode: false })}/>低配模式</label>
        </article>
      </div>}

      {section === "privacy" && <div className="settings-grid">
        <article className="settings-card wide"><h2>隐私与黑名单</h2>
          <label>窗口黑名单（逗号分隔）<input value={settings.blacklist.join(", ")} onChange={(event) => update({ ...settings, blacklist: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}/></label>
          <label>记忆模式<select value={settings.memoryEngine} onChange={(event) => update({ ...settings, memoryEngine: event.target.value as "local-summary" | "off", memoryEnabled: event.target.value === "local-summary" })}><option value="local-summary">本地显式摘要</option><option value="off">关闭</option></select></label>
          <small>截图不落盘；导出预设不包含 API Key、截图、日志或完整 OCR。</small>
        </article>
      </div>}

      {section === "diagnostics" && <div className="settings-grid">
        <article className="settings-card wide"><h2>概念说明</h2>
          <p>采样频率=多久检查一次；智能模式=是否先本地判断再调用模型；回复频率=分析后是否开口；评论冷却=最短说话间隔。</p>
          <p>如果 GPT-SoVITS 离线，文字仍可用，语音会进入失败退避，避免反复卡顿。</p>
        </article>
      </div>}
    </section>
  </main>;
}

function clampLevel(value: number) {
  return Math.max(0.12, Math.min(1, Number.isFinite(value) ? value : 0.28));
}

function sampleDynamicLevels(panel: SpeakingPanelState, count: number) {
  const source = panel.levels.length > 2 ? panel.levels : defaultVoiceLevels();
  const duration = Math.max(1, panel.durationMs || 1);
  const progress = Math.max(0, Math.min(1, (Date.now() - panel.startedAt) / duration));
  const center = progress * Math.max(0, source.length - 1);
  const half = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => {
    const offset = (index - half) * 0.72;
    const sampled = source[Math.max(0, Math.min(source.length - 1, Math.round(center + offset)))] ?? source[index % source.length] ?? 0.24;
    const pulse = 0.9 + Math.sin(Date.now() / 115 + index * 0.75) * 0.08;
    return clampLevel(sampled * pulse);
  });
}

function VoiceBars({ panel, compact = false }: { panel: SpeakingPanelState; compact?: boolean }) {
  const hasDynamicData = panel.barsMode === "dynamic" && panel.levels.length > 2 && panel.durationMs > 0;
  const [bars, setBars] = useState<number[]>(hasDynamicData ? sampleDynamicLevels(panel, 14) : defaultVoiceLevels());

  useEffect(() => {
    if (!hasDynamicData) {
      setBars(defaultVoiceLevels());
      return;
    }
    let frame = 0;
    const tick = () => {
      setBars(sampleDynamicLevels(panel, 14));
      if (Date.now() - panel.startedAt < panel.durationMs + 300) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [hasDynamicData, panel.startedAt, panel.durationMs, panel.levels]);

  const mode: VoiceBarsMode = hasDynamicData ? "dynamic" : "static";
  const maxHeight = compact ? 44 : 55;
  const minHeight = compact ? 7 : 8;
  return <div className={`bt-comm-bars ${mode}`} aria-hidden="true">
    <div className="bt-comm-bars-mask" />
    {bars.slice(0, 14).map((level, index) =>
      <span key={index} style={{ height: `${Math.max(minHeight, Math.min(maxHeight, level * maxHeight))}px`, animationDelay: `${index * 45}ms` }} />
    )}
  </div>;
}

function subtitleSpeaker(speaker: string) {
  return speaker.toLowerCase().includes("bt") ? "BT" : (speaker || "AI");
}

function readStoredSubtitle(): SpeakingPanelState | null {
  try {
    const raw = localStorage.getItem(SUBTITLE_STATE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as SpeakingPanelState & { expiresAt?: number };
    if (!payload.text || (payload.expiresAt && payload.expiresAt < Date.now())) {
      localStorage.removeItem(SUBTITLE_STATE_KEY);
      return null;
    }
    return { ...payload, visible: true };
  } catch {
    return null;
  }
}

function VoiceOverlayApp() {
  const [panel, setPanel] = useState<SpeakingPanelState>({ visible: false, text: "", speaker: "", levels: [], startedAt: 0, durationMs: 0 });

  useEffect(() => {
    const window = getCurrentWindow();
    void window.setIgnoreCursorEvents(true).catch(() => undefined);
    void window.setAlwaysOnTop(true).catch(() => undefined);
    void window.setSkipTaskbar(true).catch(() => undefined);
    let unlistenShow: (() => void) | undefined;
    let unlistenHide: (() => void) | undefined;
    void listen<SpeakingPanelState>("voice-overlay-show", (event) => {
      const payload = event.payload;
      setPanel({ ...payload, visible: true, levels: payload.levels?.length ? payload.levels : defaultVoiceLevels() });
    }).then((unlisten) => { unlistenShow = unlisten; });
    void listen("voice-overlay-hide", () => {
      setPanel((old) => ({ ...old, visible: false }));
      void parkOverlayWindow(window);
    }).then((unlisten) => { unlistenHide = unlisten; });
    return () => {
      unlistenShow?.();
      unlistenHide?.();
    };
  }, []);

  return <main className="voice-overlay-root">
    {panel.visible && <section className={`bt-comm-panel overlay ${panel.failed ? "failed" : ""}`} aria-label="BT 通讯面板">
      <img className="bt-comm-bg" src={btCommPanel} alt="" />
      <VoiceBars panel={panel} />
    </section>}
  </main>;
}

function SubtitleOverlayApp() {
  const [panel, setPanel] = useState<SpeakingPanelState>({ visible: false, text: "", speaker: "", levels: [], startedAt: 0, durationMs: 0 });

  useEffect(() => {
    const window = getCurrentWindow();
    void window.setIgnoreCursorEvents(true).catch(() => undefined);
    void window.setAlwaysOnTop(true).catch(() => undefined);
    void window.setSkipTaskbar(true).catch(() => undefined);
    let unlistenShow: (() => void) | undefined;
    let unlistenHide: (() => void) | undefined;
    const stored = readStoredSubtitle();
    if (stored) setPanel(stored);
    const poll = globalThis.setInterval(() => {
      const next = readStoredSubtitle();
      setPanel((old) => next ? (old.text === next.text && old.startedAt === next.startedAt ? old : next) : (old.visible ? { ...old, visible: false } : old));
    }, 100);
    void listen<SpeakingPanelState>("voice-subtitle-show", (event) => {
      setPanel({ ...event.payload, visible: true });
    }).then((unlisten) => { unlistenShow = unlisten; });
    void listen("voice-subtitle-hide", () => {
      setPanel((old) => ({ ...old, visible: false }));
      void parkOverlayWindow(window);
    }).then((unlisten) => { unlistenHide = unlisten; });
    return () => {
      globalThis.clearInterval(poll);
      unlistenShow?.();
      unlistenHide?.();
    };
  }, []);

  return <main className="subtitle-overlay-root">
    {panel.visible && <div className="bt-subtitle-bar">
      <span>{subtitleSpeaker(panel.speaker)}: </span>{panel.text}
    </div>}
  </main>;
}

const overlayMode = new URLSearchParams(window.location.search).get("overlay");
if (overlayMode === "voice") document.body.classList.add("voice-overlay-page");
if (overlayMode === "subtitle") document.body.classList.add("subtitle-overlay-page");
if (overlayMode === "settings") document.body.classList.add("settings-page");
createRoot(document.getElementById("root")!).render(
  overlayMode === "voice"
    ? <VoiceOverlayApp/>
    : overlayMode === "subtitle"
      ? <SubtitleOverlayApp/>
      : overlayMode === "settings"
        ? <SettingsCenterApp/>
        : <App/>
);
