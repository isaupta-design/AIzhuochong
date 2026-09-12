import { AppSettings, CharacterProfile, ObservationProfile, UiThemeProfile, UserPresetBundle, VoiceProfile } from "../types";
import { personaById } from "./personas";

const stamp = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function profileFromCurrent(settings: AppSettings, name = "当前方案") {
  const preset = personaById(settings.selectedPreset);
  const suffix = Date.now().toString(36);
  const characterId = `character-${suffix}`;
  const voiceId = `voice-${suffix}`;
  const observationId = `observation-${suffix}`;
  const themeId = `theme-${suffix}`;
  const bundleId = `bundle-${suffix}`;

  const character: CharacterProfile = {
    id: characterId,
    name: `${name} 角色`,
    description: preset.description,
    systemPrompt: settings.customPersona || preset.systemPrompt,
    addressStyle: settings.selectedPreset === "bt" ? "铁驭 / 搭档" : "自然称呼用户",
    replyStyle: "短句、可执行、保持当前角色语气",
    voiceProfileId: voiceId,
    memoryEngine: settings.memoryEngine,
    readParentheticals: settings.readParentheticals,
    voicePanelEnabled: settings.voicePanelEnabled,
    voiceSubtitleEnabled: settings.voiceSubtitleEnabled
  };

  const voice: VoiceProfile = {
    id: voiceId,
    name: `${name} 语音`,
    engine: settings.voice.engine,
    endpoint: settings.voice.endpoint,
    speaker: settings.voice.speaker,
    language: settings.voice.language,
    localSovits: { ...settings.localSovits },
    volume: settings.voiceVolume,
    maxSpokenChars: settings.maxSpokenChars,
    ttsTimeoutSeconds: settings.ttsTimeoutSeconds,
    fadeInEnabled: settings.voiceFadeInEnabled,
    fadeOutEnabled: settings.voiceFadeOutEnabled,
    barsMode: settings.voiceBarsMode
  };

  const observation: ObservationProfile = {
    id: observationId,
    name: `${name} 观察`,
    captureRate: settings.captureRate,
    replyFrequency: settings.replyFrequency,
    commentCooldownSeconds: settings.commentCooldownSeconds,
    gameAwarenessEnabled: settings.gameAwarenessEnabled,
    gameModeAuto: settings.gameModeAuto,
    lowSpecMode: settings.lowSpecMode,
    smartObservationEnabled: settings.smartObservationEnabled,
    smartLocalCheckIntervalSeconds: settings.smartLocalCheckIntervalSeconds,
    smartModelMinIntervalSeconds: settings.smartModelMinIntervalSeconds,
    smartSameSceneCacheSeconds: settings.smartSameSceneCacheSeconds,
    smartWindowSwitchDelayMs: settings.smartWindowSwitchDelayMs,
    smartErrorTriggerEnabled: settings.smartErrorTriggerEnabled,
    smartWindowChangeTriggerEnabled: settings.smartWindowChangeTriggerEnabled,
    smartVisualChangeTriggerEnabled: settings.smartVisualChangeTriggerEnabled,
    smartOcrChangeTriggerEnabled: settings.smartOcrChangeTriggerEnabled,
    blacklist: [...settings.blacklist]
  };

  const theme: UiThemeProfile = {
    id: themeId,
    name: `${name} 主题`,
    accentColor: "#9f75ff",
    panelOpacity: 0.92,
    compactMode: false,
    fontScale: 1
  };

  const bundle: UserPresetBundle = {
    id: bundleId,
    name,
    description: "由当前桌宠设置复制而来",
    characterProfileId: characterId,
    voiceProfileId: voiceId,
    observationProfileId: observationId,
    uiThemeProfileId: themeId,
    createdAt: stamp(),
    updatedAt: stamp()
  };

  return { character, voice, observation, theme, bundle };
}

export function addBundleFromCurrent(settings: AppSettings, name = "我的桌宠方案"): AppSettings {
  const snapshot = profileFromCurrent(settings, name);
  return {
    ...settings,
    selectedBundleId: snapshot.bundle.id,
    selectedCharacterProfileId: snapshot.character.id,
    selectedVoiceProfileId: snapshot.voice.id,
    selectedObservationProfileId: snapshot.observation.id,
    selectedUiThemeProfileId: snapshot.theme.id,
    customCharacters: [...settings.customCharacters, snapshot.character],
    customVoiceProfiles: [...settings.customVoiceProfiles, snapshot.voice],
    customObservationProfiles: [...settings.customObservationProfiles, snapshot.observation],
    customUiThemes: [...settings.customUiThemes, snapshot.theme],
    customBundles: [...settings.customBundles, snapshot.bundle]
  };
}

