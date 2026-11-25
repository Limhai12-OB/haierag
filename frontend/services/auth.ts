import { api, API_BASE } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import type { AuthResponse, LoginRequest, RegisterRequest, UpdateProfileRequest, User } from "@/types/api";

export async function login(body: LoginRequest): Promise<AuthResponse> {
  const auth = await api<AuthResponse>("/auth/login", { method: "POST", body, anonymous: true });
  useAuthStore.getState().setSession(auth);
  return auth;
}

export async function register(body: RegisterRequest): Promise<AuthResponse> {
  const auth = await api<AuthResponse>("/auth/register", { method: "POST", body, anonymous: true });
  useAuthStore.getState().setSession(auth);
  return auth;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "same-origin" });
  } finally {
    useAuthStore.getState().clear();
  }
}

export const getMe = () => api<User>("/auth/me");

export async function updateMe(body: UpdateProfileRequest): Promise<User> {
  const user = await api<User>("/auth/me", { method: "PUT", body });
  useAuthStore.getState().setUser(user);
  return user;
}
