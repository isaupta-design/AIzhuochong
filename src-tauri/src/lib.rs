use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageOutputFormat, RgbaImage};
use image::imageops::FilterType;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{atomic::{AtomicBool, AtomicU32, Ordering}, mpsc::Sender, Mutex, OnceLock};
use tauri::{menu::{MenuBuilder, MenuItemBuilder}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}, AppHandle, Emitter, Manager};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, POINT, WPARAM};
#[cfg(windows)]
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CallNextHookEx, DispatchMessageW, GetMessageW, GetWindowLongW, SetWindowsHookExW, SetWindowLongW, SetWindowPos, ShowWindow, TranslateMessage,
  GetCursorPos, HC_ACTION, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP, GWL_EXSTYLE, SWP_NOACTIVATE,
  SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};
#[cfg(windows)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_FILENAME, SND_NODEFAULT};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowMeta { title: String, process_name: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenContext { image_data_url: String, ocr_text: String, window: WindowMeta, captured_at: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LightScreenCheck { window: WindowMeta, captured_at: String, visual_hash: String, ocr_text: String, signature: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VoicePlaybackInfo { duration_ms: u32, levels: Vec<f32> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordedAudio { path: String, mime_type: String, bytes: usize }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpeechHotkeyEvent { pressed: bool }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PetPointerEvent { x: i32, y: i32, speed: f32, pressed: bool, timestamp: u128 }
struct SovitsService(Mutex<Option<Child>>);

static HOTKEY_ENABLED: AtomicBool = AtomicBool::new(false);
static HOTKEY_VK: AtomicU32 = AtomicU32::new(119);
static HOTKEY_DOWN: AtomicBool = AtomicBool::new(false);
static HOTKEY_HOOK_STARTED: AtomicBool = AtomicBool::new(false);
static HOTKEY_TX: OnceLock<Mutex<Option<Sender<bool>>>> = OnceLock::new();
static PET_POINTER_STARTED: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
fn ensure_pet_pointer_tracking(app: AppHandle) {
  if PET_POINTER_STARTED.swap(true, Ordering::SeqCst) { return; }
  std::thread::spawn(move || {
    let mut previous = POINT { x: 0, y: 0 };
    let mut was_pressed = false;
    loop {
      let mut point = POINT { x: 0, y: 0 };
      if unsafe { GetCursorPos(&mut point) } != 0 {
        let dx = point.x - previous.x;
        let dy = point.y - previous.y;
        let pressed = unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } < 0;
        let speed = (((dx * dx + dy * dy) as f32).sqrt() / 33.0).min(20.0);
        if dx != 0 || dy != 0 || pressed != was_pressed {
          let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|value| value.as_millis()).unwrap_or(0);
          let _ = app.emit("pet-pointer", PetPointerEvent { x: point.x, y: point.y, speed, pressed, timestamp });
        }
        previous = point;
        was_pressed = pressed;
      }
      std::thread::sleep(std::time::Duration::from_millis(33));
    }
  });
}

#[tauri::command]
fn start_pet_pointer_tracking(app: AppHandle) -> Result<(), String> {
  #[cfg(windows)] { ensure_pet_pointer_tracking(app); Ok(()) }
  #[cfg(not(windows))] { let _ = app; Err("Desktop pet pointer tracking is currently Windows-only".into()) }
}

fn is_non_game_overlay_window(haystack: &str) -> bool {
  [
    "ai 桌宠", "ai 桌宠设置中心", "ai-desktop-pet", "bt 通讯面板", "bt 字幕条",
    "voice_overlay", "subtitle_overlay", "settings",
    "nvidia overlay", "geforce overlay", "nvidia share", "nvcontainer", "nvidia geforce overlay",
  ].iter().any(|needle| haystack.contains(needle))
}

