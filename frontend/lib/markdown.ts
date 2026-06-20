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
  data?: { hName?: string; hProperties?: Record<string, string | boolean> };
};

const EXCALIDRAW = /!\[\[([^[\]]+)\.excalidraw\]\]/g;
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

      // Diagramas Excalidraw embebidos (HU-16 CA2): placeholder que el
      // cliente reemplaza por el SVG renderizado.
      for (const match of value.matchAll(EXCALIDRAW)) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          node: {
            type: "link",
            url: "#excalidraw",
            data: {
              hProperties: {
                className: "mic-excalidraw",
                dataDiag: match[1],
              },
            },
            children: [{ type: "text", value: `Diagrama ${match[1]}` }],
          },
        });
      }

      for (const match of value.matchAll(WIKILINK)) {
        // [[destino|alias]]: el destino navega; el alias es lo que se muestra.
        const pipe = match[1].indexOf("|");
        const target = (pipe === -1 ? match[1] : match[1].slice(0, pipe)).trim();
        const label = pipe === -1 ? target : match[1].slice(pipe + 1).trim() || target;
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          node: {
            type: "link",
            url: `#wikilink:${encodeURIComponent(target)}`,
            data: { hProperties: { className: "mic-wikilink" } },
            children: [{ type: "text", value: label }],
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

/**
 * Callouts estilo Obsidian: `> [!TIPO]` con plegado opcional `-`/`+` y título
 * en la primera línea (HU-03 CA5/CA6). Acepta mayúsculas/minúsculas.
 */
const CALLOUT_RE =
  /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|SUCCESS|ERROR|DANGER|QUESTION)\]([-+]?)[ \t]*/i;

const CALLOUT_LABELS: Record<string, string> = {
  note: "Nota",
  tip: "Consejo",
  important: "Importante",
  warning: "Advertencia",
  caution: "Precaución",
  info: "Información",
  success: "Éxito",
  error: "Error",
  danger: "Peligro",
  question: "Pregunta",
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
      const symbol = match[2];
      const foldable = symbol === "-" || symbol === "+";
      const open = symbol === "+";

      // Quitar "[!tipo][-+] " y separar el título (1ª línea) del cuerpo
      const rest = firstText.value.replace(CALLOUT_RE, "");
      const nl = rest.indexOf("\n");
      const titulo = (nl >= 0 ? rest.slice(0, nl) : rest).trim();
      firstText.value = nl >= 0 ? rest.slice(nl + 1) : "";
      if (!firstText.value && first.children!.length === 1) {
        node.children!.shift();
      }

      const className = `mic-callout mic-callout-${tipo}`;
      // Plegable → <details>/<summary>; `+` abierto, `-` cerrado (HU-03)
      node.data = {
        hName: foldable ? "details" : undefined,
        hProperties: foldable && open ? { className, open: true } : { className },
      };
      node.children!.unshift({
        type: "paragraph",
        data: {
          hName: foldable ? "summary" : undefined,
          hProperties: { className: "mic-callout-title" },
        },
        children: [{ type: "text", value: titulo || CALLOUT_LABELS[tipo] }],
      });
    });
  };
}

/**
 * Estilo propio de Mycelium para diferenciar el énfasis con `*` del énfasis con
 * `_` (markdown estándar los trata igual; aquí es solo visual dentro del sistema):
 *   *x*   cursiva                         _x_   cursiva + color --mic-glow
 *   **x** negrita                         __x__ negrita + color --mic-accent
 *   ***x*** cursiva + negrita             ___x___ negrita (sin cursiva) + degradado
 * El marcador (`*`/`_`) no se conserva en el AST, así que se recupera leyendo el
 * carácter del documento original en la posición del nodo.
 */
function remarkEmphasisStyle() {
  return (tree: Parent, file: { toString(): string }) => {
    const src = String(file);
    const marker = (n: MdNode): string => {
      const off = (n as { position?: { start?: { offset?: number } } }).position?.start?.offset;
      return off === undefined ? "" : src[off] ?? "";
    };
    const handled = new WeakSet<MdNode>();
    visit(tree, (node: MdNode) => {
      if (node.type !== "emphasis" && node.type !== "strong") return;
      if (handled.has(node)) return;
      if (marker(node) !== "_") return; // `*` usa el estilo por defecto

      // ___texto___  →  emphasis(_) que envuelve un único strong(_)
      const inner = node.children?.[0];
      if (
        node.type === "emphasis" &&
        node.children?.length === 1 &&
        inner?.type === "strong" &&
        marker(inner) === "_"
      ) {
        addClass(node, "mic-em-us-tri-outer"); // <em> sin cursiva
        addClass(inner, "mic-em-us-tri"); // <strong> negrita + degradado
        handled.add(inner);
        return;
      }
      addClass(node, node.type === "emphasis" ? "mic-em-us" : "mic-strong-us");
    });
  };
}

function addClass(node: MdNode, cls: string) {
  node.data ??= {};
  const props = (node.data.hProperties ??= {});
  const prev = typeof props.className === "string" ? props.className : "";
  props.className = prev ? `${prev} ${cls}` : cls;
}

/**
 * Hace togglables los checkboxes de listas de tareas en lectura/dividido: quita
 * el `disabled` que pone remark-gfm y numera cada uno en orden de documento
 * (data-task) para que el editor sepa qué marcador `[ ]`/`[x]` alternar.
 */
function rehypeTaskCheckbox() {
  return (tree: Parent) => {
    let i = 0;
    visit(tree, "element", (node: MdNode & { tagName?: string; properties?: Record<string, unknown> }) => {
      if (node.tagName !== "input" || node.properties?.type !== "checkbox") return;
      const props = node.properties;
      delete props.disabled;
      props.className = ["mic-task-check"];
      props.dataTask = String(i++);
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkMicelio)
  .use(remarkCallouts)
  .use(remarkEmphasisStyle)
  .use(remarkRehype)
  .use(rehypeTaskCheckbox)
  // mermaid/excalidraw se renderizan aparte (HU-18/HU-16); no resaltarlos
  .use(rehypeHighlight, { plainText: ["mermaid", "excalidraw"] })
  .use(rehypeKatex)
  .use(rehypeStringify);

/** Markdown → HTML. 100% en cliente, sin llamadas al servidor (HU-01 CA10). */
export function renderMarkdown(markdown: string): string {
  return String(processor.processSync(markdown));
}
