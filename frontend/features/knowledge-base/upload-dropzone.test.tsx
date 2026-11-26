import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import type { Document } from "@/types/api";
import { UploadDropzone } from "./upload-dropzone";

function setup(upload = vi.fn().mockResolvedValue({ id: "d1" } as Document)) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <UploadDropzone workspaceId="ws1" collections={[]} defaultCollectionId={null} upload={upload} />
    </QueryClientProvider>,
  );
  return upload;
}

function fileOfSize(name: string, size: number) {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

const drop = (files: File[]) =>
  fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files, types: ["Files"] } });

describe("UploadDropzone", () => {
  it("rejects unsupported types client-side without uploading", async () => {
    const upload = setup();
    drop([fileOfSize("malware.exe", 100)]);
    expect(await screen.findByText(/Unsupported file type "\.exe"/)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects oversized files client-side", async () => {
    const upload = setup();
    drop([fileOfSize("huge.pdf", 51 * 1024 * 1024)]);
    expect(await screen.findByText("File is larger than the 50 MB limit.")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads valid files and shows server problem+json detail on failure", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ id: "ok" })
      .mockRejectedValueOnce(
        new ApiError(415, { title: "Unsupported Media Type", detail: "File content does not match .pdf" }),
      );
    setup(upload);
    drop([fileOfSize("good.md", 10), fileOfSize("fake.pdf", 10)]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls[0][0]).toBe("ws1");
    expect(await screen.findByText("File content does not match .pdf")).toBeInTheDocument();
    expect(await screen.findByText("Queued for processing")).toBeInTheDocument();
  });

  it("restricts the file picker via the accept attribute", () => {
    setup();
    const input = screen.getByLabelText("Choose files to upload");
    expect(input.getAttribute("accept")).toContain(".pdf");
    expect(input.getAttribute("accept")).toContain(".csv");
  });
});

describe("UploadDropzone — import from link", () => {
  function setupLink(importUrl: ReturnType<typeof vi.fn>) {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <UploadDropzone
          workspaceId="ws1"
          collections={[]}
          defaultCollectionId="col1"
          upload={vi.fn()}
          importUrl={importUrl as never}
        />
      </QueryClientProvider>,
    );
    return screen.getByLabelText("Link to a web page or file");
  }

  it("imports a link into the selected collection and shows the page title", async () => {
    const importUrl = vi
      .fn()
      .mockResolvedValue({ id: "d1", name: "Angkor Wat - Wikipedia", sizeBytes: 2048 } as Document);
    const input = setupLink(importUrl);
    fireEvent.change(input, { target: { value: "  https://en.wikipedia.org/wiki/Angkor_Wat " } });
    fireEvent.click(screen.getByRole("button", { name: /Import link/ }));
    await waitFor(() =>
      expect(importUrl).toHaveBeenCalledWith("ws1", "https://en.wikipedia.org/wiki/Angkor_Wat", "col1"),
    );
    expect(await screen.findByText("Angkor Wat - Wikipedia")).toBeInTheDocument();
    expect(screen.getByText("Downloaded · queued for processing")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("rejects non-http links client-side", async () => {
    const importUrl = vi.fn();
    const input = setupLink(importUrl);
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Enter a full link starting with https:// or http://")).toBeInTheDocument();
    expect(importUrl).not.toHaveBeenCalled();
  });

  it("shows the server's reason when a link is refused and keeps the link for editing", async () => {
    const importUrl = vi.fn().mockRejectedValue(
      new ApiError(400, {
        title: "Bad Request",
        detail: "Validation failed",
        errors: { url: "Links to local or private network addresses are not allowed." },
      }),
    );
    const input = setupLink(importUrl);
    fireEvent.change(input, { target: { value: "http://192.168.1.1/admin" } });
    fireEvent.click(screen.getByRole("button", { name: /Import link/ }));
    expect(await screen.findByText("Links to local or private network addresses are not allowed.")).toBeInTheDocument();
    expect(input).toHaveValue("http://192.168.1.1/admin");
  });
});