#[cfg(windows)]
fn make_overlay_no_activate(window: &tauri::WebviewWindow) {
  if let Ok(hwnd) = window.hwnd() {
    unsafe {
      let hwnd = hwnd.0;
      let style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
      SetWindowLongW(hwnd, GWL_EXSTYLE, (style | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT) as i32);
      SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
  }
}

#[tauri::command]
fn show_voice_overlay_no_activate(app: AppHandle, label: String) -> Result<(), String> {
  let window = app.get_webview_window(&label).ok_or("未找到语音 HUD 窗口")?;
  #[cfg(windows)]
  {
    make_overlay_no_activate(&window);
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe { ShowWindow(hwnd.0, SW_SHOWNOACTIVATE); }
    Ok(())
  }
  #[cfg(not(windows))]
  {
    window.show().map_err(|e| e.to_string())
  }
}

fn active_window() -> WindowMeta {
  match active_win_pos_rs::get_active_window() {
    Ok(window) => WindowMeta { title: window.title, process_name: format!("{:?}", window.process_path) },
    Err(_) => WindowMeta { title: String::new(), process_name: String::new() },
  }
}

/// Runs a user-installed local Tesseract executable via stdin/stdout. PNG bytes
/// never touch disk; absence of Tesseract simply leaves OCR text empty.
fn local_ocr(png: &[u8]) -> String {
  let mut command = Command::new("tesseract");
  command.args(["stdin", "stdout", "-l", "chi_sim+eng"])
    .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
  #[cfg(windows)]
  command.creation_flags(CREATE_NO_WINDOW);
  let Ok(mut child) = command.spawn() else { return String::new() };
  if let Some(stdin) = child.stdin.as_mut() { if stdin.write_all(png).is_err() { return String::new(); } }
  match child.wait_with_output() { Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout).trim().to_owned(), _ => String::new() }
}

#[tauri::command]
fn capture_screen_context(blacklist: Vec<String>) -> Result<ScreenContext, String> {
  // Check before capture/OCR so excluded apps never produce pixels or text.
  let (window, window_position) = match active_win_pos_rs::get_active_window() {
    Ok(active) => (WindowMeta { title: active.title, process_name: format!("{:?}", active.process_path) }, active.position),
    Err(_) => (active_window(), active_win_pos_rs::WindowPosition::default()),
  };
  let haystack = format!("{} {}", window.title, window.process_name).to_lowercase();
  if blacklist.iter().any(|rule| !rule.trim().is_empty() && haystack.contains(&rule.trim().to_lowercase())) {
    return Err("已跳过黑名单窗口".into());
  }
  let screen = screenshots::Screen::all().map_err(|e| e.to_string())?.into_iter().next().ok_or("未找到可用屏幕")?;
  let capture_entire_screen = is_non_game_overlay_window(&haystack);
  let x = window_position.x.max(0.0) as i32; let y = window_position.y.max(0.0) as i32;
  let width = window_position.width.max(1.0) as u32; let height = window_position.height.max(1.0) as u32;
  // Some fullscreen games report a 1x1 or otherwise invalid foreground
  // rectangle. Vision APIs reject such tiny images, so fall back to the
  // monitor screenshot when the active-window rectangle is not usable.
  let shot = if !capture_entire_screen && width > 10 && height > 10 {
    screen.capture_area(x, y, width, height).or_else(|_| screen.capture()).map_err(|e| e.to_string())?
  } else {
    screen.capture().map_err(|e| e.to_string())?
  };
  let (width, height) = (shot.width(), shot.height());
  let rgba = RgbaImage::from_raw(width, height, shot.into_raw()).ok_or("截图像素格式无效")?;
  let mut image = DynamicImage::ImageRgba8(rgba);
  image = resize_for_vision(image);
  let mut png = Vec::new();
  image.write_to(&mut Cursor::new(&mut png), ImageOutputFormat::Png).map_err(|e| e.to_string())?;
  let ocr_text = local_ocr(&png);
  let window = if capture_entire_screen {
    WindowMeta { title: "全屏画面（已忽略桌宠/NVIDIA Overlay 前台）".into(), process_name: "screen".into() }
  } else { window };
  Ok(ScreenContext { image_data_url: format!("data:image/png;base64,{}", STANDARD.encode(&png)), ocr_text, window, captured_at: chrono_like_now() })
}

fn visual_hash(image: &DynamicImage) -> String {
  let small = image.resize_exact(32, 18, FilterType::Triangle).to_luma8();
  let pixels: Vec<u8> = small.pixels().map(|pixel| pixel[0]).collect();
  let avg = if pixels.is_empty() { 0.0 } else { pixels.iter().map(|value| *value as u64).sum::<u64>() as f32 / pixels.len() as f32 };
  pixels.into_iter().map(|value| if value as f32 >= avg { '1' } else { '0' }).collect()
}

fn shortened_signature_text(text: &str) -> String {
  text.chars().filter(|c| !c.is_whitespace()).take(80).collect()
}

