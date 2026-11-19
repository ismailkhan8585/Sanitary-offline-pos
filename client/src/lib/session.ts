import { useSyncExternalStore } from 'react';
import type { Role } from '@shared/permissions';

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
}

export interface Session {
  token: string;
  user: SessionUser;
}

const SESSION_KEY = 'pos.session';
const DEVICE_KEY = 'pos.deviceId';
const listeners = new Set<() => void>();

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

let session = read<Session>(SESSION_KEY);
let deviceId = read<number>(DEVICE_KEY);

function emit() {
  listeners.forEach((l) => l());
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the session still works until the page reloads.
  }
}

export function getSession() {
  return session;
}

export function setSession(next: Session | null) {
  session = next;
  write(SESSION_KEY, next);
  emit();
}

export function getDeviceId() {
  return deviceId;
}

export function setDeviceId(id: number | null) {
  deviceId = id;
  write(DEVICE_KEY, id);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession() {
  return useSyncExternalStore(subscribe, getSession);
}

export function useDeviceId() {
  return useSyncExternalStore(subscribe, getDeviceId);
}
