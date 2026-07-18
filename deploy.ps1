# RetireIQ — One-click sync + deploy
# Usage: powershell -ExecutionPolicy Bypass -File deploy.ps1
# What it does:
#   1. Copies the source-of-truth HTML → index.html (sync)
#   2. git add + commit + push → Vercel auto-deploys via GitHub integration
#
# Prerequisites:
#   - Git installed and this folder linked to a GitHub remote (git remote add origin <url>)
#   - Vercel project connected to that GitHub repo (auto-deploys on push)

$ErrorActionPreference = 'Stop'

$src  = Join-Path $PSScriptRoot '..\retirement-portfolio-calculator.html'
$dest = Join-Path $PSScriptRoot 'index.html'

# ── Step 1: Sync ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Step 1: Syncing retirement-portfolio-calculator.html → index.html ..." -ForegroundColor Cyan

if (-not (Test-Path $src)) {
    Write-Host "ERROR: Source file not found: $src" -ForegroundColor Red
    exit 1
}

Copy-Item -Path $src -Destination $dest -Force
$srcSize  = (Get-Item $src).Length
$destSize = (Get-Item $dest).Length

if ($srcSize -ne $destSize) {
    Write-Host "ERROR: File sizes differ after copy ($srcSize vs $destSize). Aborting." -ForegroundColor Red
    exit 1
}
Write-Host "  Synced OK ($destSize bytes)" -ForegroundColor Green

# ── Step 2: Git commit + push ─────────────────────────────────────────────────
Write-Host ""
Write-Host "Step 2: Committing and pushing to GitHub ..." -ForegroundColor Cyan

Set-Location $PSScriptRoot

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git add index.html
$status = git status --porcelain
if (-not $status) {
    Write-Host "  No changes to commit — index.html is already up to date on GitHub." -ForegroundColor Yellow
} else {
    git commit -m "deploy: sync app $timestamp"
    git push
    Write-Host "  Pushed to GitHub. Vercel will auto-deploy in ~30 seconds." -ForegroundColor Green
}

Write-Host ""
Write-Host "Done! Check your Vercel dashboard for deployment status." -ForegroundColor Green
Write-Host ""
