@echo off
setlocal
where node >nul 2>nul || set "PATH=C:\Program Files\nodejs;%PATH%"
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust/Cargo is required to run the Tauri desktop application.
  echo Install Rust from https://rustup.rs then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing application dependencies...
  call npm install || exit /b 1
)
call npm run tauri dev
