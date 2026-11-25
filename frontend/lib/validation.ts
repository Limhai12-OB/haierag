const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function validateEmail(email: string): string | undefined {
  if (!email.trim()) return "Email is required.";
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
  return undefined;
}

export function validateLogin(v: { email: string; password: string }): FieldErrors<"email" | "password"> {
  const e: FieldErrors<"email" | "password"> = {};
  const email = validateEmail(v.email);
  if (email) e.email = email;
  if (!v.password) e.password = "Password is required.";
  return e;
}

export type RegisterValues = { displayName: string; email: string; password: string; confirmPassword: string };

export function validateRegister(v: RegisterValues): FieldErrors<keyof RegisterValues> {
  const e: FieldErrors<keyof RegisterValues> = {};
  const name = v.displayName.trim();
  if (!name) e.displayName = "Display name is required.";
  else if (name.length > 100) e.displayName = "Display name must be at most 100 characters.";
  const email = validateEmail(v.email);
  if (email) e.email = email;
  if (!v.password) e.password = "Password is required.";
  else if (v.password.length < 8) e.password = "Password must be at least 8 characters.";
  else if (v.password.length > 128) e.password = "Password must be at most 128 characters.";
  if (!v.confirmPassword) e.confirmPassword = "Please confirm your password.";
  else if (v.confirmPassword !== v.password) e.confirmPassword = "Passwords do not match.";
  return e;
}

export const hasErrors = (e: object) => Object.values(e).some(Boolean);
