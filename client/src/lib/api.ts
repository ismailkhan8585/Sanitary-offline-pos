import { getSession, setSession } from './session';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public params: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export async function api<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  const token = getSession()?.token;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check the network cable or WiFi.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && token && data?.code === 'UNAUTHORIZED') setSession(null);
    throw new ApiError(res.status, data?.code ?? 'SERVER_ERROR', data?.message ?? res.statusText, data?.params ?? {});
  }
  return data as T;
}

/** URL for a file download (Excel/PDF) that carries the session token. */
export function downloadUrl(path: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...params, token: getSession()?.token ?? '' });
  return `/api${path}?${q}`;
}
