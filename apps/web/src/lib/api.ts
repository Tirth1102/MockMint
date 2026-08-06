/**
 * API client.
 *
 * Holds the short-lived access token in memory only — never in localStorage, so an XSS
 * payload cannot read it. The rotating refresh token lives in an httpOnly cookie the
 * browser attaches automatically; on a 401 we refresh once and replay the request.
 */
import type { ApiError, AuthResponse, User } from '@mockmint/shared';

// In production, use a relative base so the browser sends /api/* requests to
// the same Vercel origin — the rewrite in next.config.mjs forwards them to Render.
// This keeps cookies same-site and eliminates cross-domain refresh failures.
export const API_URL =
  process.env.NODE_ENV === 'production'
    ? ''
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiError) {
    super(body.message || 'Request failed');
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.error;
    this.details = body.details;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set false for the auth endpoints, which must not trigger a refresh loop. */
  retryOnUnauthorized?: boolean;
}

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const { body, retryOnUnauthorized, ...init } = options;
  const headers = new Headers(init.headers);

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isFormData) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    body:
      body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });
}

/** Refreshes the access token. Concurrent callers share one in-flight request. */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const data = (await res.json()) as AuthResponse;
      accessToken = data.tokens.accessToken;
      return true;
    } catch {
      accessToken = null;
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const retry = options.retryOnUnauthorized ?? true;
  let res = await rawRequest(path, options);

  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await rawRequest(path, options);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      (data as ApiError) ?? { error: 'unknown', message: 'Request failed' },
    );
  }

  return data as T;
}

export const api = {
  get: <T,>(path: string) => apiRequest<T>(path),
  post: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T,>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

// ---------------------------------------------------------------- auth calls

export async function login(email: string, password: string): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    retryOnUnauthorized: false,
  });
  accessToken = data.tokens.accessToken;
  return data;
}

export async function register(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: { name, email, password },
    retryOnUnauthorized: false,
  });
  accessToken = data.tokens.accessToken;
  return data;
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  return apiRequest('/api/auth/forgot-password', {
    method: 'POST',
    body: { email },
    retryOnUnauthorized: false,
  });
}

export async function logout(): Promise<void> {
  try {
    await apiRequest<void>('/api/auth/logout', { method: 'POST', retryOnUnauthorized: false });
  } finally {
    accessToken = null;
  }
}

/** Restores a session from the refresh cookie on a cold page load. */
export async function restoreSession(): Promise<User | null> {
  const refreshed = await refreshAccessToken();
  if (!refreshed) return null;
  try {
    const data = await apiRequest<{ user: User }>('/api/auth/session', {
      retryOnUnauthorized: false,
    });
    return data.user;
  } catch {
    return null;
  }
}
