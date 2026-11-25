import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Citation, ConversationDetail } from "@/types/api";
import { ChatThread } from "./chat-thread";
import { MarkdownAnswer } from "./markdown-answer";

const citations: Citation[] = [
  {
    marker: 1,
    chunkId: "c1",
    documentId: "doc-1",
    documentName: "Annual Report.pdf",
    pageNumber: 4,
    sectionHeading: "Financial highlights",
    excerpt: "Revenue grew 12% year over year.",
    retrievalScore: 0.0325,
    rerankScore: 0.91,
  },
  {
    marker: 2,
    chunkId: "c2",
    documentId: "doc-2",
    documentName: "Ops Notes.md",
    pageNumber: null,
    sectionHeading: null,
    excerpt: "Costs fell after consolidation.",
    retrievalScore: 0.016,
    rerankScore: null,
  },
];

const detail: ConversationDetail = {
  id: "conv-1",
  workspaceId: "ws-1",
  title: "Q3 results",
  scopeType: "WORKSPACE",
  collectionId: null,
  documentIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  messages: [
    {
      id: "m1",
      role: "USER",
      content: "How did we do?",
      status: "COMPLETED",
      citations: [],
      metadata: {},
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "m2",
      role: "ASSISTANT",
      content: "Revenue grew 12% [1]. Costs fell [2]. Code `[3]` stays literal.",
      status: "COMPLETED",
      citations,
      metadata: {},
      createdAt: "2026-01-01T00:00:01Z",
    },
  ],
};

vi.mock("@/services/conversations", () => ({
  getConversation: vi.fn(async () => detail),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("MarkdownAnswer citation markers", () => {
  it("renders [n] markers as clickable chips and calls back with the citation", async () => {
    const onClick = vi.fn();
    render(<MarkdownAnswer content="Fact one [1] and two [2]." citations={citations} onCitationClick={onClick} />);
    const chip = screen.getByRole("button", { name: "Source 1: Annual Report.pdf, page 4" });
    expect(chip).toHaveTextContent("1");
    expect(screen.queryByText("[1]")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Source 2: Ops Notes.md" }));
    expect(onClick).toHaveBeenCalledWith(citations[1]);
  });

  it("renders markers with no matching citation as non-interactive", () => {
    render(<MarkdownAnswer content="Unknown [9]." citations={citations} onCitationClick={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("never injects raw HTML from model output", () => {
    const { container } = render(
      <MarkdownAnswer
        content={'Hi <img src=x onerror="alert(1)"> <script>alert(2)</script> [link](javascript:alert(3))'}
        citations={[]}
        onCitationClick={vi.fn()}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    const a = container.querySelector("a");
    expect(a?.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
  });
});

describe("ChatThread source preview", () => {
  it("opens the source panel when a citation chip is clicked", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <ChatThread conversationId="conv-1" />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    const chip = await screen.findByRole("button", { name: "Source 1: Annual Report.pdf, page 4" });
    // Inline code is not turned into a chip.
    expect(screen.getByText("[3]")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Source preview" })).not.toBeInTheDocument();

    await userEvent.click(chip);
    const panel = screen.getByRole("complementary", { name: "Source preview" });
    expect(within(panel).getByText("Source [1]")).toBeInTheDocument();
    expect(within(panel).getByText("Annual Report.pdf")).toBeInTheDocument();
    expect(within(panel).getByText(/Page 4/)).toHaveTextContent("Page 4 · Financial highlights");
    expect(within(panel).getByText("Revenue grew 12% year over year.")).toBeInTheDocument();
    expect(within(panel).getByText("0.0325")).toBeInTheDocument();
    expect(within(panel).getByText("0.910")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /Open document/ })).toHaveAttribute("href", "/documents/doc-1");

    // Citation cards open the same panel for another source.
    await userEvent.click(screen.getByRole("button", { name: "Open source 2: Ops Notes.md" }));
    expect(within(screen.getByRole("complementary", { name: "Source preview" })).getByText("Source [2]")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close source preview" }));
    expect(screen.queryByRole("complementary", { name: "Source preview" })).not.toBeInTheDocument();
  });
});
