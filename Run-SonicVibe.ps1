# Run-SonicVibe.ps1
# Save this in your project root. Double click or run in PowerShell to launch both servers at once!

$projectRoot = $PSScriptRoot
if (-not $projectRoot) { $projectRoot = Get-Location }

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "          Starting SonicVibe Servers          " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# 1. Start Backend Server
Write-Host "[1/3] Launching Python FastAPI Backend..." -ForegroundColor Yellow
$backendJob = Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; .\venv\Scripts\uvicorn backend.main:app --host 127.0.0.1 --port 8000" -PassThru -WindowStyle Minimized

# 2. Start Frontend Dev Server
Write-Host "[2/3] Launching Vite Frontend..." -ForegroundColor Yellow
$frontendJob = Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "cd '$projectRoot\frontend'; npm run dev" -PassThru -WindowStyle Minimized

# 3. Wait a moment for Vite to bind, then open the browser tab
Write-Host "[3/3] Waiting for servers to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host "Opening SonicVibe in your browser at http://localhost:5173 ..." -ForegroundColor Green
Start-Process "http://localhost:5173"

Write-Host "Servers are running in minimized windows. Press Ctrl+C in this console to stop them both!" -ForegroundColor Cyan

try {
    # Keep the orchestrator script open so you can press Ctrl+C to close both minimized terminal processes
    while ($true) {
        Start-Sleep -Seconds 1
    }
}
finally {
    Write-Host "`nStopping servers..." -ForegroundColor Red
    Stop-Process -Id $backendJob.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontendJob.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Servers stopped successfully." -ForegroundColor Green
}
