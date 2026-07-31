@echo off
REM Start hub + browser relay (Windows)
setlocal
set ROOT=%~dp0
cd /d "%ROOT%"
where node >nul 2>nul
if errorlevel 1 (
  echo node not found
  exit /b 1
)
if not exist "node_modules\playwright" (
  echo -^> install browsers
  node bin\mailnotmilk.js install --browsers-only --skip-deps
)
node bin\mailnotmilk.js run %*
