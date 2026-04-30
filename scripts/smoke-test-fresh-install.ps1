# orchestra-goose clean-install smoke test (W1.6).
#
# Walks through what a fresh user does to install orchestra-goose from
# scratch, end-to-end, and times each step. Run on a fresh machine OR
# pass -ExistingInstall to skip steps that already ran.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\smoke-test-fresh-install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\smoke-test-fresh-install.ps1 -ExistingInstall

param(
    [switch]$ExistingInstall
)

$ErrorActionPreference = "Continue"

function Step($n, $msg) { Write-Host "[$n] $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "  ok: $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  warn: $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  FAIL: $msg" -ForegroundColor Red }

$startedAt = Get-Date
$results = @()

function Time-Step {
    param([string]$Name, [scriptblock]$Block)
    $t0 = Get-Date
    try {
        & $Block
        $ok = $true
        $err = $null
    } catch {
        $ok = $false
        $err = $_.Exception.Message
    }
    $elapsed = (New-TimeSpan -Start $t0).TotalSeconds
    $script:results += [pscustomobject]@{ Name = $Name; OK = $ok; Seconds = [math]::Round($elapsed, 1); Error = $err }
    if ($ok) { Ok "$Name ($([math]::Round($elapsed, 1))s)" } else { Fail "$Name : $err" }
}

Step 1 "Verify Rust toolchain"
Time-Step "rust-version-check" {
    $v = (& rustc --version) 2>$null
    if (-not $v) { throw "rustc not on PATH" }
    Write-Host "    $v"
}

Step 2 "Verify Node + npm"
Time-Step "node-version-check" {
    $n = (& node --version) 2>$null
    if (-not $n) { throw "node not on PATH" }
    Write-Host "    node $n"
}

Step 3 "Verify Python 3.12+"
Time-Step "python-version-check" {
    $p = (& python --version) 2>$null
    if (-not $p) { throw "python not on PATH" }
    Write-Host "    $p"
}

Step 4 "Verify goose CLI installed"
Time-Step "goose-cli-check" {
    $bin = "$env:USERPROFILE\.local\bin\goose.exe"
    if (-not (Test-Path $bin)) { throw "goose.exe not at $bin" }
    $v = (& $bin --version) 2>$null
    Write-Host "    goose $v"
}

Step 5 "Verify claude-acp adapter installed"
Time-Step "claude-acp-check" {
    $cmd = Get-Command claude-agent-acp -ErrorAction SilentlyContinue
    if (-not $cmd) {
        if (-not $ExistingInstall) {
            throw "claude-agent-acp not on PATH (run: npm install -g @agentclientprotocol/claude-agent-acp)"
        } else {
            Warn "claude-agent-acp missing but -ExistingInstall set"
        }
    } else {
        Write-Host "    found at $($cmd.Source)"
    }
}

Step 6 "Verify goose config has GOOSE_PROVIDER"
Time-Step "goose-config-check" {
    $cfg = "$env:APPDATA\Block\goose\config\config.yaml"
    if (-not (Test-Path $cfg)) { throw "config.yaml missing at $cfg" }
    $text = Get-Content $cfg -Raw
    if ($text -notmatch 'GOOSE_PROVIDER:\s*claude-acp') { throw "GOOSE_PROVIDER not set to claude-acp" }
    if ($text -notmatch 'memorymaster:') { throw "memorymaster MCP extension not registered" }
}

Step 7 "Verify goosed Windows service"
Time-Step "goosed-service-check" {
    $svc = Get-Service goosed -ErrorAction SilentlyContinue
    if (-not $svc) { throw "goosed service not registered" }
    if ($svc.Status -ne 'Running') { Warn "goosed service is $($svc.Status)" } else { Write-Host "    goosed: Running" }
}

Step 8 "Verify goosed listening on :3284"
Time-Step "goosed-port-check" {
    $conn = Get-NetTCPConnection -LocalPort 3284 -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { throw "no LISTEN on :3284" }
    Write-Host "    port 3284 listening"
}

Step 9 "Verify orchestra-goose-tom-briefer scheduled task"
Time-Step "tom-briefer-task-check" {
    $t = Get-ScheduledTask -TaskName "orchestra-goose-tom-briefer" -ErrorAction SilentlyContinue
    if (-not $t) { throw "scheduled task not registered" }
    Write-Host "    state: $($t.State)"
}

Step 10 "Verify tom briefing freshness"
Time-Step "tom-message-fresh-check" {
    $f = "$env:USERPROFILE\.orchestra-goose\tom-message.txt"
    if (-not (Test-Path $f)) { throw "tom-message.txt not written yet" }
    $age = (New-TimeSpan -Start (Get-Item $f).LastWriteTime).TotalMinutes
    if ($age -gt 5) { Warn "tom-message.txt is $([math]::Round($age,1))m old (expected under 2m)" } else { Write-Host "    tom-message.txt updated $([math]::Round($age, 1))m ago" }
}

Step 11 "End-to-end: goose run with prompt"
Time-Step "goose-run-e2e" {
    $bin = "$env:USERPROFILE\.local\bin\goose.exe"
    $output = (& $bin run -t "Reply with exactly: SMOKE_TEST_OK" --no-session 2>&1) -join "`n"
    if (-not ($output -match "SMOKE_TEST_OK")) { throw "goose did not produce SMOKE_TEST_OK in output (got: $($output.Substring(0, [Math]::Min(200, $output.Length))))" }
}

# Summary
Write-Host ""
Write-Host "===== SMOKE TEST SUMMARY =====" -ForegroundColor Cyan
$results | Format-Table -AutoSize Name, OK, Seconds, Error
$total = (New-TimeSpan -Start $startedAt).TotalSeconds
$passed = ($results | Where-Object { $_.OK }).Count
$failed = ($results | Where-Object { -not $_.OK }).Count
Write-Host "passed: $passed / failed: $failed / total time: $([math]::Round($total, 1))s" -ForegroundColor Cyan
if ($failed -gt 0) { exit 1 } else { exit 0 }