#[tauri::command]
fn light_screen_check(blacklist: Vec<String>, include_ocr: bool) -> Result<LightScreenCheck, String> {
  let (window, window_position) = match active_win_pos_rs::get_active_window() {
    Ok(active) => (WindowMeta { title: active.title, process_name: format!("{:?}", active.process_path) }, active.position),
    Err(_) => (active_window(), active_win_pos_rs::WindowPosition::default()),
  };
  let haystack = format!("{} {}", window.title, window.process_name).to_lowercase();
  if blacklist.iter().any(|rule| !rule.trim().is_empty() && haystack.contains(&rule.trim().to_lowercase())) {
    return Err("skipped by blacklist".into());
  }
  let screen = screenshots::Screen::all().map_err(|e| e.to_string())?.into_iter().next().ok_or("no screen available")?;
  let capture_entire_screen = is_non_game_overlay_window(&haystack);
  let x = window_position.x.max(0.0) as i32; let y = window_position.y.max(0.0) as i32;
  let width = window_position.width.max(1.0) as u32; let height = window_position.height.max(1.0) as u32;
  let shot = if !capture_entire_screen && width > 10 && height > 10 {
    screen.capture_area(x, y, width, height).or_else(|_| screen.capture()).map_err(|e| e.to_string())?
  } else {
    screen.capture().map_err(|e| e.to_string())?
  };
  let (width, height) = (shot.width(), shot.height());
  let rgba = RgbaImage::from_raw(width, height, shot.into_raw()).ok_or("invalid screenshot pixels")?;
  let image = DynamicImage::ImageRgba8(rgba);
  let hash = visual_hash(&image);
  let mut ocr_text = String::new();
  if include_ocr {
    let mut png = Vec::new();
    resize_for_vision(image.clone()).write_to(&mut Cursor::new(&mut png), ImageOutputFormat::Png).map_err(|e| e.to_string())?;
    ocr_text = local_ocr(&png);
  }
  let window = if capture_entire_screen {
    WindowMeta { title: "fullscreen screen".into(), process_name: "screen".into() }
  } else { window };
  let signature = format!("{}|{}|{}|{}", window.process_name, window.title, hash, shortened_signature_text(&ocr_text));
  Ok(LightScreenCheck { window, captured_at: chrono_like_now(), visual_hash: hash, ocr_text, signature })
}

fn chrono_like_now() -> String { format!("{:?}", std::time::SystemTime::now()) }

#[cfg(windows)]
unsafe extern "system" fn speech_keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  if code == HC_ACTION as i32 && HOTKEY_ENABLED.load(Ordering::Relaxed) {
    let event = wparam as u32;
    let info = &*(lparam as *const KBDLLHOOKSTRUCT);
    if info.vkCode == HOTKEY_VK.load(Ordering::Relaxed) {
      let pressed = event == WM_KEYDOWN || event == WM_SYSKEYDOWN;
      let released = event == WM_KEYUP || event == WM_SYSKEYUP;
      if pressed && !HOTKEY_DOWN.swap(true, Ordering::SeqCst) {
        if let Some(lock) = HOTKEY_TX.get() {
          if let Ok(guard) = lock.lock() {
            if let Some(tx) = guard.as_ref() { let _ = tx.send(true); }
          }
        }
      } else if released && HOTKEY_DOWN.swap(false, Ordering::SeqCst) {
        if let Some(lock) = HOTKEY_TX.get() {
          if let Ok(guard) = lock.lock() {
            if let Some(tx) = guard.as_ref() { let _ = tx.send(false); }
          }
        }
      }
    }
  }
  CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(windows)]
fn ensure_speech_hotkey_hook(app: AppHandle) {
  if HOTKEY_HOOK_STARTED.swap(true, Ordering::SeqCst) { return; }
  let (tx, rx) = std::sync::mpsc::channel::<bool>();
  let lock = HOTKEY_TX.get_or_init(|| Mutex::new(None));
  if let Ok(mut guard) = lock.lock() { *guard = Some(tx); }
  std::thread::spawn(move || {
    while let Ok(pressed) = rx.recv() {
      let _ = app.emit("speech-hotkey", SpeechHotkeyEvent { pressed });
    }
  });
  std::thread::spawn(move || unsafe {
    let module: HINSTANCE = GetModuleHandleW(std::ptr::null());
    let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(speech_keyboard_proc), module, 0);
    if hook.is_null() {
      HOTKEY_ENABLED.store(false, Ordering::SeqCst);
      return;
    }
    let mut msg: MSG = std::mem::zeroed();
    while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
  });
}

