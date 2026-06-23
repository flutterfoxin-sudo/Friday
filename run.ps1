# J.A.R.V.I.S. Unified Dev Bootstrapper
# Launches both Frontend (port 3001) and Backend (port 5000) with AUTO-RESTART loops.

$ErrorActionPreference = "Continue"

$NodePath = "C:\Program Files\nodejs"
$env:PATH = "$NodePath;$env:PATH"
$RootPath = (Get-Location).Path

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   F.R.I.D.A.Y. HUD ASSISTANT DEVELOPMENT BOOTSTRAPPER   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# --- Check dependencies ---
Write-Host "" 
Write-Host "[1/4] Calibrating backend directory..." -ForegroundColor Green
if (-not (Test-Path "backend\node_modules")) {
    Write-Host "Backend dependencies not found. Installing now..." -ForegroundColor Yellow
    Push-Location backend
    npm install
    Pop-Location
} else {
    Write-Host "Backend dependencies cache verified." -ForegroundColor Green
}

Write-Host ""
Write-Host "[2/4] Calibrating frontend directory..." -ForegroundColor Green
if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "Frontend dependencies not found. Installing now..." -ForegroundColor Yellow
    Push-Location frontend
    npm install
    Pop-Location
} else {
    Write-Host "Frontend dependencies cache verified." -ForegroundColor Green
}

# --- Write backend restart script to temp file ---
$backendPs1 = "$env:TEMP\friday_backend.ps1"
$backendContent = '$env:PATH = "' + $NodePath + ';$env:PATH"' + "`r`n"
$backendContent += 'Set-Location "' + $RootPath + '\backend"' + "`r`n"
$backendContent += 'Write-Host "F.R.I.D.A.Y. Backend [AUTO-RESTART ON]" -ForegroundColor Cyan' + "`r`n"
$backendContent += '$n = 0' + "`r`n"
$backendContent += 'while ($true) {' + "`r`n"
$backendContent += '    if ($n -gt 0) {' + "`r`n"
$backendContent += '        Write-Host "[RESTART #$n] Rebooting backend in 3 seconds..." -ForegroundColor Yellow' + "`r`n"
$backendContent += '        Start-Sleep -Seconds 3' + "`r`n"
$backendContent += '        Write-Host "[RESTART] Backend coming back online..." -ForegroundColor Green' + "`r`n"
$backendContent += '    }' + "`r`n"
$backendContent += '    node server.js' + "`r`n"
$backendContent += '    $n++' + "`r`n"
$backendContent += '    Write-Host "[GUARD] Backend exited. Auto-restarting..." -ForegroundColor Red' + "`r`n"
$backendContent += '}' + "`r`n"
[System.IO.File]::WriteAllText($backendPs1, $backendContent, [System.Text.Encoding]::UTF8)

Write-Host ""
Write-Host "[3/4] Starting Backend with Auto-Restart (Port 5000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $backendPs1


# --- Write MCP server restart script to temp file ---
$mcpPs1 = "$env:TEMP\friday_mcp.ps1"
$mcpContent = 'Set-Location "' + $RootPath + '"' + "`r`n"
$mcpContent += 'Write-Host "F.R.I.D.A.Y. FastMCP Server [AUTO-RESTART ON]" -ForegroundColor Yellow' + "`r`n"
$mcpContent += '$n = 0' + "`r`n"
$mcpContent += 'while ($true) {' + "`r`n"
$mcpContent += '    if ($n -gt 0) {' + "`r`n"
$mcpContent += '        Write-Host "[RESTART #$n] Rebooting MCP server in 3 seconds..." -ForegroundColor Yellow' + "`r`n"
$mcpContent += '        Start-Sleep -Seconds 3' + "`r`n"
$mcpContent += '        Write-Host "[RESTART] MCP Server coming back online..." -ForegroundColor Green' + "`r`n"
$mcpContent += '    }' + "`r`n"
$mcpContent += '    .\autohedge\.venv\Scripts\python backend\mcp_server.py' + "`r`n"
$mcpContent += '    $n++' + "`r`n"
$mcpContent += '    Write-Host "[GUARD] MCP Server exited. Auto-restarting..." -ForegroundColor Red' + "`r`n"
$mcpContent += '}' + "`r`n"
[System.IO.File]::WriteAllText($mcpPs1, $mcpContent, [System.Text.Encoding]::UTF8)

Write-Host ""
Write-Host "[3.5/4] Starting FastMCP Server on Port 8000 (SSE)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $mcpPs1

# --- Write frontend restart script to temp file ---
$frontendPs1 = "$env:TEMP\friday_frontend.ps1"

$frontendContent = '$env:PATH = "' + $NodePath + ';$env:PATH"' + "`r`n"
$frontendContent += 'Set-Location "' + $RootPath + '\frontend"' + "`r`n"
$frontendContent += 'Write-Host "F.R.I.D.A.Y. Frontend [AUTO-RESTART ON]" -ForegroundColor Magenta' + "`r`n"
$frontendContent += '$n = 0' + "`r`n"
$frontendContent += 'while ($true) {' + "`r`n"
$frontendContent += '    if ($n -gt 0) {' + "`r`n"
$frontendContent += '        Write-Host "[RESTART #$n] Rebooting frontend in 5 seconds..." -ForegroundColor Yellow' + "`r`n"
$frontendContent += '        Start-Sleep -Seconds 5' + "`r`n"
$frontendContent += '        Write-Host "[RESTART] Frontend coming back online..." -ForegroundColor Magenta' + "`r`n"
$frontendContent += '    }' + "`r`n"
$frontendContent += '    $env:BROWSER = "none"' + "`r`n"
$frontendContent += '    npm start' + "`r`n"
$frontendContent += '    $n++' + "`r`n"
$frontendContent += '    Write-Host "[GUARD] Frontend exited. Auto-restarting..." -ForegroundColor Red' + "`r`n"
$frontendContent += '}' + "`r`n"
[System.IO.File]::WriteAllText($frontendPs1, $frontendContent, [System.Text.Encoding]::UTF8)

Write-Host ""
Write-Host "[4/4] Starting Frontend with Auto-Restart (Port 3001)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $frontendPs1

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  ALL F.R.I.D.A.Y. MATRIX SERVICES ONLINE               " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Backend:    http://localhost:5000      [Auto-Restart ENABLED]" -ForegroundColor Cyan
Write-Host "  FastMCP:    http://localhost:8000/sse  [Auto-Restart ENABLED]" -ForegroundColor Yellow
Write-Host "  Frontend:   http://localhost:3001      [Auto-Restart ENABLED]" -ForegroundColor Magenta
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Closing bootstrapper in 4 seconds..." -ForegroundColor Gray
Start-Sleep -Seconds 4
exit
