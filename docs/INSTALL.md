# Haroon POS — Installation & Operation Guide

Everything runs inside the shop on the router's network. No internet is needed after installation.

```
        Shop router (LAN / WiFi)
   ┌──────────┼──────────────┬───────────────┐
 SERVER PC   COUNTER PCs      TABLET / MOBILE   2nd PC / NAS
 (data,      (Electron app,   (Chrome →         (live copy of data,
  service)    silent print)    http://IP:3000)   can become server)
```

## 1. What you need

| Item | Notes |
|---|---|
| Server PC | Windows 10/11, 4 GB RAM+, ideally a second drive/partition **D:** for backups. Leave it on during shop hours. |
| Counter PCs | Windows 10/11, thermal printer (58 or 80 mm) installed in Windows with its driver. |
| Tablets/mobiles | Android/iPad with Chrome or Safari. |
| 2nd PC or NAS | For the live copy (shared folder, e.g. `\\PC2\POS-Replica`). |
| USB hard disk | Stays connected to the server PC (daily encrypted copy). |
| 2 USB sticks | "Take-home" backups, swapped weekly, kept outside the shop. |

Release files (built with `npm run package:server` and `npm run package:counter`, see section 9):

- `release\HaroonPOS-Server.zip` — server PC package (contains its own Node.js, nothing else to install).
- `desktop\release\Haroon POS Counter Setup 1.0.0.exe` — counter PC installer.

## 2. Server PC

1. **Fixed IP:** in the router (DHCP reservation) or Windows network settings, give the server PC a fixed address, e.g. `192.168.1.10`. Counters remember this address.
2. Unzip `HaroonPOS-Server.zip` anywhere (e.g. Desktop).
3. Open **PowerShell as Administrator** in that folder and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```
   This copies the program to `C:\HaroonPOS`, creates `C:\HaroonPOS\data` and `D:\POS-Backups`, opens port 3000 in the Windows firewall, and installs the Windows service **HaroonPOS** (starts with Windows, restarts itself if it stops). At the end it prints the address counters must use, e.g. `http://192.168.1.10:3000`.
4. On the server PC open `http://localhost:3000`.
   - First screen: choose **Counter A** and type the Admin PIN **1234** (this marks the device as a counter; the server PC can also bill).
   - Log in as **Admin / 1234** and immediately change the PIN in **Settings → Users**.
5. **Settings → Shop:** shop name (English + Urdu), address, phone, tax %, receipt footer, receipt paper (58/80 mm/A4), default language, closing time (daily backup runs then).
6. **Settings → Counters:** add one counter per device: `Counter B` → letter `B`, `Counter C` → `C`, `Tablet` → `D`. Bill numbers become `A-00001`, `B-00001`, …
7. **Settings → Users:** add cashiers with PIN, discount limit %, return limit, expense limit.
8. **Products:** **Import Excel** → *Download template* → fill → import (or add one by one). Add categories, suppliers (Khata → Suppliers) and plumbers.
9. **Settings → Licence:** note the **PC code** and send it to the supplier (see section 8). The trial runs 30 days.

Updating later: unzip the new package and run `install.ps1` again — data in `C:\HaroonPOS\data` is kept.

## 3. Backups (do this on day one — data is critical)

Open **Backup & restore** (Admin):

