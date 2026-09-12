export type ProviderKind = "openai" | "deepseek" | "bailian" | "custom";
export type CaptureRate = "low" | "high";
export type VoiceEngine = "gpt-sovits" | "none";
export type MemoryEngine = "local-summary" | "off";
export type ReplyFrequency = "high" | "normal" | "low";
export type SpeechMode = "push-to-talk" | "continuous";
export type SpeechProviderKind = "local-http" | "cloud-api";
export type SpeechRuntimeState = "idle" | "recording" | "transcribing" | "listening" | "blockedByVoice";
export type VoiceBarsMode = "dynamic" | "static";
export type PetMode = "office" | "interactive" | "game";
export type SceneKind = "game" | "work" | "chat" | "media" | "idle" | "unknown";
export type GameEventType = "combat" | "highlight" | "result" | "loot" | "loadout" | "skill" | "form" | "spreadsheet" | "risk" | "none";
export type GameGenre = "rts" | "shooter" | "extraction" | "rpg" | "racing" | "sim" | "moba" | "general";
export type GamePhase = "opening" | "early" | "mid" | "late" | "menu" | "result" | "unknown";

export interface ProviderSettings { kind: ProviderKind; baseUrl: string; model: string; visionModel: string; apiKey?: string }
export interface VoiceSettings { engine: VoiceEngine; endpoint: string; speaker: string; language: string; enabled: boolean }
export interface SpeechSettings { enabled: boolean; mode: SpeechMode; provider: SpeechProviderKind; endpoint: string; model: string; apiKey?: string; postVoiceListenDelaySeconds: number; vadThreshold: number; hotkeyEnabled: boolean; hotkeyVk: number; pttCueEnabled: boolean }
export interface LocalSovitsSettings { root: string; gptWeight: string; sovitsWeight: string; referenceAudio: string; referenceText: string; referenceLanguage: string }
export interface PersonaPreset { id: string; name: string; description: string; systemPrompt: string; voiceSpeaker: string; memoryEngine: MemoryEngine }
export interface CharacterProfile { id: string; name: string; description: string; systemPrompt: string; addressStyle: string; replyStyle: string; voiceProfileId?: string; memoryEngine: MemoryEngine; readParentheticals: boolean; voicePanelEnabled: boolean; voiceSubtitleEnabled: boolean }
export interface VoiceProfile { id: string; name: string; engine: VoiceEngine; endpoint: string; speaker: string; language: string; localSovits: LocalSovitsSettings; volume: number; maxSpokenChars: number; ttsTimeoutSeconds: number; fadeInEnabled: boolean; fadeOutEnabled: boolean; barsMode: VoiceBarsMode }
export interface ObservationProfile { id: string; name: string; captureRate: CaptureRate; replyFrequency: ReplyFrequency; commentCooldownSeconds: number; gameAwarenessEnabled: boolean; gameModeAuto: boolean; lowSpecMode: boolean; smartObservationEnabled: boolean; smartLocalCheckIntervalSeconds: number; smartModelMinIntervalSeconds: number; smartSameSceneCacheSeconds: number; smartWindowSwitchDelayMs: number; smartErrorTriggerEnabled: boolean; smartWindowChangeTriggerEnabled: boolean; smartVisualChangeTriggerEnabled: boolean; smartOcrChangeTriggerEnabled: boolean; blacklist: string[] }
export interface UiThemeProfile { id: string; name: string; accentColor: string; panelOpacity: number; compactMode: boolean; fontScale: number }
export interface UserPresetBundle { id: string; name: string; description: string; characterProfileId: string; voiceProfileId: string; observationProfileId: string; uiThemeProfileId: string; createdAt: string; updatedAt: string }
export interface GameObservation {
  capturedAt: string; window: WindowMeta; ocrText: string;
  sceneKind: SceneKind; summary: string; visibleFacts: string[]; situation: string;
  eventType: GameEventType; confidence: number; changeKey: string;
  recommendation: string; reason: string; shouldSpeak: boolean; advice: string;
  gameGenre?: GameGenre; gamePhase?: GamePhase; opponentRead?: string; nextPlan?: string; speakReason?: string; matchState?: string;
}
export interface VoicePlaybackInfo { durationMs: number; levels: number[] }
export interface SpeakingPanelState { visible: boolean; text: string; speaker: string; levels: number[]; startedAt: number; durationMs: number; failed?: boolean; barsMode?: VoiceBarsMode }
export interface RecordedAudio { path: string; mimeType: string; bytes: number }
export interface AppSettings {
  captureRate: CaptureRate; paused: boolean; doNotDisturb: boolean; commentCooldownSeconds: number;
  petMode: PetMode; petEnabled: boolean; petSize: number; petSpeed: number; petInteractionStrength: number; petSceneReactions: boolean;
  startOnLaunch: boolean; startupVoiceCueEnabled: boolean; gameAwarenessEnabled: boolean; lowSpecMode: boolean;
  smartObservationEnabled: boolean; smartLocalCheckIntervalSeconds: number; smartModelMinIntervalSeconds: number; smartSameSceneCacheSeconds: number; smartWindowSwitchDelayMs: number; smartErrorTriggerEnabled: boolean; smartWindowChangeTriggerEnabled: boolean; smartVisualChangeTriggerEnabled: boolean; smartOcrChangeTriggerEnabled: boolean;
  selectedBundleId: string; selectedCharacterProfileId: string; selectedVoiceProfileId: string; selectedObservationProfileId: string; selectedUiThemeProfileId: string; customCharacters: CharacterProfile[]; customVoiceProfiles: VoiceProfile[]; customObservationProfiles: ObservationProfile[]; customUiThemes: UiThemeProfile[]; customBundles: UserPresetBundle[];
  blacklist: string[]; memoryEnabled: boolean; memoryEngine: MemoryEngine; selectedPreset: string; customPersona: string; replyFrequency: ReplyFrequency; gameModeAuto: boolean; gameModeEnabled: boolean; readParentheticals: boolean; voicePanelEnabled: boolean; voiceSubtitleEnabled: boolean; voiceBarsMode: VoiceBarsMode; voiceVolume: number; voiceFadeInEnabled: boolean; voiceFadeOutEnabled: boolean; maxSpokenChars: number; ttsTimeoutSeconds: number; provider: ProviderSettings; voice: VoiceSettings; speech: SpeechSettings; localSovits: LocalSovitsSettings;
}
export interface WindowMeta { title: string; processName: string }
export interface ScreenContext { imageDataUrl: string; ocrText: string; window: WindowMeta; capturedAt: string }
export interface LightScreenCheck { window: WindowMeta; capturedAt: string; visualHash: string; ocrText: string; signature: string }
export interface ChatMessage { role: "user" | "assistant" | "system"; content: string; createdAt: string }

