$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$portable = Join-Path $PSScriptRoot '.tools/node-v24.11.1-win-x64'
if (Test-Path "$portable/node.exe") { $env:Path = "$portable;$env:Path" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Встановіть Node.js 24 LTS.' }
if (-not (Test-Path 'node_modules')) { npm.cmd install; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
if ((-not (Test-Path 'prisma/monitor.db')) -or (-not (Test-Path '.env')) -or (-not (Select-String -Path '.env' -Pattern '^DEMO_PASSWORD=.+' -Quiet -ErrorAction SilentlyContinue))) { npm.cmd run setup; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
npm.cmd run dev
