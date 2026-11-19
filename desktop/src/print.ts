import { BrowserWindow } from 'electron';

const MICRONS_PER_PX = 25400 / 96;

/**
 * Prints an HTML document straight to the printer (no dialog).
 * Loading the server's blank print page first gives the receipt the app's fonts;
 * when the server is down the page falls back to system fonts.
 */
export async function printSilently(html: string, width: '58' | '80' | 'a4', printerName: string, serverUrl: string): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    try {
      await win.loadURL(`${serverUrl}/print.html`);
    } catch {
      await win.loadURL('about:blank');
    }
    await win.webContents.executeJavaScript(`document.open(); document.write(${JSON.stringify(html)}); document.close(); document.fonts.ready.then(() => true)`);
    const heightPx: number = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
    const pageSize =
      width === 'a4' ? ('A4' as const) : { width: (width === '58' ? 58 : 80) * 1000, height: Math.max(100_000, Math.ceil(heightPx * MICRONS_PER_PX) + 10_000) };
    await new Promise<void>((resolve, reject) =>
      win.webContents.print({ silent: true, printBackground: true, deviceName: printerName || undefined, margins: { marginType: 'none' }, pageSize }, (ok, reason) =>
        ok ? resolve() : reject(new Error(`Printer: ${reason}`)),
      ),
    );
  } finally {
    win.destroy();
  }
}
