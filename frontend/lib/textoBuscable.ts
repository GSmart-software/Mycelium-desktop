/**
 * El texto que una nota aporta a la búsqueda (`DEF-148`): lo que va a
 * `notas_fts` y de donde sale el **fragmento** de cada resultado.
 *
 * Se separa en dos partes:
 *
 * - `visible`: el texto **como se lee**. Es la columna `contenido` de
 *   `notas_fts`, y el `snippet()` del resultado sale de acá. Un `[[Pulgón|pulgones]]`
 *   es «pulgones», un `**énfasis**` es «énfasis», una fila de tabla es sus
 *   celdas; un canvas es el texto de sus tarjetas, no su JSON.
 * - `oculto`: lo que tiene que **encontrarse** pero no se ve en el texto: el
 *   destino de un enlace con alias («Pulgón»), la URL de un enlace markdown, la
 *   ruta de una tarjeta de nota. Va a la columna `extra`, que se busca igual que
 *   el contenido pero de la que el fragmento sale solo si la coincidencia está
 *   únicamente ahí.
 *
 * Antes se indexaba el texto crudo y el fragmento mostraba la sintaxis tal cual
 * —`[[Tomate]] + [[Albahaca]]`, `| |---|---|`, y en un canvas el JSON con `\n`
 * literales—. Limpiar al indexar, y no al pintar, es lo que permite que el
 * `snippet()` de FTS5 corte y resalte sobre el texto ya limpio: limpiar el
 * fragmento después no sabría qué hacer con un `…Pulgón|pulgones]]` cortado a
 * la mitad.
 *
 * La limpieza es **para leer**, no un parser de markdown: lo razonable para que
 * diez palabras de contexto se entiendan. Las palabras no cambian —el
 * tokenizador ya ignoraba `[`, `*`, `|` y compañía—, así que buscar sigue
 * encontrando lo mismo; lo que se saca del texto visible pasa a `oculto`.
 *
 * El salto a la coincidencia al abrir un resultado NO depende de esto: busca el
 * término de la consulta en el texto real de la nota (`firstSearchTerm`).
 *
 * > OJO: módulo puro (solo importa `lib/canvas.ts`, también puro): lo
 * > transpilan sin build `scripts/test-texto-buscable.mjs` y los tests del
 * > índice.
 */
import { parsearCanvas } from "@/lib/canvas";

export type TextoBuscable = { visible: string; oculto: string[] };

/**
 * `[[destino#ancla|alias]]` y `![[…]]`. El separador del alias puede venir
 * escapado (`\|`): así se escribe dentro de una tabla (`DEF-045`). Copia local
 * de la regla de `lib/wikilinks.ts` a propósito: este módulo es puro.
 */
const RE_WIKILINK = /!?\[\[([^\]\n]+?)\]\]/g;

/** `[texto](url)` y `![alt](url)`. */
const RE_ENLACE_MD = /!?\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Fila separadora de una tabla: `|---|:--:|`. */
const RE_SEPARADOR_TABLA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * Markdown → texto legible. `oculto` recibe lo que deja de verse pero tiene que
 * seguir encontrándose.
 */
