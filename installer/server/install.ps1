# Haroon POS - server installer. Right-click > "Run with PowerShell" as Administrator,
# or from an Administrator PowerShell:  powershell -ExecutionPolicy Bypass -File install.ps1
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$src  = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = 'C:\HaroonPOS'
$node = Join-Path $dest 'node\node.exe'
$svc  = Join-Path $dest 'app\server\scripts\service.cjs'

Write-Host "Installing Haroon POS server to $dest ..." -ForegroundColor Cyan
if (Get-Service HaroonPOS -ErrorAction SilentlyContinue) {
  Write-Host 'Stopping the running server for the update...'
  Stop-Service HaroonPOS -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

# Copy program files. The data folder is never overwritten.
robocopy $src $dest /E /XD data /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy code $LASTEXITCODE)" }
New-Item -ItemType Directory -Force (Join-Path $dest 'data') | Out-Null
if (Test-Path 'D:\') { New-Item -ItemType Directory -Force 'D:\POS-Backups' | Out-Null }

# Let counters reach the server on the shop network.
netsh advfirewall firewall delete rule name="Haroon POS" | Out-Null
netsh advfirewall firewall add rule name="Haroon POS" dir=in action=allow protocol=TCP localport=3000 profile=any | Out-Null

$env:POS_DATA_DIR = Join-Path $dest 'data'
& $node $svc install
Write-Host 'Waiting for the server to start...'
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try { if ((Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health).StatusCode -eq 200) { $ok = $true; break } } catch {}
}
if (-not $ok) { Write-Host 'Server did not answer yet. Check Services > HaroonPOS and C:\HaroonPOS\app\server\dist\daemon logs.' -ForegroundColor Yellow; exit 1 }

$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host 'Haroon POS server is running.' -ForegroundColor Green
Write-Host 'On this PC open:  http://localhost:3000'
foreach ($ip in $ips) { Write-Host "Counters/tablets: http://${ip}:3000" -ForegroundColor Green }
Write-Host 'First login: Admin, PIN 1234 - change it at once in Settings > Users.'
