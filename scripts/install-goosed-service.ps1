# Install goosed as a Windows service via NSSM.
# Wave 4.1 of the orchestra-goose migration.
#
# Prerequisites:
#   - NSSM on PATH (verified: nssm.exe is bundled in WinGet packages)
#   - goose binary on PATH at $env:USERPROFILE\.local\bin\goose.exe
#   - Run as Administrator (NSSM requires it for service registration)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-goosed-service.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-goosed-service.ps1 -Uninstall
#
# After install, the service will:
#   - Run goose serve (the goosed daemon) on 127.0.0.1:3000
#   - Auto-restart on crash
#   - Log to %APPDATA%\Block\goose\data\logs\service\

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$SERVICE_NAME = "goosed"
$GOOSE_BIN = "$env:USERPROFILE\.local\bin\goose.exe"
$LOG_DIR = "$env:APPDATA\Block\goose\data\logs\service"

# Verify NSSM
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
    Write-Error "nssm not found on PATH. Install via 'winget install NSSM.NSSM' first."
    exit 1
}

if ($Uninstall) {
    Write-Host "Stopping + removing service '$SERVICE_NAME'..." -ForegroundColor Cyan
    & nssm stop $SERVICE_NAME 2>$null
    & nssm remove $SERVICE_NAME confirm 2>$null
    Write-Host "Service uninstalled." -ForegroundColor Green
    exit 0
}

# Verify goose binary
if (-not (Test-Path $GOOSE_BIN)) {
    Write-Error "goose binary not found at $GOOSE_BIN. Install it first via download_cli.ps1."
    exit 1
}

# Create log dir
if (-not (Test-Path $LOG_DIR)) {
    New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
}

# Check if service already exists
$existing = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Service '$SERVICE_NAME' already exists. Use -Uninstall to remove first." -ForegroundColor Yellow
    & nssm status $SERVICE_NAME
    exit 0
}

Write-Host "Installing goosed as Windows service..." -ForegroundColor Cyan
& nssm install $SERVICE_NAME $GOOSE_BIN serve

# Configure service
& nssm set $SERVICE_NAME AppDirectory "$env:USERPROFILE\.local\bin"
& nssm set $SERVICE_NAME DisplayName "orchestra-goose daemon"
& nssm set $SERVICE_NAME Description "goose serve — REST + WebSocket agent server (Wave 4 of orchestra-goose migration)"
& nssm set $SERVICE_NAME Start SERVICE_AUTO_START
& nssm set $SERVICE_NAME AppStdout "$LOG_DIR\stdout.log"
& nssm set $SERVICE_NAME AppStderr "$LOG_DIR\stderr.log"
& nssm set $SERVICE_NAME AppRotateFiles 1
& nssm set $SERVICE_NAME AppRotateBytes 10485760  # 10 MB rotation

Write-Host "Starting service..." -ForegroundColor Cyan
& nssm start $SERVICE_NAME

Start-Sleep -Seconds 2
& nssm status $SERVICE_NAME

Write-Host ""
Write-Host "Service installed. Verify with:" -ForegroundColor Green
Write-Host "  curl http://127.0.0.1:3000/health  # if goose serve exposes a health endpoint"
Write-Host "  nssm status $SERVICE_NAME"
Write-Host "  Get-Content '$LOG_DIR\stdout.log' -Tail 20"
Write-Host ""
Write-Host "Uninstall with: powershell -File scripts\install-goosed-service.ps1 -Uninstall" -ForegroundColor Gray
