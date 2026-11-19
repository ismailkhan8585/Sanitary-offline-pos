# Removes the Haroon POS service. Program files and C:\HaroonPOS\data (all shop data) are kept.
#Requires -RunAsAdministrator
$dest = 'C:\HaroonPOS'
& (Join-Path $dest 'node\node.exe') (Join-Path $dest 'app\server\scripts\service.cjs') uninstall
netsh advfirewall firewall delete rule name="Haroon POS" | Out-Null
Write-Host 'Service removed. Data in C:\HaroonPOS\data was NOT deleted.'
