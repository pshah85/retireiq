# One-click sync: copies the source-of-truth HTML into this deploy folder as index.html.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File sync.ps1
$ErrorActionPreference = 'Stop'

$src  = Join-Path $PSScriptRoot '..\retirement-portfolio-calculator.html'
$dest = Join-Path $PSScriptRoot 'index.html'

if (-not (Test-Path $src)) {
    Write-Host "ERROR: Source file not found:`n  $src" -ForegroundColor Red
    Write-Host "Make sure retirement-portfolio-calculator.html is on your Desktop."
    exit 1
}

Copy-Item -Path $src -Destination $dest -Force
$srcSize  = (Get-Item $src).Length
$destSize = (Get-Item $dest).Length

if ($srcSize -eq $destSize) {
    Write-Host "Synced OK. index.html is now identical to the source ($destSize bytes)." -ForegroundColor Green
    Write-Host "Deploy with:  vercel --prod"
} else {
    Write-Host "WARNING: sizes differ after copy (src $srcSize vs dest $destSize)." -ForegroundColor Yellow
    exit 1
}