#[tauri::command]
fn configure_speech_hotkey(app: AppHandle, enabled: bool, vk_code: u32) -> Result<(), String> {
  HOTKEY_VK.store(vk_code.clamp(1, 254), Ordering::SeqCst);
  HOTKEY_ENABLED.store(enabled, Ordering::SeqCst);
  if enabled {
    ensure_speech_hotkey_hook(app);
  }
  Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
fn configure_speech_hotkey(_app: AppHandle, _enabled: bool, _vk_code: u32) -> Result<(), String> {
  Err("全局按键目前仅支持 Windows。".into())
}

fn fixed_ptt_cue_wav() -> Vec<u8> {
  let sample_rate = 22050u32;
  let duration_ms = 360u32;
  let samples = (sample_rate * duration_ms / 1000) as usize;
  let data_bytes = samples * 2;
  let mut bytes = Vec::with_capacity(44 + data_bytes);
  bytes.extend_from_slice(b"RIFF");
  bytes.extend_from_slice(&(36 + data_bytes as u32).to_le_bytes());
  bytes.extend_from_slice(b"WAVEfmt ");
  bytes.extend_from_slice(&16u32.to_le_bytes());
  bytes.extend_from_slice(&1u16.to_le_bytes());
  bytes.extend_from_slice(&1u16.to_le_bytes());
  bytes.extend_from_slice(&sample_rate.to_le_bytes());
  bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
  bytes.extend_from_slice(&2u16.to_le_bytes());
  bytes.extend_from_slice(&16u16.to_le_bytes());
  bytes.extend_from_slice(b"data");
  bytes.extend_from_slice(&(data_bytes as u32).to_le_bytes());
  for index in 0..samples {
    let t = index as f32 / sample_rate as f32;
    let freq = if t < 0.18 { 680.0 } else { 920.0 };
    let env = if index < 900 { index as f32 / 900.0 } else if samples - index < 1600 { (samples - index) as f32 / 1600.0 } else { 1.0 };
    let sample = ((t * freq * std::f32::consts::TAU).sin() * env.clamp(0.0, 1.0) * 0.28 * i16::MAX as f32) as i16;
    bytes.extend_from_slice(&sample.to_le_bytes());
  }
  bytes
}

#[tauri::command]
fn play_builtin_ptt_cue() -> Result<(), String> {
  let audio_path = std::env::temp_dir().join("ai-desktop-pet-fixed-ptt-cue.wav");
  std::fs::write(&audio_path, fixed_ptt_cue_wav()).map_err(|e| e.to_string())?;
  use std::os::windows::ffi::OsStrExt;
  let audio_path_wide: Vec<u16> = audio_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
  unsafe { PlaySoundW(audio_path_wide.as_ptr(), std::ptr::null_mut(), SND_FILENAME | SND_ASYNC | SND_NODEFAULT); }
  Ok(())
}

fn resize_for_vision(image: DynamicImage) -> DynamicImage {
  let width = image.width(); let height = image.height();
  let longest = width.max(height);
  if longest <= 1280 { return image; }
  let scale = 1280.0 / longest as f32;
  let next_width = ((width as f32 * scale).round() as u32).max(16);
  let next_height = ((height as f32 * scale).round() as u32).max(16);
  image.resize(next_width, next_height, FilterType::Triangle)
}

fn credential() -> Result<Entry, String> { Entry::new("AI Desktop Pet", "llm-api-key").map_err(|e| e.to_string()) }
fn speech_credential() -> Result<Entry, String> { Entry::new("AI Desktop Pet", "speech-api-key").map_err(|e| e.to_string()) }
#[tauri::command]
fn set_api_key(api_key: String) -> Result<(), String> { credential()?.set_password(&api_key).map_err(|e| e.to_string()) }
#[tauri::command]
fn get_api_key() -> Result<Option<String>, String> {
  match credential()?.get_password() { Ok(key) => Ok(Some(key)), Err(keyring::Error::NoEntry) => Ok(None), Err(e) => Err(e.to_string()) }
}
#[tauri::command]
fn set_speech_api_key(api_key: String) -> Result<(), String> { speech_credential()?.set_password(&api_key).map_err(|e| e.to_string()) }
#[tauri::command]
fn get_speech_api_key() -> Result<Option<String>, String> {
  match speech_credential()?.get_password() { Ok(key) => Ok(Some(key)), Err(keyring::Error::NoEntry) => Ok(None), Err(e) => Err(e.to_string()) }
}

#[tauri::command]
fn start_sovits_service(root: String, state: tauri::State<SovitsService>) -> Result<(), String> {
  let mut service = state.0.lock().map_err(|_| "语音服务状态锁定失败")?;
  if let Some(child) = service.as_mut() {
    match child.try_wait() {
      Ok(None) => return Ok(()),
      Ok(Some(_)) | Err(_) => { *service = None; }
    }
  }
  let python = std::path::Path::new(&root).join("runtime").join("python.exe");
  let api = std::path::Path::new(&root).join("api_v2.py");
  if !python.exists() || !api.exists() { return Err("未找到 GPT-SoVITS v2pro 的 runtime\\python.exe 或 api_v2.py".into()); }
  let mut command = Command::new(python);
  command.args(["-I", "api_v2.py", "-a", "127.0.0.1", "-p", "9880"]).current_dir(root).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
  #[cfg(windows)]
  command.creation_flags(CREATE_NO_WINDOW);
  let child = command.spawn().map_err(|e| e.to_string())?;
  *service = Some(child); Ok(())
}
#[tauri::command]
fn stop_sovits_service(state: tauri::State<SovitsService>) -> Result<(), String> {
  if let Some(mut child) = state.0.lock().map_err(|_| "语音服务状态锁定失败")?.take() {
    let _ = child.kill();
    let _ = child.wait();
  }
  Ok(())
}

fn sovits_url(endpoint: &str, route: &str) -> Result<reqwest::Url, String> {
  reqwest::Url::parse(&format!("{}/{}", endpoint.trim_end_matches('/'), route)).map_err(|e| e.to_string())
}
#[tauri::command]
fn load_sovits_weights(endpoint: String, gpt_weight: String, sovits_weight: String) -> Result<(), String> {
  for (route, path) in [("set_gpt_weights", gpt_weight), ("set_sovits_weights", sovits_weight)] {
    let mut url = sovits_url(&endpoint, route)?;
    url.query_pairs_mut().append_pair("weights_path", &path);
    let response = reqwest::blocking::get(url).map_err(|e| format!("无法连接 GPT-SoVITS：{e}"))?;
    if !response.status().is_success() { return Err(format!("GPT-SoVITS 加载权重失败：{}", response.status())); }
  }
  Ok(())
}

fn default_voice_levels() -> Vec<f32> {
  vec![0.18, 0.45, 0.72, 0.55, 0.86, 0.62, 0.34, 0.76, 0.50, 0.28, 0.66, 0.42]
}

fn read_u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
  Some(u16::from_le_bytes([*bytes.get(offset)?, *bytes.get(offset + 1)?]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
  Some(u32::from_le_bytes([*bytes.get(offset)?, *bytes.get(offset + 1)?, *bytes.get(offset + 2)?, *bytes.get(offset + 3)?]))
}

fn process_pcm16_wav(bytes: &mut [u8], volume: u8, fade_in: bool, fade_out: bool) -> VoicePlaybackInfo {
  let fallback = VoicePlaybackInfo { duration_ms: 1800, levels: default_voice_levels() };
  if bytes.len() < 44 || bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
    return fallback;
  }

  let mut offset = 12usize;
  let mut fmt_offset = None;
  let mut fmt_size = 0usize;
  let mut data_offset = None;
  let mut data_size = 0usize;
  while offset + 8 <= bytes.len() {
    let id = &bytes[offset..offset + 4];
    let size = read_u32_le(bytes, offset + 4).unwrap_or(0) as usize;
    let payload = offset + 8;
    if payload + size > bytes.len() { break; }
    if id == b"fmt " {
      fmt_offset = Some(payload);
      fmt_size = size;
    } else if id == b"data" {
      data_offset = Some(payload);
      data_size = size;
      break;
    }
    offset = payload + size + (size % 2);
  }

  let Some(fmt) = fmt_offset else { return fallback; };
  let Some(data) = data_offset else { return fallback; };
  if fmt_size < 16 { return fallback; }
  let audio_format = read_u16_le(bytes, fmt).unwrap_or(0);
  let channels = read_u16_le(bytes, fmt + 2).unwrap_or(0).max(1) as usize;
  let sample_rate = read_u32_le(bytes, fmt + 4).unwrap_or(0).max(1);
  let bits_per_sample = read_u16_le(bytes, fmt + 14).unwrap_or(0);
  if audio_format != 1 || bits_per_sample != 16 || data_size < 2 {
    return fallback;
  }

  let gain = (volume.min(100) as f32) / 100.0;
  let sample_count = data_size / 2;
  let frame_count = sample_count / channels;
  let duration_ms = ((frame_count as f64 / sample_rate as f64) * 1000.0).round().max(300.0) as u32;
  let fade_frames = ((sample_rate as f32) * 0.7).round() as usize;
  let buckets = 18usize;
  let frames_per_bucket = (frame_count / buckets).max(1);
  let mut sums = vec![0.0f64; buckets];
  let mut counts = vec![0usize; buckets];

  for index in 0..sample_count {
    let pos = data + index * 2;
    if pos + 2 > bytes.len() { break; }
    let sample = i16::from_le_bytes([bytes[pos], bytes[pos + 1]]);
    let frame = index / channels;
    let fade_in_gain = if fade_in && fade_frames > 0 && frame < fade_frames {
      frame as f32 / fade_frames as f32
    } else { 1.0 };
    let fade_out_gain = if fade_out && fade_frames > 0 && frame_count > 0 && frame + fade_frames > frame_count {
      ((frame_count.saturating_sub(frame)) as f32 / fade_frames as f32).clamp(0.0, 1.0)
    } else { 1.0 };
    let scaled = ((sample as f32) * gain * fade_in_gain * fade_out_gain).round().clamp(i16::MIN as f32, i16::MAX as f32) as i16;
    let out = scaled.to_le_bytes();
    bytes[pos] = out[0];
    bytes[pos + 1] = out[1];

    let bucket = (frame / frames_per_bucket).min(buckets - 1);
    let normalized = (sample as f64).abs() / i16::MAX as f64;
    sums[bucket] += normalized * normalized;
    counts[bucket] += 1;
  }

  let mut levels: Vec<f32> = sums.iter().zip(counts.iter()).map(|(sum, count)| {
    if *count == 0 { 0.15 } else { ((*sum / *count as f64).sqrt() as f32).clamp(0.08, 1.0) }
  }).collect();
  let peak = levels.iter().copied().fold(0.0f32, f32::max).max(0.1);
  for level in &mut levels { *level = ((*level / peak) * 0.92).clamp(0.12, 1.0); }
  VoicePlaybackInfo { duration_ms, levels }
}

#[tauri::command]
fn synthesize_sovits(endpoint: String, text: String, reference_audio: String, reference_text: String, text_language: String, reference_language: String, volume: u8, fade_in: bool, fade_out: bool, timeout_seconds: u64) -> Result<VoicePlaybackInfo, String> {
  if reference_audio.trim().is_empty() || reference_text.trim().is_empty() { return Err("请先填写参考 WAV 路径和参考音频文本。".into()); }
  let url = sovits_url(&endpoint, "tts")?;
  let payload = format!(
    r#"{{"text":{},"text_lang":{},"ref_audio_path":{},"prompt_text":{},"prompt_lang":{},"text_split_method":"cut5","batch_size":1,"media_type":"wav","streaming_mode":false}}"#,
    json_string(&text), json_string(&text_language), json_string(&reference_audio), json_string(&reference_text), json_string(&reference_language)
  );
  let client = reqwest::blocking::Client::builder()
    .connect_timeout(std::time::Duration::from_secs(3))
    .timeout(std::time::Duration::from_secs(timeout_seconds.clamp(10, 180)))
    .build().map_err(|e| e.to_string())?;
  let response = client.post(url).header("Content-Type", "application/json").body(payload).send().map_err(|e| format!("无法连接 GPT-SoVITS：{e}"))?;
  if !response.status().is_success() { return Err(format!("GPT-SoVITS 合成失败：{} {}", response.status(), response.text().unwrap_or_default())); }
  let mut bytes = response.bytes().map_err(|e| e.to_string())?.to_vec();
  let playback = process_pcm16_wav(&mut bytes, volume, fade_in, fade_out);
  let audio_path = std::env::temp_dir().join(format!("ai-desktop-pet-{}.wav", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis()));
  std::fs::write(&audio_path, bytes).map_err(|e| e.to_string())?;
  use std::os::windows::ffi::OsStrExt;
  let audio_path_wide: Vec<u16> = audio_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
  unsafe { PlaySoundW(audio_path_wide.as_ptr(), std::ptr::null_mut(), SND_FILENAME | SND_ASYNC | SND_NODEFAULT); }
  schedule_audio_delete(audio_path);
  Ok(playback)
}

fn cleanup_old_audio_files() {
  let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else { return; };
  let now = std::time::SystemTime::now();
  for entry in entries.flatten() {
    let path = entry.path();
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else { continue; };
    if !name.starts_with("ai-desktop-pet-") || !name.ends_with(".wav") { continue; }
    let old_enough = entry.metadata().and_then(|meta| meta.modified()).ok()
      .and_then(|modified| now.duration_since(modified).ok())
      .is_some_and(|age| age > std::time::Duration::from_secs(600));
    if old_enough { let _ = std::fs::remove_file(path); }
  }
}

fn cleanup_old_crash_dumps() {
  let Ok(local_app_data) = std::env::var("LOCALAPPDATA") else { return; };
  let crash_dir = std::path::Path::new(&local_app_data).join("CrashDumps");
  let Ok(entries) = std::fs::read_dir(crash_dir) else { return; };
  let now = std::time::SystemTime::now();
  for entry in entries.flatten() {
    let path = entry.path();
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else { continue; };
    if !name.starts_with("ai-desktop-pet.exe") || !name.ends_with(".dmp") { continue; }
    let old_enough = entry.metadata().and_then(|meta| meta.modified()).ok()
      .and_then(|modified| now.duration_since(modified).ok())
      .is_some_and(|age| age > std::time::Duration::from_secs(24 * 60 * 60));
    if old_enough { let _ = std::fs::remove_file(path); }
  }
}

fn schedule_audio_delete(path: PathBuf) {
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_secs(180));
    let _ = std::fs::remove_file(path);
  });
}

