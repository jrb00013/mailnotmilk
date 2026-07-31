# Windows native / PowerShell entrypoint
# Usage: .\install.ps1
#        .\install.ps1 install --tools all --skills --global-skills
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node not found. Install Node.js >= 22.5 from https://nodejs.org/"
}

if (-not (Test-Path "node_modules\@modelcontextprotocol")) {
  Write-Host "-> npm install"
  npm install
}

$cli = Join-Path $Root "bin\mailnotmilk.js"
if ($args.Count -eq 0) {
  node $cli install --tools all --skills --global-skills --target $Root
} else {
  node $cli @args
}
