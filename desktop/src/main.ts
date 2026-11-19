import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { EmergencyQueue } from './queue';
import { isServerUp, loadConfig, normalizeServerUrl, saveConfig } from './config';
import { printSilently } from './print';
import type { Catalog, EmergencyBill } from './types';

const CHECK_MS = 5000;
/** Missed health checks before switching to emergency billing. */
const FAILS_BEFORE_EMERGENCY = 3;

let win: BrowserWindow;
let queue: EmergencyQueue;
let config = loadConfig(app.getPath('userData'));
let mode: 'setup' | 'online' | 'emergency' = 'setup';
let fails = 0;

const page = (name: string) => path.join(__dirname, '..', 'renderer', `${name}.html`);

/** Local-only calls must come from this app's own files, never from a web page. */
function fromLocalPage(e: IpcMainInvokeEvent): void {
  if (!e.senderFrame?.url.startsWith('file://')) throw new Error('Not allowed');
}

async function showSetup() {
  mode = 'setup';
  await win.loadFile(page('setup'));
}

async function showEmergency() {
  mode = 'emergency';
  await win.loadFile(page('emergency'));
}

async function goOnline(): Promise<boolean> {
  if (!(await isServerUp(config.serverUrl))) return false;
  mode = 'online';
  fails = 0;
  await win.loadURL(config.serverUrl);
  return true;
}

function watchServer() {
  setInterval(async () => {
    if (mode !== 'online') return;
    fails = (await isServerUp(config.serverUrl)) ? 0 : fails + 1;
    if (fails >= FAILS_BEFORE_EMERGENCY) await showEmergency();
  }, CHECK_MS);
}

function registerIpc() {
  ipcMain.handle('print', (_e, html: string, width: '58' | '80' | 'a4') => printSilently(html, width, config.printerName, config.serverUrl));
  ipcMain.handle('printers', async () => (await win.webContents.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: p.isDefault })));
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:printer', (_e, name: string) => {
    config = { ...config, printerName: name };
    saveConfig(app.getPath('userData'), config);
  });
  ipcMain.handle('app:setup', () => showSetup());
  ipcMain.handle('catalog:save', (_e, catalog: Catalog) => queue.saveCatalog(catalog));
  ipcMain.handle('emergency:pending', () => queue.pending());
  ipcMain.handle('emergency:uploaded', (_e, billNos: string[]) => queue.markUploaded(billNos));

  ipcMain.handle('local:test-server', (e, address: string) => {
    fromLocalPage(e);
    return isServerUp(normalizeServerUrl(address));
  });
  ipcMain.handle('local:set-server', async (e, address: string) => {
    fromLocalPage(e);
    config = { ...config, serverUrl: normalizeServerUrl(address) };
    saveConfig(app.getPath('userData'), config);
    return goOnline();
  });
  ipcMain.handle('local:catalog', (e) => {
    fromLocalPage(e);
    return queue.catalog();
  });
  ipcMain.handle('local:save-bill', (e, bill: Omit<EmergencyBill, 'billNo'>) => {
    fromLocalPage(e);
    const catalog = queue.catalog();
    if (!catalog) throw new Error('No product list saved on this counter yet.');
    return queue.addBill(bill, catalog.device.billPrefix);
  });
  ipcMain.handle('local:pending-count', (e) => {
    fromLocalPage(e);
    return queue.pending().length;
  });
  ipcMain.handle('local:server-up', (e) => {
    fromLocalPage(e);
    return isServerUp(config.serverUrl);
  });
  ipcMain.handle('local:go-online', (e) => {
    fromLocalPage(e);
    return goOnline();
  });
}

app.whenReady().then(async () => {
  const wasm = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm').replace('app.asar', 'app.asar.unpacked');
  queue = await EmergencyQueue.open(path.join(app.getPath('userData'), 'emergency.db'), wasm);
  win = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    autoHideMenuBar: true,
    title: 'Haroon POS',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.maximize();
  win.show();
  // Pages from the server may not open new windows or wander off to other sites.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(config.serverUrl) && !url.startsWith('file://')) event.preventDefault();
  });
  win.webContents.on('did-fail-load', (_e, _code, _desc, url, isMainFrame) => {
    if (isMainFrame && mode === 'online' && url.startsWith(config.serverUrl)) void showEmergency();
  });
  registerIpc();
  watchServer();
  if (!config.serverUrl) await showSetup();
  else if (!(await goOnline())) await showEmergency();
});

app.on('window-all-closed', () => app.quit());

process.on('uncaughtException', (err) => {
  dialog.showErrorBox('Haroon POS', err.message);
});