fn json_string(value: &str) -> String {
  let mut out = String::with_capacity(value.len() + 2);
  out.push('"');
  for ch in value.chars() {
    match ch {
      '"' => out.push_str("\\\""),
      '\\' => out.push_str("\\\\"),
      '\n' => out.push_str("\\n"),
      '\r' => out.push_str("\\r"),
      '\t' => out.push_str("\\t"),
      c if c <= '\u{1F}' => out.push_str(&format!("\\u{:04x}", c as u32)),
      c => out.push(c),
    }
  }
  out.push('"');
  out
}
#[tauri::command]
fn sovits_is_ready(endpoint: String) -> bool {
  sovits_url(&endpoint, "docs").ok().and_then(|url| reqwest::blocking::get(url).ok()).is_some_and(|response| response.status().is_success())
}

#[tauri::command]
fn start_recording() -> Result<(), String> { Ok(()) }

fn audio_extension(mime_type: &str) -> &'static str {
  if mime_type.contains("wav") { "wav" }
  else if mime_type.contains("mpeg") || mime_type.contains("mp3") { "mp3" }
  else if mime_type.contains("ogg") { "ogg" }
  else { "webm" }
}

#[tauri::command]
fn stop_recording(audio_base64: String, mime_type: String) -> Result<RecordedAudio, String> {
  let audio = STANDARD.decode(audio_base64).map_err(|e| format!("录音数据解析失败：{e}"))?;
  if audio.is_empty() { return Err("录音为空，请再试一次。".into()); }
  let path = std::env::temp_dir().join(format!(
    "ai-desktop-pet-speech-{}.{}",
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis(),
    audio_extension(&mime_type)
  ));
  std::fs::write(&path, &audio).map_err(|e| e.to_string())?;
  Ok(RecordedAudio { path: path.to_string_lossy().to_string(), mime_type, bytes: audio.len() })
}