export function markdownLegible(md: string, oculto: string[] = []): string {
  const lineas: string[] = [];
  let enBloqueCodigo = false;
  for (const cruda of md.split(/\r?\n/)) {
    // Las vallas de un bloque de código no son texto; su contenido sí, tal cual.
    if (/^\s*(```|~~~)/.test(cruda)) {
      enBloqueCodigo = !enBloqueCodigo;
      continue;
    }
    if (enBloqueCodigo) {
      lineas.push(cruda);
      continue;
    }
    if (RE_SEPARADOR_TABLA.test(cruda)) continue;
    // Una regla horizontal (`---`, `***`, `___`) no dice nada.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(cruda)) continue;
    lineas.push(lineaLegible(cruda, oculto));
  }
  return lineas.join("\n");
}

function lineaLegible(linea: string, oculto: string[]): string {
  let l = linea;

  // Enlaces primero: su `|` de alias no es el de una celda de tabla.
  l = l.replace(RE_WIKILINK, (_m, interior: string) => {
    const [destino, ...resto] = interior.split(/\\?\|/);
    const alias = resto.join("|").trim();
    const d = destino.trim();
    if (alias !== "") {
      if (d !== "") oculto.push(d);
      return alias;
    }
    // `[[Nota#Encabezado]]` se lee «Nota › Encabezado»; `[[#Encabezado]]`, solo
    // el encabezado.
    const [nota, ...ancla] = d.split("#");
    const partes = [nota.trim(), ...ancla.map((a) => a.replace(/^\^/, "").trim())].filter((p) => p !== "");
    return partes.join(" › ");
  });
  l = l.replace(RE_ENLACE_MD, (_m, texto: string, url: string) => {
    oculto.push(url);
    return texto;
  });

  // Prefijos de bloque: cita/callout, encabezado, elemento de lista, tarea.
  l = l.replace(/^(\s*>\s?)+/, "");
  l = l.replace(/^\s*\[![^\]]*\][-+]?\s*/, "");
  l = l.replace(/^\s*#{1,6}\s+/, "");
  l = l.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "");

  // Celdas de tabla: los bordes se van, los separadores internos quedan como un
  // punto medio para que dos celdas no se lean como una frase.
  if (/^\s*\|.*\|\s*$/.test(l)) {
    l = l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim())
      .filter((c) => c !== "")
      .join(" · ");
  }

  // Énfasis, tachado, resaltado y código en línea. Un `_` dentro de una palabra
  // (`snake_case`) no es énfasis: solo se quitan los que bordean una palabra.
  l = l.replace(/(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\1/g, "$2");
  l = l.replace(/(^|[^\p{L}\p{N}*])\*(?=\S)(.+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, "$1$2");
  l = l.replace(/(^|[^\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "$1$2");
  l = l.replace(/`([^`]+)`/g, "$1");
  // Etiquetas HTML sueltas (`<br>`, `<span …>`): su texto queda, la marca no.
  l = l.replace(/<\/?[A-Za-z][^>]*>/g, " ");

  return l;
}

/** Canvas: el texto de las tarjetas, las etiquetas de grupos y flechas. */
function canvasLegible(json: string, oculto: string[]): string | null {
  let canvas;
  try {
    canvas = parsearCanvas(json);
  } catch {
    return null;
  }
  const partes: string[] = [];
  for (const n of canvas.nodos) {
    if (n.tipo === "text" && n.texto) partes.push(markdownLegible(n.texto, oculto));
    else if (n.tipo === "group" && n.etiqueta) partes.push(n.etiqueta);
    else if (n.tipo === "file" && n.archivo) {
      // La tarjeta muestra el título de la nota; la ruta, a lo oculto.
      const nombre = n.archivo.slice(n.archivo.lastIndexOf("/") + 1).replace(/\.md$/i, "");
      partes.push(nombre);
      oculto.push(n.archivo);
    } else if (n.tipo === "link" && n.url) oculto.push(n.url);
  }
  for (const a of canvas.aristas) if (a.etiqueta) partes.push(a.etiqueta);
  return partes.filter((p) => p.trim() !== "").join("\n");
}

/** Excalidraw: el texto de sus elementos de texto (sin las imágenes en base64). */
function excalidrawLegible(json: string, oculto: string[]): string | null {
  let raiz: unknown;
  try {
    raiz = JSON.parse(json);
  } catch {
    return null;
  }
  const elementos = (raiz as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elementos)) return null;
  const partes: string[] = [];
  for (const e of elementos) {
    if (typeof e !== "object" || e === null) continue;
    const el = e as Record<string, unknown>;
    if (el.isDeleted === true) continue;
    const texto = typeof el.originalText === "string" ? el.originalText : el.text;
    if (el.type === "text" && typeof texto === "string" && texto.trim() !== "") partes.push(texto);
    if (typeof el.link === "string" && el.link !== "") oculto.push(el.link);
  }
  return partes.join("\n");
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodifica las entidades XML/HTML más comunes y las numéricas. */
function desentidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/**
 * draw.io: los rótulos de las figuras (`value`/`label` de cada celda), que
 * pueden traer HTML escapado. Un diagrama **comprimido** (el `<diagram>` en
 * base64) no tiene rótulos legibles sin descomprimir: aporta texto vacío, que
 * es mejor que indexar base64.
 */
function drawioLegible(xml: string): string | null {
  if (!/<mxfile|<mxGraphModel/i.test(xml)) return null;
  const partes: string[] = [];
  for (const m of xml.matchAll(/\s(?:value|label)="([^"]*)"/g)) {
    // Dos pasadas: el atributo XML trae HTML escapado (`&lt;b&gt;`).
    const html = desentidades(m[1]);
    const texto = desentidades(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
      .replace(/[ \t]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .trim();
    if (texto !== "") partes.push(texto);
  }
  return partes.join("\n");
}

/**
 * El texto buscable de un archivo indexado según su tipo. El frontmatter de una
 * nota markdown NO pasa por acá: lo separa antes `derivarIndice`.
 *
 * Un formato que no se entiende (JSON roto, un `.drawio` que no es XML) se
 * indexa crudo, como antes: es mejor un fragmento feo que una nota que no se
 * encuentra.
 */
export function textoBuscable(texto: string, tipo: string): TextoBuscable {
  const oculto: string[] = [];
  let visible: string | null;
  switch (tipo) {
    case "markdown":
      visible = markdownLegible(texto, oculto);
      break;
    case "canvas":
      visible = canvasLegible(texto, oculto);
      break;
    case "excalidraw":
      visible = excalidrawLegible(texto, oculto);
      break;
    case "drawio":
      visible = drawioLegible(texto);
      break;
    default:
      // `.base`: es la definición de una consulta en YAML, corta y legible.
      visible = texto;
  }
  if (visible === null) return { visible: texto, oculto: [] };
  return { visible, oculto };
}