export const defaults: AppSettings = {
  captureRate: "low",
  paused: true,
  doNotDisturb: false,
  commentCooldownSeconds: 30,
  petMode: "office",
  petEnabled: true,
  petSize: 1,
  petSpeed: 1,
  petInteractionStrength: 1,
  petSceneReactions: true,
  startOnLaunch: false,
  startupVoiceCueEnabled: true,
  gameAwarenessEnabled: true,
  lowSpecMode: false,
  smartObservationEnabled: false,
  smartLocalCheckIntervalSeconds: 2,
  smartModelMinIntervalSeconds: 15,
  smartSameSceneCacheSeconds: 120,
  smartWindowSwitchDelayMs: 800,
  smartErrorTriggerEnabled: true,
  smartWindowChangeTriggerEnabled: true,
  smartVisualChangeTriggerEnabled: true,
  smartOcrChangeTriggerEnabled: true,
  selectedBundleId: "current",
  selectedCharacterProfileId: "current",
  selectedVoiceProfileId: "current",
  selectedObservationProfileId: "current",
  selectedUiThemeProfileId: "midnight",
  customCharacters: [],
  customVoiceProfiles: [],
  customObservationProfiles: [],
  customUiThemes: [{ id: "midnight", name: "紫夜默认", accentColor: "#9f75ff", panelOpacity: 0.92, compactMode: false, fontScale: 1 }],
  customBundles: [],
  blacklist: [],
  memoryEnabled: false,
  memoryEngine: "local-summary",
  selectedPreset: "companion",
  customPersona: "",
  replyFrequency: "normal",
  gameModeAuto: true,
  gameModeEnabled: true,
  readParentheticals: false,
  voicePanelEnabled: true,
  voiceSubtitleEnabled: true,
  voiceBarsMode: "dynamic",
  voiceVolume: 100,
  voiceFadeInEnabled: true,
  voiceFadeOutEnabled: true,
  maxSpokenChars: 100,
  ttsTimeoutSeconds: 35,
  provider: { kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", visionModel: "gpt-4o-mini" },
  voice: { engine: "gpt-sovits", endpoint: "http://127.0.0.1:9880", speaker: "", language: "zh", enabled: true },
  speech: {
    enabled: false,
    mode: "push-to-talk",
    provider: "local-http",
    endpoint: "http://127.0.0.1:8000/v1/audio/transcriptions",
    model: "whisper-large-v3",
    postVoiceListenDelaySeconds: 2,
    vadThreshold: 0.05,
    hotkeyEnabled: false,
    hotkeyVk: 119,
    pttCueEnabled: true
  },
  localSovits: {
    root: "",
    gptWeight: "",
    sovitsWeight: "",
    referenceAudio: "",
    referenceText: "",
    referenceLanguage: "zh"
  }
};
