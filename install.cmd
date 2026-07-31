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

set RUN_AFTER=0
set ARGS=
:parse
if "%~1"=="" goto done_parse
if /I "%~1"=="--run" (
  set RUN_AFTER=1
  shift
  goto parse
)
set ARGS=%ARGS% %1
shift
goto parse
:done_parse

if "%ARGS%"=="" (
  node bin\mailnotmilk.js install --tools all --skills --global-skills --target "%ROOT%"
) else (
  node bin\mailnotmilk.js %ARGS%
)

if "%RUN_AFTER%"=="1" (
  echo.
  echo -^> starting hub + relay
  call "%ROOT%run.cmd"
)