export function applyBundle(settings: AppSettings, bundleId: string): AppSettings {
  const bundle = settings.customBundles.find((item) => item.id === bundleId);
  if (!bundle) return { ...settings, selectedBundleId: bundleId };
  const character = settings.customCharacters.find((item) => item.id === bundle.characterProfileId);
  const voice = settings.customVoiceProfiles.find((item) => item.id === bundle.voiceProfileId);
  const observation = settings.customObservationProfiles.find((item) => item.id === bundle.observationProfileId);
  const theme = settings.customUiThemes.find((item) => item.id === bundle.uiThemeProfileId);
  return {
    ...settings,
    selectedBundleId: bundle.id,
    selectedCharacterProfileId: bundle.characterProfileId,
    selectedVoiceProfileId: bundle.voiceProfileId,
    selectedObservationProfileId: bundle.observationProfileId,
    customPersona: character?.systemPrompt ?? settings.customPersona,
    memoryEngine: character?.memoryEngine ?? settings.memoryEngine,
    memoryEnabled: character ? character.memoryEngine !== "off" : settings.memoryEnabled,
    readParentheticals: character?.readParentheticals ?? settings.readParentheticals,
    voicePanelEnabled: character?.voicePanelEnabled ?? settings.voicePanelEnabled,
    voiceSubtitleEnabled: character?.voiceSubtitleEnabled ?? settings.voiceSubtitleEnabled,
    voice: voice ? { ...settings.voice, engine: voice.engine, endpoint: voice.endpoint, speaker: voice.speaker, language: voice.language } : settings.voice,
    localSovits: voice?.localSovits ?? settings.localSovits,
    voiceVolume: voice?.volume ?? settings.voiceVolume,
    maxSpokenChars: voice?.maxSpokenChars ?? settings.maxSpokenChars,
    ttsTimeoutSeconds: voice?.ttsTimeoutSeconds ?? settings.ttsTimeoutSeconds,
    voiceFadeInEnabled: voice?.fadeInEnabled ?? settings.voiceFadeInEnabled,
    voiceFadeOutEnabled: voice?.fadeOutEnabled ?? settings.voiceFadeOutEnabled,
    voiceBarsMode: voice?.barsMode ?? settings.voiceBarsMode,
    captureRate: observation?.captureRate ?? settings.captureRate,
    replyFrequency: observation?.replyFrequency ?? settings.replyFrequency,
    commentCooldownSeconds: observation?.commentCooldownSeconds ?? settings.commentCooldownSeconds,
    gameAwarenessEnabled: observation?.gameAwarenessEnabled ?? settings.gameAwarenessEnabled,
    gameModeEnabled: observation?.gameAwarenessEnabled ?? settings.gameModeEnabled,
    gameModeAuto: observation?.gameModeAuto ?? settings.gameModeAuto,
    lowSpecMode: observation?.lowSpecMode ?? settings.lowSpecMode,
    smartObservationEnabled: observation?.smartObservationEnabled ?? settings.smartObservationEnabled,
    smartLocalCheckIntervalSeconds: observation?.smartLocalCheckIntervalSeconds ?? settings.smartLocalCheckIntervalSeconds,
    smartModelMinIntervalSeconds: observation?.smartModelMinIntervalSeconds ?? settings.smartModelMinIntervalSeconds,
    smartSameSceneCacheSeconds: observation?.smartSameSceneCacheSeconds ?? settings.smartSameSceneCacheSeconds,
    smartWindowSwitchDelayMs: observation?.smartWindowSwitchDelayMs ?? settings.smartWindowSwitchDelayMs,
    smartErrorTriggerEnabled: observation?.smartErrorTriggerEnabled ?? settings.smartErrorTriggerEnabled,
    smartWindowChangeTriggerEnabled: observation?.smartWindowChangeTriggerEnabled ?? settings.smartWindowChangeTriggerEnabled,
    smartVisualChangeTriggerEnabled: observation?.smartVisualChangeTriggerEnabled ?? settings.smartVisualChangeTriggerEnabled,
    smartOcrChangeTriggerEnabled: observation?.smartOcrChangeTriggerEnabled ?? settings.smartOcrChangeTriggerEnabled,
    blacklist: observation?.blacklist ?? settings.blacklist,
    selectedUiThemeProfileId: theme?.id ?? settings.selectedUiThemeProfileId
  };
}

export function deleteBundle(settings: AppSettings, bundleId: string): AppSettings {
  const bundle = settings.customBundles.find((item) => item.id === bundleId);
  if (!bundle) return settings;
  return {
    ...settings,
    selectedBundleId: settings.selectedBundleId === bundleId ? "current" : settings.selectedBundleId,
    customBundles: settings.customBundles.filter((item) => item.id !== bundleId),
    customCharacters: settings.customCharacters.filter((item) => item.id !== bundle.characterProfileId),
    customVoiceProfiles: settings.customVoiceProfiles.filter((item) => item.id !== bundle.voiceProfileId),
    customObservationProfiles: settings.customObservationProfiles.filter((item) => item.id !== bundle.observationProfileId),
    customUiThemes: settings.customUiThemes.filter((item) => item.id !== bundle.uiThemeProfileId || item.id === "midnight")
  };
}

export function importPresetJson(settings: AppSettings, raw: string): AppSettings {
  const parsed = JSON.parse(raw);
  const incoming = parsed.settings ?? parsed;
  return {
    ...settings,
    customCharacters: mergeById(settings.customCharacters, incoming.customCharacters),
    customVoiceProfiles: mergeById(settings.customVoiceProfiles, incoming.customVoiceProfiles),
    customObservationProfiles: mergeById(settings.customObservationProfiles, incoming.customObservationProfiles),
    customUiThemes: mergeById(settings.customUiThemes, incoming.customUiThemes),
    customBundles: mergeById(settings.customBundles, incoming.customBundles)
  };
}

function mergeById<T extends { id: string }>(base: T[], incoming: unknown): T[] {
  if (!Array.isArray(incoming)) return base;
  const map = new Map(base.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (item && typeof item === "object" && typeof (item as T).id === "string") {
      map.set((item as T).id, item as T);
    }
  }
  return [...map.values()].slice(0, 80);
}
