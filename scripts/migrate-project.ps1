# Wave 7 — per-project migration to orchestra-goose.
# Idempotent. Safe to re-run. Walks the WAVE7_PROJECT_CHECKLIST.md steps for ONE project.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\migrate-project.ps1 -ProjectPath "G:\path\to\project"
#   powershell -ExecutionPolicy Bypass -File scripts\migrate-project.ps1 -ProjectPath "..." -DryRun

param(
    [Parameter(Mandatory=$true)][string]$ProjectPath,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ProjectPath = (Resolve-Path $ProjectPath).Path
$projectName = Split-Path -Leaf $ProjectPath
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Step($msg) { Write-Host "[migrate-project] $msg" -ForegroundColor Cyan }
function Skip($msg) { Write-Host "[skip] $msg" -ForegroundColor Yellow }
function Ok($msg) { Write-Host "[ok] $msg" -ForegroundColor Green }

Step "Migrating $projectName at $ProjectPath"
if ($DryRun) { Step "DRY RUN - no writes" }

# 1. Pre-flight
if (-not (Test-Path "$ProjectPath\.git")) {
    Write-Error "Not a git repo. Run 'git init' first."
    exit 1
}

# 2. Create .goose/ + project.toml
$gooseDir = Join-Path $ProjectPath ".goose"
$projectToml = Join-Path $gooseDir "project.toml"
if (Test-Path $projectToml) {
    Skip ".goose/project.toml already exists"
} else {
    Step "Creating .goose/project.toml"
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $gooseDir -Force | Out-Null
        $template = Get-Content "$repoRoot\distro-templates\project.toml.example" -Raw
        # Substitute project name + scope
        $template = $template -replace 'name = "wezbridge"', "name = `"$projectName`""
        $template = $template -replace 'scope = "project:wezbridge"', "scope = `"project:$projectName`""
        $template | Set-Content $projectToml -Encoding UTF8
        Ok "wrote $projectToml"
    }
}

# 3. Create vault/active_tasks.md if missing
$vaultDir = Join-Path $ProjectPath "vault"
$activeTasks = Join-Path $vaultDir "active_tasks.md"
$rootActiveTasks = Join-Path $ProjectPath "active_tasks.md"
if ((Test-Path $activeTasks) -or (Test-Path $rootActiveTasks)) {
    Skip "active_tasks.md already exists"
} else {
    Step "Creating vault/active_tasks.md from seed template"
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $vaultDir -Force | Out-Null
        $seed = Get-Content "$repoRoot\distro-templates\active_tasks.md.seed" -Raw
        $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $seed = $seed -replace '<ISO timestamp>', $now
        $seed | Set-Content $activeTasks -Encoding UTF8
        Ok "wrote $activeTasks"
    }
}

# 4. Add to orchestrated-projects.txt
$listFile = Join-Path $env:USERPROFILE ".orchestra-goose\orchestrated-projects.txt"
if (Test-Path $listFile) {
    $existing = Get-Content $listFile
    $normalized = $ProjectPath -replace '\\', '/'
    if ($existing -contains $normalized) {
        Skip "already in orchestrated-projects.txt"
    } else {
        Step "Appending to orchestrated-projects.txt"
        if (-not $DryRun) {
            Add-Content -Path $listFile -Value $normalized
            Ok "appended"
        }
    }
} else {
    Step "Creating orchestrated-projects.txt"
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path (Split-Path $listFile -Parent) -Force | Out-Null
        ($ProjectPath -replace '\\', '/') | Set-Content $listFile -Encoding UTF8
        Ok "created"
    }
}

# 5. Run tom-briefing refresh once
Step "Running tom-briefing refresh"
if (-not $DryRun) {
    & python "$repoRoot\scripts\refresh-tom-briefing.py" --project $ProjectPath --force
    Ok "tom-briefing refreshed"
}

# 6. Final status
Step "Migration complete for $projectName"
Step "Next steps:"
Write-Host "  - Edit $projectToml to set monitoring.escalation_channel if you want Telegram"
Write-Host "  - Replace seed tasks in vault/active_tasks.md with real work as it begins"
Write-Host "  - Remove the legacy monitoring.md once you confirm the new flow works"
Write-Host "  - Verify with: goose run -t 'what is the active task' from the project cwd"
