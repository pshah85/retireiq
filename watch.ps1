# RetireIQ — Auto-deploy watcher
# Watches retirement-portfolio-calculator.html for changes.
# Every time you save the file in Cursor, it automatically:
#   1. Syncs it to index.html
#   2. git commit + git push → Vercel auto-deploys in ~30 sec
#
# Usage: powershell -ExecutionPolicy Bypass -File watch.ps1
# Keep this terminal open while you work. Press Ctrl+C to stop.

$ErrorActionPreference = 'Stop'

$src     = (Resolve-Path "$PSScriptRoot\..\retirement-portfolio-calculator.html").Path
$dest    = Join-Path $PSScriptRoot 'index.html'
$repoDir = $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RetireIQ Auto-Deploy Watcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Watching: $src"
Write-Host "  Deploy to: GitHub → Vercel"
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

# ── FileSystemWatcher setup ───────────────────────────────────────────────────
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path   = Split-Path $src
$watcher.Filter = Split-Path $src -Leaf
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite
$watcher.EnableRaisingEvents = $true

# Debounce: track last deploy time to avoid double-fires from editor autosave
$script:lastDeploy = [datetime]::MinValue
$debounceSeconds   = 4

function Deploy-Now {
    $now = [datetime]::Now
    if (($now - $script:lastDeploy).TotalSeconds -lt $debounceSeconds) { return }
    $script:lastDeploy = $now

    Write-Host ""
    Write-Host "[$($now.ToString('HH:mm:ss'))] Change detected — deploying..." -ForegroundColor Yellow

    try {
        # Step 1: Sync
        Copy-Item -Path $src -Destination $dest -Force
        $srcSize  = (Get-Item $src).Length
        $destSize = (Get-Item $dest).Length
        if ($srcSize -ne $destSize) { throw "Size mismatch after copy ($srcSize vs $destSize)" }
        Write-Host "  ✔ Synced  ($destSize bytes)" -ForegroundColor Green

        # Step 2: Git commit + push
        Set-Location $repoDir
        git add index.html 2>&1 | Out-Null
        $dirty = git status --porcelain
        if ($dirty) {
            $msg = "deploy: auto-sync $($now.ToString('yyyy-MM-dd HH:mm'))"
            git commit -m $msg 2>&1 | Out-Null
            git push 2>&1 | Out-Null
            Write-Host "  ✔ Pushed  → Vercel will go live in ~30 sec" -ForegroundColor Green
        } else {
            Write-Host "  — No git changes (file content unchanged)" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  ✖ Error: $_" -ForegroundColor Red
    }
}

# ── Wire up the event ─────────────────────────────────────────────────────────
$action = { Deploy-Now }
Register-ObjectEvent $watcher Changed -Action { Deploy-Now } | Out-Null

Write-Host "Watching for saves... (edit & save in Cursor to trigger auto-deploy)" -ForegroundColor DarkGray
Write-Host ""

# Keep the script alive
try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
    Write-Host "Watcher stopped." -ForegroundColor DarkGray
}
