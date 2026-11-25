import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRefreshForTests, api, ApiError, refreshSession } from "./api-client";
import { useAuthStore } from "./auth-store";

const user = { id: "u1", email: "a@b.co", displayName: "A", systemRole: "USER" as const, createdAt: "2026-01-01T00:00:00Z" };

const json = (status: number, body: unknown, type = "application/json") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": type } });

function authHeader(init?: RequestInit) {
  return new Headers(init?.headers).get("Authorization");
}

describe("api client auth handling", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetRefreshForTests();
    useAuthStore.setState({ status: "authenticated", accessToken: "old", user });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("attaches the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await api("/workspaces");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/workspaces", expect.anything());
    expect(authHeader(fetchMock.mock.calls[0][1])).toBe("Bearer old");
  });

  it("on 401 refreshes once (single-flight) for concurrent requests and retries each once", async () => {
    let refreshCalls = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((r) => (releaseRefresh = r));

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/auth/refresh") {
        refreshCalls++;
        expect(init?.credentials).toBe("same-origin");
        await refreshGate;
        return json(200, { accessToken: "new", tokenType: "Bearer", expiresIn: 900, user });
      }
      return authHeader(init) === "Bearer new" ? json(200, { url }) : json(401, { title: "Unauthorized" });
    });

    const p = Promise.all([api<{ url: string }>("/a"), api<{ url: string }>("/b"), api<{ url: string }>("/c")]);
    // Let all three hit the 401 before the refresh resolves.
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    releaseRefresh();
    const results = await p;

    expect(results.map((r) => r.url)).toEqual(["/api/v1/a", "/api/v1/b", "/api/v1/c"]);
    expect(refreshCalls).toBe(1);
    // 3 originals + 1 refresh + 3 retries
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(useAuthStore.getState().accessToken).toBe("new");
  });

  it("retries only once: a second 401 is surfaced as ApiError", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/refresh"
        ? json(200, { accessToken: "new", tokenType: "Bearer", expiresIn: 900, user })
        : json(401, { title: "Unauthorized", detail: "nope" }, "application/problem+json"),
    );
    await expect(api("/x")).rejects.toMatchObject({ status: 401 });
    const nonRefresh = fetchMock.mock.calls.filter(([u]) => u !== "/api/v1/auth/refresh");
    expect(nonRefresh).toHaveLength(2);
  });

  it("clears the session when refresh fails (guard then redirects to /login)", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/v1/auth/refresh" ? json(401, { title: "Unauthorized" }) : json(401, { title: "Unauthorized" }),
    );
    await expect(api("/x")).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState()).toMatchObject({ status: "unauthenticated", accessToken: null, user: null });
  });

  it("does not try to refresh for login failures", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { detail: "Bad credentials" }, "application/problem+json"));
    await expect(api("/auth/login", { method: "POST", body: {}, anonymous: true })).rejects.toMatchObject({
      status: 401,
      message: "Bad credentials",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exposes problem+json detail and field errors", async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { title: "Bad Request", status: 400, detail: "Validation failed", errors: { email: "taken" } }, "application/problem+json"),
    );
    const err = (await api("/x").catch((e) => e)) as ApiError;
    expect(err.message).toBe("Validation failed");
    expect(err.fieldErrors).toEqual({ email: "taken" });
  });

  it("refreshSession shares one in-flight request", async () => {
    fetchMock.mockResolvedValue(json(200, { accessToken: "t2", tokenType: "Bearer", expiresIn: 900, user }));
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect(a).toBe("t2");
    expect(b).toBe("t2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
