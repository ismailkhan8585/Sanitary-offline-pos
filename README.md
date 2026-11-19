# Haroon POS

Offline point of sale for Haroon Electric & Sanitary Store — one server PC, several counters on the shop LAN, English + Urdu.

- **server/** — Fastify 4 + better-sqlite3 + Drizzle + Socket.IO. Only this process opens the SQLite file.
- **client/** — React + Vite + Tailwind (shadcn-style components). Served by the server; also loaded by the counter app; installable on tablets.
- **desktop/** — Electron counter app: silent receipt printing, emergency billing queue (sql.js) and upload.
- **installer/** — server install/uninstall scripts. **scripts/** — release packaging.
- **docs/INSTALL.md** — installation, backups, disaster recovery, licence (start there for shop setup).

## Develop

```bash
npm install
npm run dev:server        # API on :3000 (data in server/data)
npm run dev:client        # Vite on :5173, proxies /api and /socket.io to :3000
npm run typecheck
npm test                  # vitest in server, client, desktop
cd desktop && npm start   # counter app (unset ELECTRON_RUN_AS_NODE if your shell sets it)
```

First login: Admin / PIN 1234. Database migrations: edit `server/src/db/schema.ts`, then `npm run db:generate -w server`.

## Design notes

- Money is integer paisa; quantities are REAL in base units (pack units convert via `pack_qty`).
- Stock = sum of `stock_movements`; `product_stock` is updated in the same transaction.
- Every multi-table write runs in one transaction (`server/src/lib/tx.ts`); nothing is deleted.
- Permissions live in `server/src/shared/permissions.ts` and are checked on the server for every request; cashier rule-breaks need an Admin PIN (`server/src/lib/approval.ts`).
- Successful writes broadcast the data topics they touched over Socket.IO (`server/src/lib/realtime.ts`); clients refetch those queries.
- Bill arithmetic and Roman-Urdu search are shared by client and server (`server/src/shared`).

## Building releases

```bash
npm run package:server    # release/HaroonPOS-Server(.zip) with node.exe, install.ps1
npm run package:counter   # desktop/release/Haroon POS Counter Setup 1.0.0.exe
```

electron-builder on Windows without Developer Mode fails to unpack `winCodeSign` (macOS symlinks). Fix once:
extract `winCodeSign-2.6.0.7z` with `node_modules/7zip-bin/win/x64/7za.exe x <archive> -o%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0 -x!darwin`.

## Known limits

- Built and tested on Node 18 (the bundled runtime). Fastify 5 needs Node 20+; upgrading Node and Fastify together is recommended when convenient.
- Tablets can fully "install" the PWA only on a secure origin (see docs/INSTALL.md §5); otherwise use Add to Home screen.
- The closing-report PDF is English only (PDF fonts); the app and receipts are bilingual.
