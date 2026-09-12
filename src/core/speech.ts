import { invoke } from "@tauri-apps/api/core";
import { AppSettings, RecordedAudio, SpeechRuntimeState } from "../types";

export function canStartSpeechInput(state: SpeechRuntimeState, voiceBusy: boolean, blockedUntil: number, nowMs = Date.now()) {
  return state !== "recording" && state !== "transcribing" && !voiceBusy && nowMs >= blockedUntil;
}

export function postVoiceBlockedUntil(durationMs: number, delaySeconds: number, nowMs = Date.now()) {
  return nowMs + Math.max(0, durationMs) + Math.max(0, delaySeconds) * 1000;
}

export async function setSpeechApiKey(apiKey: string) {
  await invoke("set_speech_api_key", { apiKey });
}

export async function getSpeechApiKey(): Promise<string | null> {
  return await invoke<string | null>("get_speech_api_key");
}

export async function startRecordingCommand() {
  await invoke("start_recording");
}

export async function stopRecordingCommand(audioBase64: string, mimeType: string): Promise<RecordedAudio> {
  return await invoke<RecordedAudio>("stop_recording", { audioBase64, mimeType });
}

export async function deleteRecordedAudio(path: string) {
  await invoke("delete_recorded_audio", { path });
}

export async function transcribeAudio(settings: AppSettings, audio: RecordedAudio): Promise<string> {
  return await invoke<string>("transcribe_audio", {
    provider: settings.speech.provider,
    endpoint: settings.speech.endpoint,
    model: settings.speech.model,
    audioPath: audio.path,
    mimeType: audio.mimeType
  });
}

export async function configureSpeechHotkey(enabled: boolean, vkCode: number) {
  await invoke("configure_speech_hotkey", { enabled, vkCode });
}

export async function playBuiltinPttCue() {
  await invoke("play_builtin_ptt_cue");
}
