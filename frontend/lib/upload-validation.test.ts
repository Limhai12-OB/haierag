import { describe, expect, it } from "vitest";
import { validateUploadFile } from "./upload-validation";

const MB = 1024 * 1024;

describe("validateUploadFile", () => {
  it.each(["a.pdf", "b.DOCX", "c.xlsx", "d.pptx", "e.txt", "f.md", "g.csv"])("accepts %s", (name) => {
    expect(validateUploadFile({ name, size: 10 }, 50)).toEqual({ ok: true });
  });

  it.each(["a.exe", "b.doc", "noext", "c.pdf.zip", ".md"])("rejects %s by type", (name) => {
    const r = validateUploadFile({ name, size: 10 }, 50);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Unsupported file type/);
  });

  it("rejects files over the size limit and accepts exactly at the limit", () => {
    expect(validateUploadFile({ name: "a.pdf", size: 50 * MB }, 50)).toEqual({ ok: true });
    const r = validateUploadFile({ name: "a.pdf", size: 50 * MB + 1 }, 50);
    expect(r).toEqual({ ok: false, reason: "File is larger than the 50 MB limit." });
  });

  it("rejects empty files", () => {
    expect(validateUploadFile({ name: "a.txt", size: 0 }, 50)).toEqual({ ok: false, reason: "The file is empty." });
  });
});
