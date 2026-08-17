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
import { cuerpoDe, separarFrontmatter, type Propiedad, type TipoPropiedad } from "@/lib/frontmatter";

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
// Tipo genérico (`[\w-]+`): cualquier tipo es válido para poder crear callouts
// nuevos solo con CSS/snippets (estilo Obsidian); el estilo lo decide el atributo
// data-callout + las variables --mic-callout-color/--mic-callout-icon.
const CALLOUT_RE = /^\[!([\w-]+)\]([-+]?)[ \t]*/;

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

      // El estilo lo decide `data-callout` + las variables CSS (no la clase por
      // tipo), así un snippet puede crear/redefinir tipos sin tocar código.
      const hProperties: Record<string, string | boolean> = {
        className: "mic-callout",
        dataCallout: tipo,
      };
      // Plegable → <details>/<summary>; `+` abierto, `-` cerrado (HU-03)
      node.data = {
        hName: foldable ? "details" : undefined,
        hProperties: foldable && open ? { ...hProperties, open: true } : hProperties,
      };
      node.children!.unshift({
        type: "paragraph",
        data: {
          hName: foldable ? "summary" : undefined,
          hProperties: { className: "mic-callout-title" },
        },
        // Tipo desconocido sin título → usar el nombre del tipo como etiqueta.
        children: [{ type: "text", value: titulo || CALLOUT_LABELS[tipo] || tipo }],
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

/**
 * Línea del documento a la que corresponde el HTML que se está generando
 * (`DEF-055`). El cuerpo se renderiza SIN el frontmatter, así que hay que
 * sumarle dónde empieza; se guarda acá porque `processSync` es síncrono y no se
 * puede intercalar otra llamada en el medio.
 */
let offsetDeLineas = 0;

/**
 * Marca cada bloque de primer nivel con su **línea de origen** (`DEF-055`).
 *
 * Es lo que permite mantener la posición de lectura al cambiar de modo con
 * exactitud: sin esto solo se puede mapear por proporción entre dos alturas, y
 * eso nunca coincide —una tabla de diez filas ocupa diez líneas en markdown y
 * una caja compacta renderizada—. Con la línea a la vista, «estabas en la 214»
 * se resuelve buscando el bloque que nació en la 214.
 *
 * Solo el primer nivel: es el grano al que se desplaza, y marcar cada `<em>`
 * engordaría el HTML sin que nadie lo use.
 */
function rehypeLineas(opciones: { activo: boolean }) {
  return (tree: Parent) => {
    if (!opciones.activo) return;
    for (const hijo of tree.children as MdNode[]) {
      const el = hijo as MdNode & {
        tagName?: string;
        properties?: Record<string, unknown>;
        position?: { start?: { line?: number } };
      };
      const linea = el.position?.start?.line;
      if (el.tagName === undefined || linea === undefined) continue;
      el.properties = el.properties ?? {};
      el.properties.dataLinea = String(linea + offsetDeLineas);
    }
  };
}

/**
 * La cadena de plugins, en UNA sola definición. Se instancia dos veces porque
 * el marcado de líneas solo lo quiere la vista de lectura: en una exportación a
 * PDF o en una tarjeta de canvas esos atributos serían ruido.
 */
function crearProcesador(conLineas: boolean) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkMicelio)
    .use(remarkCallouts)
    .use(remarkEmphasisStyle)
    .use(remarkRehype)
    .use(rehypeTaskCheckbox)
    .use(rehypeLineas, { activo: conLineas })
    // mermaid/excalidraw se renderizan aparte (HU-18/HU-16); no resaltarlos
    .use(rehypeHighlight, { plainText: ["mermaid", "excalidraw"] })
    .use(rehypeKatex)
    .use(rehypeStringify);
}

const processor = crearProcesador(false);
const processorConLineas = crearProcesador(true);

/** Markdown → HTML. 100% en cliente, sin llamadas al servidor (HU-01 CA10). */
export function renderMarkdown(markdown: string): string {
  return String(processor.processSync(markdown));
}

// ── Tarjeta de propiedades (FUN-M-04) ────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const escapar = (s: string): string => s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);

/**
 * Renderiza un valor como markdown EN LÍNEA (sin el `<p>` envolvente): así un
 * `[[enlace]]` dentro de una propiedad —o de una celda de tabla (`FUN-L-19`)—
 * se ve y navega como cualquier wikilink. El pipeline escapa el HTML, así que
 * el valor del usuario no puede inyectar.
 */
export function renderMarkdownEnLinea(md: string): string {
  return renderEnLinea(md);
}

function renderEnLinea(md: string): string {
  return renderMarkdown(md)
    .replace(/^\s*<p>/, "")
    .replace(/<\/p>\s*$/, "");
}

/** Glifo del tipo, para reconocer la propiedad de un vistazo. */
export const ICONO_TIPO: Record<TipoPropiedad, string> = {
  texto: "T",
  numero: "#",
  casilla: "☑",
  fecha: "▤",
  fechaHora: "◷",
  lista: "≡",
};

