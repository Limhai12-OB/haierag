/**
 * Remark plugin: turns `[n]` citation markers inside text into links with href `#cite-n`,
 * which the markdown renderer maps to citation chips. Markers inside code are left alone
 * (code is a separate mdast node type, not "text").
 */
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

export const CITATION_RE = /\[(\d{1,3})\]/g;
export const CITE_HREF_PREFIX = "#cite-";

function splitText(value: string): MdNode[] | null {
  CITATION_RE.lastIndex = 0;
  if (!CITATION_RE.test(value)) return null;
  CITATION_RE.lastIndex = 0;
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(CITATION_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: value.slice(last, idx) });
    out.push({ type: "link", url: `${CITE_HREF_PREFIX}${m[1]}`, children: [{ type: "text", value: m[1] }] });
    last = idx + m[0].length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

function walk(node: MdNode) {
  if (!node.children || node.type === "link" || node.type === "linkReference") return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitText(child.value);
      if (parts) {
        next.push(...parts);
        continue;
      }
    }
    walk(child);
    next.push(child);
  }
  node.children = next;
}

export function remarkCitations() {
  return (tree: MdNode) => walk(tree);
}

/** Marker numbers referenced in a text, in order of first appearance. */
export function extractMarkers(text: string): number[] {
  const seen = new Set<number>();
  for (const m of text.matchAll(CITATION_RE)) seen.add(Number(m[1]));
  return [...seen];
}