1. **Backup password** — at least 8 characters. Every backup that leaves the server PC (USB disk, take-home USB, cloud) is encrypted (AES-256) with it. **The owner must write it down and keep it safe; without it those backups cannot be restored.**
2. **USB drives** — plug in the USB hard disk → *Use as USB backup disk*. Plug in stick 1 → *Take-home USB 1*; stick 2 → *Take-home USB 2*. (The drive holding `D:\POS-Backups` is never offered, so a "USB" copy is always on a different device.)
3. **Backup places:**
   - *Backup folder*: `D:\POS-Backups` (default when D: exists).
   - *Live copy folder*: the shared folder on the 2nd PC/NAS, e.g. `\\PC2\POS-Replica` (share it with write access for the server PC's user).
   - *Litestream program* (optional): put `litestream.exe` in `C:\HaroonPOS\tools\` and enter its path for continuous replication. Without it the server writes a checked copy to the live-copy folder every 5 minutes.
   - *Cloud folder* (optional): a Google Drive / OneDrive sync folder. Encrypted copies are placed there and upload whenever the PC has internet; the POS itself stays offline.

What then happens automatically:

| When | What |
|---|---|
| Every hour | Snapshot to `D:\POS-Backups\hourly` (keeps 24) |
| Every shift close | Snapshot to `hourly` |
| Closing time, daily | Snapshot to `daily` (keeps 30); 1st of month → `monthly` (keeps 12); 1st January → `yearly` (forever); encrypted copy to the USB disk and cloud folder; closing report PDF and (monthly) Excel export in `D:\POS-Backups\reports`; database optimise |
| Every 5 minutes | Live copy to the 2nd PC |
| Weekly (you) | Plug in a take-home USB → **Copy to take-home USB**, take it home, bring the other one next week. The dashboard turns red after 7 days. |

Every copy is made with SQLite `VACUUM INTO` (never by copying the live file) and is checked with `PRAGMA integrity_check`; the result is written to the Activity log.

## 4. Counter PCs

1. Run `Haroon POS Counter Setup 1.0.0.exe` (choose install for all users). A **Haroon POS** shortcut appears on the desktop.
2. First start: type the server address, e.g. `192.168.1.10` (port 3000 is added automatically) → **Connect**.
3. Choose the counter (e.g. **Counter B**) and type the Admin PIN once.
4. Log in as Admin → **Settings → This counter** → pick the thermal printer → **Test print**. Receipts now print without any dialog.
5. Cashiers log in with their own PIN.

**Emergency mode:** if the server cannot be reached for ~15 seconds the counter switches to a red *Emergency billing* screen using the product list saved on that PC. Bills get numbers like `E-B-00001`, print normally and are stored on the counter. When the server is back, press **Server back? Go online** — waiting bills upload automatically and appear in Bills.

## 5. Tablets and mobiles

Open `http://192.168.1.10:3000` in Chrome, choose the tablet's counter (e.g. **Tablet (D)**), log in. Use **⋮ → Add to Home screen** for an app icon. (For the full "Install app" option on Android over plain HTTP, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add `http://192.168.1.10:3000`, and restart Chrome.) Receipts print through the tablet's print dialog.

## 6. Daily use

- **Sale:** F2 search (name, code, barcode, Roman Urdu e.g. *tonti*, *pankha*) → tap/scan → adjust qty → **F9 PAY** → method, cash given → *Save & Print*. Esc clears the bill (with Undo).
- **Udhaar:** choose the customer first, then pay partly or choose *Udhaar*.
- **Hold / Quotation:** buttons under the total; reopen from *Held bills*.
- **Approvals:** when a cashier exceeds a limit, sells below cost or past stock, changes a rate or goes over a credit limit, an Admin types their PIN on the same screen.
- **Shift:** *My shift* → open with cash in drawer; close by counting cash — the difference is shown and a backup is taken.
- **Urdu:** the **اردو** button switches the whole app (right-to-left).

## 7. Disaster recovery (target: under 30 minutes)

If the server PC dies:

1. Take any Windows PC (or the 2nd PC). Give it the **same fixed IP** as the old server.
2. Install the server package (section 2, step 3).
3. Open `http://localhost:3000` → log in as **Admin / 1234** (fresh install).
4. **Backup & restore → Upload a backup file**, choosing the newest of:
   - the 2nd PC's live copy `\\PC2\POS-Replica\pos-replica.db` (most recent, not encrypted), or
   - the USB hard disk / take-home USB: `HaroonPOS-Backups\pos-…db.enc` (needs the backup password).
5. Press **Restore** on it → backup password (for `.enc`) → your Admin PIN. The current (empty) data is saved first, then the server restarts on the shop's data. Log in with the shop's own Admin PIN.
6. Counters reconnect by themselves (same IP). Emergency bills made during the outage upload automatically.
7. The new PC gets its own 30-day period; send its new PC code to the supplier for a licence key.

Restoring an older backup on the normal server works the same way (Backup & restore → pick a backup → **Check** → **Restore**). The data before the restore is always kept as a "pre-restore" backup.

## 8. Licence (supplier only)

The licence key is signed with the supplier's private key in `vendor-keys\licence-private.pem` (created once; **never share it, keep an offline copy** — losing it means no new keys can be made; it is not in git).

```bash
cd server
npx tsx scripts/licence.ts sign 78BA-1F6E-8865-9FB9        # forever
npx tsx scripts/licence.ts sign 78BA-1F6E-8865-9FB9 365    # one year
```

The shop pastes the key in **Settings → Licence → Activate**. Without a licence, after the trial the POS still opens, logs in, shows data and makes backups, but cannot save bills or changes.

## 9. Building the release files (developer PC)

```bash
npm install
npm run package:server     # → release\HaroonPOS-Server\ and release\HaroonPOS-Server.zip
npm run package:counter    # → desktop\release\Haroon POS Counter Setup 1.0.0.exe
```

The server package includes the `node.exe` of the build PC (currently Node 18). If electron-builder fails with "Cannot create symbolic link", turn on Windows *Developer Mode* or pre-extract its `winCodeSign` archive (see README).

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| Counter shows "Not connected" | Is the server PC on? Same WiFi/LAN? `http://192.168.1.10:3000/api/health` in a browser should answer `{"ok":true}`. Windows Firewall rule *Haroon POS* must exist. |
| Service not running | `services.msc` → **HaroonPOS** → Start. Logs: `C:\HaroonPOS\app\server\dist\daemon\`. |
| Printer prints nothing | Settings → This counter → choose the printer → Test print. Check paper width setting (58/80 mm). |
| "Licence expired" | Settings → Licence → send the PC code to the supplier. |
| Wrong PIN lockout | Wait one minute (5 wrong PINs lock that user for a minute). |
