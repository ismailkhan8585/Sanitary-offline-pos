HAROON POS - SERVER PC
======================
1. Give this PC a FIXED IP address on the shop router (e.g. 192.168.1.10).
2. Copy this whole folder to the server PC, open PowerShell as Administrator here and run:
      powershell -ExecutionPolicy Bypass -File install.ps1
3. The server runs as the Windows service "HaroonPOS" and starts with Windows.
4. Open http://localhost:3000 - log in as Admin with PIN 1234 and change the PIN.
5. Backup page: set the backup password, prepare the USB disk and the 2 take-home USBs,
   set the live-copy folder on the 2nd PC (e.g. \PC2\POS-Replica).
Data:     C:\HaroonPOS\data\pos.db  (never copy it while the server runs - use the Backup page)
Backups:  D:\POS-Backups (hourly / daily / monthly / yearly / reports)
Update:   run install.ps1 from a newer package - data is kept.
