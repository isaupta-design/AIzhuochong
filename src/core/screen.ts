import { invoke } from "@tauri-apps/api/core";
import { LightScreenCheck, ScreenContext } from "../types";

/** Native command returns a base64 PNG and Windows OCR text; no file is written. */
export async function captureScreen(blacklist: string[]): Promise<ScreenContext> {
  return invoke<ScreenContext>("capture_screen_context", { blacklist });
}

/** Lightweight local-only screen check for smart observation. It returns no screenshot/base64. */
export async function lightScreenCheck(blacklist: string[], includeOcr: boolean): Promise<LightScreenCheck> {
  return invoke<LightScreenCheck>("light_screen_check", { blacklist, includeOcr });
}
