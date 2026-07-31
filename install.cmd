@echo off
REM Windows native entrypoint (cmd.exe)
setlocal
set ROOT=%~dp0
cd /d "%ROOT%"

where node >nul 2>nul
if errorlevel 1 (
  echo node not found. Install Node.js ^>= 22.5 from https://nodejs.org/
  exit /b 1
)

if not exist "node_modules\@modelcontextprotocol" (
  echo -^> npm install
  call npm install
  if errorlevel 1 exit /b 1
)

if "%~1"=="" (
  node bin\mailnotmilk.js install --tools all --skills --global-skills --target "%ROOT%"
) else (
  node bin\mailnotmilk.js %*
)
