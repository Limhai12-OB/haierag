export const ALLOWED_EXTENSIONS = ["pdf", "docx", "xlsx", "pptx", "txt", "md", "csv"] as const;

/** `accept` attribute for the file input. */
export const ACCEPT_ATTR = [
  ...ALLOWED_EXTENSIONS.map((e) => `.${e}`),
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
].join(",");

/** Mirrors backend MAX_UPLOAD_SIZE_MB (default 50). Override at build with NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB. */
export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB) || 50;

export type FileValidation = { ok: true } | { ok: false; reason: string };

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Client-side pre-check only; the server re-validates by extension and magic bytes. */
export function validateUploadFile(file: { name: string; size: number }, maxMb = MAX_UPLOAD_MB): FileValidation {
  const ext = fileExtension(file.name);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      reason: `Unsupported file type${ext ? ` ".${ext}"` : ""}. Allowed: ${ALLOWED_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")}.`,
    };
  }
  if (file.size === 0) return { ok: false, reason: "The file is empty." };
  if (file.size > maxMb * 1024 * 1024) {
    return { ok: false, reason: `File is larger than the ${maxMb} MB limit.` };
  }
  return { ok: true };
}
