import fs from 'node:fs';
import path from 'node:path';
import type { DesktopConfig } from './types';

const DEFAULTS: DesktopConfig = { serverUrl: '', printerName: '' };

export function loadConfig(dir: string): DesktopConfig {
  try {
    return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) as Partial<DesktopConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(dir: string, cfg: DesktopConfig): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
}

/** "192.168.1.10" → "http://192.168.1.10:3000" */
export function normalizeServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  const parsed = new URL(url);
  if (!parsed.port && parsed.protocol === 'http:') parsed.port = '3000';
  return parsed.origin;
}

export async function isServerUp(serverUrl: string, timeoutMs = 2500): Promise<boolean> {
  if (!serverUrl) return false;
  try {
    const res = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
