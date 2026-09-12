import { AppSettings, CharacterProfile, defaults, ObservationProfile, PetMode, SpeechMode, SpeechProviderKind, UiThemeProfile, UserPresetBundle, VoiceBarsMode, VoiceEngine, VoiceProfile } from "../types";

const KEY = "desktop-pet-settings";
const VOICE_ENGINES: VoiceEngine[] = ["gpt-sovits", "none"];
const CAPTURE_RATES = ["low", "high"] as const;
const REPLY_FREQUENCIES = ["high", "normal", "low"] as const;
const PROVIDER_KINDS = ["openai", "deepseek", "bailian", "custom"] as const;
const MEMORY_ENGINES = ["local-summary", "off"] as const;
const SPEECH_MODES: SpeechMode[] = ["push-to-talk", "continuous"];
const SPEECH_PROVIDERS: SpeechProviderKind[] = ["local-http", "cloud-api"];
const VOICE_BARS_MODES: VoiceBarsMode[] = ["dynamic", "static"];
const PET_MODES: PetMode[] = ["office", "interactive", "game"];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.min(max, Math.max(min, next)) : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 50) : [];
}

function objects<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object").slice(0, 50) as T[] : [];
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

export function loadSettings(): AppSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    const savedProvider = saved.provider || {};
    const savedVoice = saved.voice || {};
    const savedSpeech = saved.speech || {};
    const savedSovits = saved.localSovits || {};
    const memoryEngine = pick(saved.memoryEngine, MEMORY_ENGINES, defaults.memoryEngine);
    const startOnLaunch = bool(saved.startOnLaunch, defaults.startOnLaunch);
    const hasStartOnLaunch = typeof saved.startOnLaunch === "boolean";
    const gameAwarenessEnabled = typeof saved.gameAwarenessEnabled === "boolean"
      ? saved.gameAwarenessEnabled
      : bool(saved.gameModeEnabled, defaults.gameAwarenessEnabled);
    const lowSpecMode = bool(saved.lowSpecMode, defaults.lowSpecMode);

    const next: AppSettings = {
      ...defaults,
      captureRate: pick(saved.captureRate, CAPTURE_RATES, defaults.captureRate),
      paused: hasStartOnLaunch ? bool(saved.paused, !startOnLaunch) : !startOnLaunch,
      doNotDisturb: bool(saved.doNotDisturb, defaults.doNotDisturb),
      commentCooldownSeconds: finiteNumber(saved.commentCooldownSeconds, defaults.commentCooldownSeconds, 5, 600),
      petMode: pick(saved.petMode, PET_MODES, defaults.petMode),
      petEnabled: bool(saved.petEnabled, defaults.petEnabled),
      petSize: finiteNumber(saved.petSize, defaults.petSize, 0.55, 1.6),
      petSpeed: finiteNumber(saved.petSpeed, defaults.petSpeed, 0.4, 2),
      petInteractionStrength: finiteNumber(saved.petInteractionStrength, defaults.petInteractionStrength, 0, 2),
      petSceneReactions: bool(saved.petSceneReactions, defaults.petSceneReactions),
      startOnLaunch,
      startupVoiceCueEnabled: bool(saved.startupVoiceCueEnabled, defaults.startupVoiceCueEnabled),
      gameAwarenessEnabled,
      lowSpecMode,
      smartObservationEnabled: bool(saved.smartObservationEnabled, defaults.smartObservationEnabled),
      smartLocalCheckIntervalSeconds: finiteNumber(saved.smartLocalCheckIntervalSeconds, defaults.smartLocalCheckIntervalSeconds, 1, 30),
      smartModelMinIntervalSeconds: finiteNumber(saved.smartModelMinIntervalSeconds, lowSpecMode ? 25 : defaults.smartModelMinIntervalSeconds, 5, 300),
      smartSameSceneCacheSeconds: finiteNumber(saved.smartSameSceneCacheSeconds, defaults.smartSameSceneCacheSeconds, 10, 600),
      smartWindowSwitchDelayMs: finiteNumber(saved.smartWindowSwitchDelayMs, defaults.smartWindowSwitchDelayMs, 0, 5000),
      smartErrorTriggerEnabled: bool(saved.smartErrorTriggerEnabled, defaults.smartErrorTriggerEnabled),
      smartWindowChangeTriggerEnabled: bool(saved.smartWindowChangeTriggerEnabled, defaults.smartWindowChangeTriggerEnabled),
      smartVisualChangeTriggerEnabled: bool(saved.smartVisualChangeTriggerEnabled, defaults.smartVisualChangeTriggerEnabled),
      smartOcrChangeTriggerEnabled: bool(saved.smartOcrChangeTriggerEnabled, defaults.smartOcrChangeTriggerEnabled),
      selectedBundleId: stringValue(saved.selectedBundleId, defaults.selectedBundleId),
      selectedCharacterProfileId: stringValue(saved.selectedCharacterProfileId, defaults.selectedCharacterProfileId),
      selectedVoiceProfileId: stringValue(saved.selectedVoiceProfileId, defaults.selectedVoiceProfileId),
      selectedObservationProfileId: stringValue(saved.selectedObservationProfileId, defaults.selectedObservationProfileId),
      selectedUiThemeProfileId: stringValue(saved.selectedUiThemeProfileId, defaults.selectedUiThemeProfileId),
      customCharacters: objects<CharacterProfile>(saved.customCharacters),
      customVoiceProfiles: objects<VoiceProfile>(saved.customVoiceProfiles),
      customObservationProfiles: objects<ObservationProfile>(saved.customObservationProfiles),
      customUiThemes: [...defaults.customUiThemes, ...objects<UiThemeProfile>(saved.customUiThemes).filter((theme) => theme.id !== "midnight")],
      customBundles: objects<UserPresetBundle>(saved.customBundles),
      blacklist: stringArray(saved.blacklist),
      memoryEngine,
      memoryEnabled: bool(saved.memoryEnabled, defaults.memoryEnabled) && memoryEngine !== "off",
      selectedPreset: typeof saved.selectedPreset === "string" ? saved.selectedPreset : defaults.selectedPreset,
      customPersona: typeof saved.customPersona === "string" ? saved.customPersona : defaults.customPersona,
      replyFrequency: pick(saved.replyFrequency, REPLY_FREQUENCIES, defaults.replyFrequency),
      gameModeAuto: bool(saved.gameModeAuto, defaults.gameModeAuto),
      gameModeEnabled: gameAwarenessEnabled,
      readParentheticals: bool(saved.readParentheticals, defaults.readParentheticals),
      voicePanelEnabled: bool(saved.voicePanelEnabled, defaults.voicePanelEnabled),
      voiceSubtitleEnabled: bool(saved.voiceSubtitleEnabled, defaults.voiceSubtitleEnabled),
      voiceBarsMode: pick(saved.voiceBarsMode, VOICE_BARS_MODES, defaults.voiceBarsMode),
      voiceVolume: finiteNumber(saved.voiceVolume, defaults.voiceVolume, 0, 100),
      voiceFadeInEnabled: bool(saved.voiceFadeInEnabled, defaults.voiceFadeInEnabled),
      voiceFadeOutEnabled: bool(saved.voiceFadeOutEnabled, defaults.voiceFadeOutEnabled),
      maxSpokenChars: finiteNumber(saved.maxSpokenChars, lowSpecMode ? 24 : defaults.maxSpokenChars, 8, 200),
      ttsTimeoutSeconds: finiteNumber(saved.ttsTimeoutSeconds, lowSpecMode ? 75 : defaults.ttsTimeoutSeconds, 10, 180),
      provider: {
        ...defaults.provider,
        ...savedProvider,
        kind: pick(savedProvider.kind, PROVIDER_KINDS, defaults.provider.kind),
        baseUrl: typeof savedProvider.baseUrl === "string" ? savedProvider.baseUrl : defaults.provider.baseUrl,
        model: typeof savedProvider.model === "string" ? savedProvider.model : defaults.provider.model,
        visionModel: typeof savedProvider.visionModel === "string" ? savedProvider.visionModel : (typeof savedProvider.model === "string" ? savedProvider.model : defaults.provider.visionModel),
        apiKey: undefined
      },
      voice: {
        ...defaults.voice,
        ...savedVoice,
        engine: pick(savedVoice.engine, VOICE_ENGINES, defaults.voice.engine),
        endpoint: typeof savedVoice.endpoint === "string" ? savedVoice.endpoint : defaults.voice.endpoint,
        speaker: typeof savedVoice.speaker === "string" ? savedVoice.speaker : defaults.voice.speaker,
        language: typeof savedVoice.language === "string" ? savedVoice.language : defaults.voice.language,
        enabled: bool(savedVoice.enabled, defaults.voice.enabled)
      },
      speech: {
        ...defaults.speech,
        ...savedSpeech,
        enabled: bool(savedSpeech.enabled, defaults.speech.enabled),
        mode: pick(savedSpeech.mode, SPEECH_MODES, defaults.speech.mode),
        provider: pick(savedSpeech.provider, SPEECH_PROVIDERS, defaults.speech.provider),
        endpoint: typeof savedSpeech.endpoint === "string" ? savedSpeech.endpoint : defaults.speech.endpoint,
        model: typeof savedSpeech.model === "string" ? savedSpeech.model : defaults.speech.model,
        apiKey: undefined,
        postVoiceListenDelaySeconds: finiteNumber(savedSpeech.postVoiceListenDelaySeconds, defaults.speech.postVoiceListenDelaySeconds, 0, 10),
        vadThreshold: finiteNumber(savedSpeech.vadThreshold, defaults.speech.vadThreshold, 0.01, 1),
        hotkeyEnabled: bool(savedSpeech.hotkeyEnabled, defaults.speech.hotkeyEnabled),
        hotkeyVk: finiteNumber(savedSpeech.hotkeyVk, defaults.speech.hotkeyVk, 1, 254),
        pttCueEnabled: bool(savedSpeech.pttCueEnabled, defaults.speech.pttCueEnabled)
      },
      localSovits: {
        ...defaults.localSovits,
        ...savedSovits,
        root: typeof savedSovits.root === "string" ? savedSovits.root : defaults.localSovits.root,
        gptWeight: typeof savedSovits.gptWeight === "string" ? savedSovits.gptWeight : defaults.localSovits.gptWeight,
        sovitsWeight: typeof savedSovits.sovitsWeight === "string" ? savedSovits.sovitsWeight : defaults.localSovits.sovitsWeight,
        referenceAudio: savedSovits.referenceAudio || defaults.localSovits.referenceAudio,
        referenceText: savedSovits.referenceText || defaults.localSovits.referenceText,
        referenceLanguage: typeof savedSovits.referenceLanguage === "string" ? savedSovits.referenceLanguage : defaults.localSovits.referenceLanguage
      }
    };
    saveSettings(next);
    return next;
  } catch {
    return defaults;
  }
}

/** Secrets are deliberately excluded: Rust stores API keys in Windows Credential Manager. */
export function saveSettings(value: AppSettings) {
  localStorage.setItem(KEY, JSON.stringify({ ...value, provider: { ...value.provider, apiKey: undefined }, speech: { ...value.speech, apiKey: undefined } }));
}

export function exportSettings(value: AppSettings) {
  return JSON.stringify({
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: { ...value, provider: { ...value.provider, apiKey: undefined }, speech: { ...value.speech, apiKey: undefined } }
  }, null, 2);
}

export function isBlocked(settings: AppSettings, meta: {title: string; processName: string}) {
  const haystack = `${meta.title} ${meta.processName}`.toLowerCase();
  return settings.blacklist.some((rule) => rule.trim() && haystack.includes(rule.trim().toLowerCase()));
}
