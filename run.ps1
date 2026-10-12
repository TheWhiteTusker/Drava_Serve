# One command to run the F&B system locally.
#   .\run.ps1          start everything (builds if needed), wait until ready, open the apps
#   .\run.ps1 stop     stop everything (data is kept)
#   .\run.ps1 reset    wipe all data and start again with fresh sample data
#   .\run.ps1 logs     follow the server's messages (Ctrl+C to stop watching)
# Add -NoBrowser to skip opening browser tabs.
param(
  [ValidateSet('start', 'stop', 'reset', 'logs')][string]$Action = 'start',
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$base = 'http://localhost:5173'

function Test-Docker {
  docker info *> $null
  return $LASTEXITCODE -eq 0
}

# Starts Docker Desktop if it is not running, and waits for it.
function Wait-Docker {
  if (Test-Docker) { return }
  $desktop = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path $desktop)) { throw 'Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ and run this again.' }
  Write-Host 'Starting Docker Desktop...' -ForegroundColor Yellow
  Start-Process $desktop
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Docker) { return }
  }
  throw 'Docker Desktop did not start within 3 minutes. Open it by hand, then run this again.'
}

function Wait-Ready {
  Write-Host 'Waiting for the apps to be ready (the first run takes a few minutes)...' -ForegroundColor Yellow
  for ($i = 0; $i -lt 150; $i++) {
    try {
      $r = Invoke-WebRequest "$base/api/health" -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Seconds 2
  }
  throw "The apps did not become ready. See what happened with: .\run.ps1 logs"
}

function Start-All {
  Wait-Docker
  Write-Host 'Building and starting the system...' -ForegroundColor Yellow
  docker compose up --build -d
  if ($LASTEXITCODE -ne 0) { throw 'docker compose could not start the system (see the messages above).' }
  Wait-Ready
  if (-not $NoBrowser) {
    Start-Process $base
    Start-Process "$base/pos/"
    Start-Process "$base/m/demo/BLR1"
  }
  Write-Host ''
  Write-Host 'Ready.' -ForegroundColor Green
  Write-Host "  Admin and dashboard  $base               owner@demo.test"
  Write-Host "  Billing POS          $base/pos/          cashier@demo.test"
  Write-Host "  Receiving app        $base/receiving/    watchman@demo.test"
  Write-Host "  Guest menu           $base/m/demo/BLR1   (no sign-in)"
  Write-Host '  Password for every sample sign-in: Demo@1234'
  Write-Host ''
  Write-Host 'Stop with: .\run.ps1 stop      Fresh start with: .\run.ps1 reset'
}

switch ($Action) {
  'start' { Start-All }
  'stop' {
    Wait-Docker
    docker compose down
    Write-Host 'Stopped. Your data is kept for next time.' -ForegroundColor Green
  }
  'reset' {
    Wait-Docker
    Write-Host 'Wiping all data...' -ForegroundColor Yellow
    docker compose down -v
    Start-All
  }
  'logs' {
    Wait-Docker
    docker compose logs -f api
  }
}