fn multipart_body(boundary: &str, model: &str, audio_path: &std::path::Path, mime_type: &str) -> Result<Vec<u8>, String> {
  let filename = audio_path.file_name().and_then(|value| value.to_str()).unwrap_or("speech.webm");
  let audio = std::fs::read(audio_path).map_err(|e| e.to_string())?;
  let mut body = Vec::new();
  body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n").as_bytes());
  body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {mime_type}\r\n\r\n").as_bytes());
  body.extend_from_slice(&audio);
  body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
  Ok(body)
}

fn extract_transcript(json: &str) -> String {
  if let Ok(value) = serde_json::from_str::<serde_json::Value>(json) {
    for key in ["text", "transcript", "result"] {
      if let Some(text) = value.get(key).and_then(|item| item.as_str()) {
        return text.trim().to_string();
      }
    }
    if let Some(text) = value.pointer("/data/text").and_then(|item| item.as_str()) {
      return text.trim().to_string();
    }
  }
  json.trim().to_string()
}

#[tauri::command]
fn transcribe_audio(provider: String, endpoint: String, model: String, audio_path: String, mime_type: String) -> Result<String, String> {
  let path = std::path::Path::new(&audio_path);
  if !path.exists() { return Err("录音临时文件不存在。".into()); }
  let boundary = format!("----ai-desktop-pet-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis());
  let body = multipart_body(&boundary, &model, path, &mime_type)?;
  let client = reqwest::blocking::Client::builder()
    .connect_timeout(std::time::Duration::from_secs(5))
    .timeout(std::time::Duration::from_secs(90))
    .build().map_err(|e| e.to_string())?;
  let mut request = client.post(endpoint)
    .header("Content-Type", format!("multipart/form-data; boundary={boundary}"))
    .body(body);
  if provider == "cloud-api" {
    let key = speech_credential()?.get_password().map_err(|_| "请先填写语音识别 API Key。".to_string())?;
    request = request.header("Authorization", format!("Bearer {key}"));
  }
  let response = request.send().map_err(|e| format!("语音识别请求失败：{e}"))?;
  let status = response.status();
  let text = response.text().unwrap_or_default();
  if !status.is_success() { return Err(format!("语音识别失败：{status} {text}")); }
  let transcript = extract_transcript(&text);
  if transcript.is_empty() { return Err("语音识别没有返回文字。".into()); }
  Ok(transcript)
}

#[tauri::command]
fn delete_recorded_audio(path: String) -> Result<(), String> {
  let path = std::path::PathBuf::from(path);
  if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
    if name.starts_with("ai-desktop-pet-speech-") {
      let _ = std::fs::remove_file(path);
    }
  }
  Ok(())
}

