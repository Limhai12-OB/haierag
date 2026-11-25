import { useAuthStore } from "@/lib/auth-store";
import type { AuthResponse, ProblemDetail } from "@/types/api";

/** All API traffic goes same-origin through the Next.js proxy (see app/api/v1/[...path]/route.ts). */
export const API_BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetail | null;

  constructor(status: number, problem: ProblemDetail | null, fallback?: string) {
    super(problem?.detail || problem?.title || fallback || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }

  get fieldErrors(): Record<string, string> {
    return this.problem?.errors ?? {};
  }
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Network error — the server could not be reached.";
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export async function readProblem(res: Response): Promise<ProblemDetail | null> {
  const type = res.headers.get("content-type") ?? "";
  try {
    if (type.includes("json")) return (await res.json()) as ProblemDetail;
    const text = await res.text();
    return text ? { detail: text.slice(0, 500), status: res.status } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Refresh (single-flight)
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Concurrent callers share one
 * request — important because refresh tokens rotate and a reused token revokes the whole family.
 * Resolves to the new access token, or null (session cleared) on failure.
 */
export function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          useAuthStore.getState().clear();
          return null;
        }
        const auth = (await res.json()) as AuthResponse;
        useAuthStore.getState().setSession(auth);
        return auth.accessToken;
      } catch {
        useAuthStore.getState().clear();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/** Test helper. */
export function __resetRefreshForTests() {
  refreshInFlight = null;
}

const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

export type AuthFetchInit = RequestInit & {
  /** Skip the Authorization header and 401 handling (login/register). */
  anonymous?: boolean;
};

/**
 * fetch() against the API with Bearer auth. On 401 performs a (shared) refresh and retries once.
 * Returns the raw Response (not checked for ok) — used for JSON, downloads and SSE streams.
 */
export async function authFetch(path: string, init: AuthFetchInit = {}): Promise<Response> {
  const { anonymous, ...rest } = init;
  const url = path.startsWith("http") || path.startsWith("/api/") ? path : `${API_BASE}${path}`;

  const send = (token: string | null) => {
    const headers = new Headers(rest.headers);
    if (token && !anonymous) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...rest, headers, credentials: "same-origin" });
  };

  const tokenUsed = useAuthStore.getState().accessToken;
  const res = await send(tokenUsed);
  if (res.status !== 401 || anonymous || NO_REFRESH_PATHS.some((p) => path.startsWith(p))) {
    return res;
  }

  // Another request may already have refreshed while this one was in flight.
  const current = useAuthStore.getState().accessToken;
  const newToken = current && current !== tokenUsed ? current : await refreshSession();
  if (!newToken) return res;
  return send(newToken);
}

export type ApiRequestInit = Omit<AuthFetchInit, "body"> & { body?: unknown };

/** JSON request helper. Throws ApiError (with problem+json detail) on non-2xx. */
export async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { body, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Accept", "application/json");
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }
  const res = await authFetch(path, { ...rest, headers, body: payload });
  if (!res.ok) throw new ApiError(res.status, await readProblem(res));
  if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
