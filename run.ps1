# Start hub + browser relay (Windows PowerShell)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node not found"
}
if (-not (Test-Path "node_modules\playwright")) {
  Write-Host "-> install browsers"
  node bin\mailnotmilk.js install --browsers-only --skip-deps
}
node (Join-Path $Root "bin\mailnotmilk.js") run @args
