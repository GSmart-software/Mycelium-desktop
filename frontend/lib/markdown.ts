import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Parent } from "unist";

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, string> };
};

const WIKILINK = /\[\[([^[\]]+)\]\]/g;
const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;

/**
 * Plugin remark: convierte [[enlaces internos]] y #tags en nodos link
 * estilizados (HU-01 CA8/CA9). La navegación se resuelve en el cliente
 * interceptando los href #wikilink:/#tag:.
 */
function remarkMicelio() {
  return (tree: Parent) => {
    visit(tree, "text", (node: MdNode, index, parent: Parent | undefined) => {
      if (!parent || index === undefined || !node.value) return;
      const value = node.value;
      const pieces: MdNode[] = [];
      let cursor = 0;

      const matches: { start: number; end: number; node: MdNode }[] = [];

      for (const match of value.matchAll(WIKILINK)) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          node: {
            type: "link",
            url: `#wikilink:${encodeURIComponent(match[1])}`,
            data: { hProperties: { className: "mic-wikilink" } },
            children: [{ type: "text", value: match[1] }],
          },
        });
      }

      for (const match of value.matchAll(TAG)) {
        const offset = match[1].length;
        matches.push({
          start: match.index + offset,
          end: match.index + match[0].length,
          node: {
            type: "link",
            url: `#tag:${encodeURIComponent(match[2])}`,
            data: { hProperties: { className: "mic-tag-pill" } },
            children: [{ type: "text", value: `#${match[2]}` }],
          },
        });
      }

      if (matches.length === 0) return;
      matches.sort((a, b) => a.start - b.start);

      for (const m of matches) {
        if (m.start < cursor) continue; // solapado
        if (m.start > cursor) pieces.push({ type: "text", value: value.slice(cursor, m.start) });
        pieces.push(m.node);
        cursor = m.end;
      }
      if (cursor < value.length) pieces.push({ type: "text", value: value.slice(cursor) });

      parent.children.splice(index, 1, ...(pieces as never[]));
      return index + pieces.length;
    });
  };
}

/** Callouts estilo Obsidian: `> [!TIPO]` (HU-03 CA5/CA6). */
const CALLOUT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

const CALLOUT_LABELS: Record<string, string> = {
  note: "Nota",
  tip: "Consejo",
  important: "Importante",
  warning: "Advertencia",
  caution: "Precaución",
};

function remarkCallouts() {
  return (tree: Parent) => {
    visit(tree, "blockquote", (node: MdNode) => {
      const first = node.children?.[0];
      if (first?.type !== "paragraph") return;
      const firstText = first.children?.[0];
      if (firstText?.type !== "text" || !firstText.value) return;
      const match = CALLOUT_RE.exec(firstText.value);
      if (!match) return;

      const tipo = match[1].toLowerCase();
      firstText.value = firstText.value.replace(CALLOUT_RE, "").replace(/^\n/, "");
      if (!firstText.value && first.children!.length === 1) {
        node.children!.shift();
      }

      node.data = {
        hProperties: { className: `mic-callout mic-callout-${tipo}` },
      };
      node.children!.unshift({
        type: "paragraph",
        data: { hProperties: { className: "mic-callout-title" } },
        children: [{ type: "text", value: CALLOUT_LABELS[tipo] }],
      });
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkMicelio)
  .use(remarkCallouts)
  .use(remarkRehype)
  // mermaid/excalidraw se renderizan aparte (HU-18/HU-16); no resaltarlos
  .use(rehypeHighlight, { plainText: ["mermaid", "excalidraw"] })
  .use(rehypeKatex)
  .use(rehypeStringify);

/** Markdown → HTML. 100% en cliente, sin llamadas al servidor (HU-01 CA10). */
export function renderMarkdown(markdown: string): string {
  return String(processor.processSync(markdown));
}