pub fn run() {
  tauri::Builder::default().manage(SovitsService(Mutex::new(None))).plugin(tauri_plugin_opener::init()).setup(|app| {
    cleanup_old_audio_files();
    cleanup_old_crash_dumps();
    if let Some(w) = app.get_webview_window("voice_overlay") {
      #[cfg(windows)]
      make_overlay_no_activate(&w);
      let _ = w.set_ignore_cursor_events(true);
      let _ = w.set_skip_taskbar(true);
    }
    let show = MenuItemBuilder::with_id("show", "显示 / 隐藏").build(app)?;
    let pause = MenuItemBuilder::with_id("pause", "暂停看屏（请在窗口中恢复）").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &pause, &quit]).build()?;
    let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("AI 桌宠正在运行");
    if let Some(icon) = app.default_window_icon() {
      tray = tray.icon(icon.clone());
    }
    tray.on_tray_icon_event(|tray, event| {
      let should_restore = match event {
        TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => true,
        TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => true,
        _ => false,
      };
      if should_restore {
        if let Some(w) = tray.app_handle().get_webview_window("main") {
          let _ = w.eval("window.dispatchEvent(new Event('desktop-pet-restore'))");
        }
      }
    }).on_menu_event(|app, event| match event.id.as_ref() {
      "show" => if let Some(w) = app.get_webview_window("main") { let _ = w.eval("window.dispatchEvent(new Event('desktop-pet-restore'))"); },
      "pause" => { if let Some(w) = app.get_webview_window("main") { let _ = w.eval("window.dispatchEvent(new Event('desktop-pet-restore')); window.dispatchEvent(new Event('desktop-pet-pause'))"); } },
      "quit" => app.exit(0), _ => {}
    }).build(app)?;
    Ok(())
  }).invoke_handler(tauri::generate_handler![capture_screen_context, light_screen_check, set_api_key, get_api_key, set_speech_api_key, get_speech_api_key, start_sovits_service, stop_sovits_service, load_sovits_weights, synthesize_sovits, sovits_is_ready, start_recording, stop_recording, transcribe_audio, delete_recorded_audio, configure_speech_hotkey, play_builtin_ptt_cue, show_voice_overlay_no_activate, start_pet_pointer_tracking]).run(tauri::generate_context!()).expect("error while running desktop pet");
}