/**
 * Fecha/hora en formato local. Se construye por componentes a propósito: pasar
 * `2026-08-30` a `new Date()` la interpreta como UTC y en husos negativos se
 * muestra el día ANTERIOR.
 */
export function formatearFecha(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(valor);
  if (!m) return valor;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? "0"),
    Number(m[5] ?? "0"),
  );
  if (Number.isNaN(d.getTime())) return valor;
  return m[4] === undefined
    ? d.toLocaleDateString(undefined, { dateStyle: "medium" })
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * El valor de una propiedad como HTML, según su tipo. Lo usan la tarjeta de
 * lectura y el widget editable de la vista en vivo (`FUN-M-19`): el valor se ve
 * IGUAL en los dos sitios mientras no se lo está editando.
 */
export function valorPropiedadHtml(p: Propiedad): string {
  if (p.tipo === "casilla") {
    const marcado = p.valor === true ? " checked" : "";
    return `<input type="checkbox" class="mic-prop-check" disabled${marcado} aria-label="${escapar(p.clave)}">`;
  }
  if (p.tipo === "fecha" || p.tipo === "fechaHora") {
    return `<span class="mic-prop-fecha">${escapar(formatearFecha(String(p.valor)))}</span>`;
  }
  if (p.tipo === "lista") {
    const items = Array.isArray(p.valor) ? p.valor : [String(p.valor)];
    if (items.length === 0) return '<span class="mic-prop-vacio">—</span>';
    // Las etiquetas usan la píldora que ya existe y el href `#tag:`, que el
    // workspace intercepta igual que un `#tag` del cuerpo.
    if (p.clave.toLowerCase() === "tags") {
      return items
        .map(
          (t) =>
            `<a class="mic-tag-pill" href="#tag:${encodeURIComponent(t)}">#${escapar(t)}</a>`,
        )
        .join(" ");
    }
    return items.map((v) => `<span class="mic-prop-pill">${renderEnLinea(v)}</span>`).join(" ");
  }
  if (p.tipo === "numero") return `<span class="mic-prop-numero">${escapar(String(p.valor))}</span>`;
  const texto = String(p.valor);
  if (texto === "") return '<span class="mic-prop-vacio">—</span>';
  return renderEnLinea(texto);
}

/**
 * Tarjeta de propiedades que reemplaza al frontmatter en la vista de lectura y
 * en el widget de la vista en vivo. Cadena vacía si la nota no tiene bloque: no
 * debe quedar ni un hueco.
 *
 * Un bloque que Mycelium no interpreta se muestra CRUDO con su aviso — nunca se
 * reescribe ni se adivina: es preferible no tocar los metadatos de alguien antes
 * que reformatearlos mal.
 */
export function tarjetaPropiedadesHtml(texto: string): string {
  const fm = separarFrontmatter(texto);
  if (!fm.hay) return "";

  if (!fm.soportado) {
    return (
      '<div class="mic-props mic-props-nosop">' +
      `<p class="mic-props-aviso">Mycelium no interpreta este frontmatter: ${escapar(fm.motivo)}.</p>` +
      `<pre class="mic-props-crudo"><code>${escapar(fm.crudo)}</code></pre>` +
      "</div>"
    );
  }
  if (fm.props.length === 0) return "";

  const filas = fm.props
    .map(
      (p) =>
        '<div class="mic-prop" data-tipo="' +
        p.tipo +
        '"><span class="mic-prop-clave"><span class="mic-prop-icono" aria-hidden="true">' +
        ICONO_TIPO[p.tipo] +
        "</span>" +
        escapar(p.clave) +
        '</span><span class="mic-prop-valor">' +
        valorPropiedadHtml(p) +
        "</span></div>",
    )
    .join("");
  return `<div class="mic-props">${filas}</div>`;
}

/**
 * Nota completa → HTML: tarjeta de propiedades + markdown del CUERPO. Es lo que
 * deben usar la vista de lectura/dividida, el visor de la barra lateral, el
 * preview vinculado y la exportación a PDF; `renderMarkdown` a secas queda para
 * fragmentos que no son una nota entera (una tabla, un ejemplo de estilos).
 *
 * Pasarle el cuerpo y no el texto completo es lo que hace desaparecer la regla
 * horizontal del primer `---` y el `<h2>` fantasma que generaba el segundo.
 */
export function renderNota(texto: string, conLineas = false): string {
  const fm = separarFrontmatter(texto);
  const cuerpo = cuerpoDe(texto, fm);
  if (!conLineas) return tarjetaPropiedadesHtml(texto) + renderMarkdown(cuerpo);

  // `DEF-055`: los bloques salen marcados con su línea del DOCUMENTO, no del
  // cuerpo, para que el editor pueda buscarlas tal como las numera él.
  offsetDeLineas = fm.cuerpoDesde;
  try {
    return tarjetaPropiedadesHtml(texto) + String(processorConLineas.processSync(cuerpo));
  } finally {
    offsetDeLineas = 0;
  }
}
