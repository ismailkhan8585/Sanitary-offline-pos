/** Bridge the Electron counter app adds (silent printing, emergency queue). Absent in a normal browser. */
export interface DesktopBridge {
  print(html: string, options: { width: '58' | '80' | 'a4' }): Promise<void>;
}

declare global {
  interface Window {
    posDesktop?: DesktopBridge;
  }
}

/** Prints an HTML document: silently on the Electron counter app, with the print dialog in a browser. */
export async function printHtml(html: string, width: '58' | '80' | 'a4'): Promise<void> {
  if (window.posDesktop) return window.posDesktop.print(html, { width });
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((r) => (frame.contentWindow!.document.readyState === 'complete' ? r(null) : frame.addEventListener('load', r, { once: true })));
  await doc.fonts?.ready;
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 1000);
}
