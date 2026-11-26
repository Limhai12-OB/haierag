import { describe, expect, it } from "vitest";
import { fileTypeLabel, safeExternalUrl, urlHost } from "./format";

describe("link helpers", () => {
  it("only allows http(s) URLs as external links", () => {
    expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,hi")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl("not a url")).toBeNull();
  });

  it("labels web pages and shows hosts", () => {
    expect(fileTypeLabel("HTML")).toBe("Web page");
    expect(fileTypeLabel("PDF")).toBe("PDF");
    expect(urlHost("https://km.wikipedia.org/wiki/x")).toBe("km.wikipedia.org");
  });
});
