import { contextBridge, ipcRenderer } from 'electron';

/** Used by the web app loaded from the server (silent print, catalogue cache, emergency upload). */
contextBridge.exposeInMainWorld('posDesktop', {
  print: (html: string, options: { width: '58' | '80' | 'a4' }) => ipcRenderer.invoke('print', html, options.width),
  getPrinters: () => ipcRenderer.invoke('printers'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setPrinter: (name: string) => ipcRenderer.invoke('config:printer', name),
  changeServer: () => ipcRenderer.invoke('app:setup'),
  saveCatalog: (catalog: unknown) => ipcRenderer.invoke('catalog:save', catalog),
  pendingEmergency: () => ipcRenderer.invoke('emergency:pending'),
  markUploaded: (billNos: string[]) => ipcRenderer.invoke('emergency:uploaded', billNos),
});

/** Used only by this app's own local pages (setup and emergency billing). */
contextBridge.exposeInMainWorld('posLocal', {
  testServer: (address: string) => ipcRenderer.invoke('local:test-server', address),
  setServer: (address: string) => ipcRenderer.invoke('local:set-server', address),
  catalog: () => ipcRenderer.invoke('local:catalog'),
  saveBill: (bill: unknown) => ipcRenderer.invoke('local:save-bill', bill),
  pendingCount: () => ipcRenderer.invoke('local:pending-count'),
  serverUp: () => ipcRenderer.invoke('local:server-up'),
  goOnline: () => ipcRenderer.invoke('local:go-online'),
  print: (html: string, width: '58' | '80' | 'a4') => ipcRenderer.invoke('print', html, width),
});
