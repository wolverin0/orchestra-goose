# Register a Windows Scheduled Task that runs refresh-tom-briefing.py
# every 1 minute. The tom (Top Of Mind) extension reads the resulting
# briefing on every goose turn at near-zero cost.
#
# Wave 2 fast-path infrastructure (architectural pivot from the 47-57s
# recipe-as-pre-prompt-hook approach — see MIGRATION_MAPPING.md).
#
# Idempotent: safe to re-run; uses -Force on Register-ScheduledTask.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-tom-briefing-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-tom-briefing-task.ps1 -Uninstall

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$TASK_NAME = "orchestra-goose-tom-briefer"
$REPO_ROOT = (Resolve-Path "$PSScriptRoot\..").Path
$SCRIPT = Join-Path $REPO_ROOT "scripts\refresh-tom-briefing.py"
$PYTHON = "C:\Users\pauol\AppData\Local\Programs\Python\Python312\python.exe"

if (-not (Test-Path $PYTHON)) {
    Write-Warning "Python not found at $PYTHON. Edit this script to point at your python.exe."
    exit 1
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "task uninstalled (or didn't exist)" -ForegroundColor Cyan
    exit 0
}

if (-not (Test-Path $SCRIPT)) {
    Write-Warning "refresh-tom-briefing.py not found at $SCRIPT"
    exit 1
}

$action = New-ScheduledTaskAction -Execute $PYTHON -Argument "`"$SCRIPT`" --all"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
    -TaskName $TASK_NAME `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

Write-Host "registered: $TASK_NAME" -ForegroundColor Green
Get-ScheduledTask -TaskName $TASK_NAME | Format-List TaskName,State,Description
Write-Host "task fires every minute. To verify it's running:"
Write-Host "  Get-ScheduledTaskInfo -TaskName $TASK_NAME"
Write-Host '  ls $env:USERPROFILE\.orchestra-goose\tom-briefing-state.json (should update each minute)'
