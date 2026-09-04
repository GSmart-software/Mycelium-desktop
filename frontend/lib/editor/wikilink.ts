import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { TreeCarpeta, TreeNota } from "@/stores/vaultStore";
import { useVaultStore } from "@/stores/vaultStore";
import { partirWikilink } from "@/lib/wikilinks";

/**
 * Wikilinks estilo Obsidian: `[[archivo]]`, `[[archivo|alias]]` y
 * desambiguación por ruta de carpeta `[[Carpeta/Sub/archivo]]`.
 *
 * - `parseWikilinkTarget`: separa destino (antes de `|`) del texto a mostrar.
 * - `resolveWikilink`: resuelve una referencia (con o sin ruta) a una nota.
 * - `wikilinkCompletions`: fuente de autocompletado al escribir dentro de `[[`.
 */

/** Segmentos de carpeta (raíz→hoja) que contienen a una nota. */
export function folderSegments(
  carpetaId: string | null,
  carpetas: TreeCarpeta[],
): string[] {
  const segs: string[] = [];
  const seen = new Set<string>();
  let id = carpetaId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const c = carpetas.find((x) => x.id === id);
    if (!c) break;
    segs.unshift(c.nombre);
    id = c.padreId;
  }
  return segs;
}

/**
 * Separa `destino|alias` → `{ target, label }` (alias opcional).
 *
 * Delega en `lib/wikilinks.ts` para que la barra escapada de las tablas
 * (`[[Destino\|alias]]`, `DEF-045`) se entienda igual acá que en el grafo, la
 * vista en vivo y la de lectura.
 */
export function parseWikilinkTarget(inner: string): { target: string; label: string } {
  const { destino, etiqueta } = partirWikilink(inner);
  return { target: destino, label: etiqueta };
}

/**
 * Resuelve una referencia de wikilink a una nota. Acepta solo el título
 * (`archivo`) o una ruta parcial (`Carpeta/archivo`) para desambiguar cuando
 * hay varios archivos con el mismo nombre. Ante empate sin pista de ruta,
 * elige el de ruta más corta (más cercano a la raíz), como Obsidian.
 */
export function resolveWikilink(
  ref: string,
  notas: TreeNota[],
  carpetas: TreeCarpeta[],
): TreeNota | undefined {
  const parts = ref
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  const title = parts[parts.length - 1].toLowerCase();
  const hint = parts.slice(0, -1).map((s) => s.toLowerCase());

  let matches = notas.filter((n) => n.titulo.toLowerCase() === title);
  // Las referencias a archivos llevan extensión (`archivo.excalidraw`), pero el
  // título de la nota no la incluye: si no hubo match exacto, se prueba sin la
  // extensión para que el enlace/embed resuelva y no se estile como inexistente.
  if (matches.length === 0) {
    const stripped = title.replace(/\.(excalidraw|md)$/, "");
    if (stripped !== title) matches = notas.filter((n) => n.titulo.toLowerCase() === stripped);
  }
  if (matches.length === 0) return undefined;

  const byDepth = (a: TreeNota, b: TreeNota) =>
    folderSegments(a.carpetaId, carpetas).length -
    folderSegments(b.carpetaId, carpetas).length;

  if (matches.length === 1 || hint.length === 0) {
    return [...matches].sort(byDepth)[0];
  }

  // Desambiguar: la ruta de la nota debe terminar con los segmentos de la pista.
  const matchHint = matches.filter((n) => {
    const segs = folderSegments(n.carpetaId, carpetas).map((s) => s.toLowerCase());
    if (hint.length > segs.length) return false;
    return hint.every((h, i) => segs[segs.length - hint.length + i] === h);
  });
  const pool = matchHint.length > 0 ? matchHint : matches;
  return [...pool].sort(byDepth)[0];
}

/**
 * Marca los wikilinks de un preview ya renderizado cuyo destino no existe en el
 * vault, añadiendo la clase `mic-wikilink-missing` (feedback visual: mismo color
 * más oscuro). Se ejecuta sobre el DOM para no acoplar el render de markdown al
 * estado del vault (se reutiliza en PDF/CSS de ejemplo).
 */
export function markMissingWikilinks(
  root: HTMLElement,
  notas: TreeNota[],
  carpetas: TreeCarpeta[],
): void {
  root.querySelectorAll<HTMLAnchorElement>("a.mic-wikilink").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith("#wikilink:")) return;
    const target = decodeURIComponent(href.slice("#wikilink:".length));
    const exists = resolveWikilink(target, notas, carpetas) !== undefined;
    a.classList.toggle("mic-wikilink-missing", !exists);
  });
}

/**
 * Fuente de autocompletado para CodeMirror: se dispara mientras se escribe
 * dentro de `[[…`. Sugiere los títulos del vault; si un título se repite,
 * inserta la ruta de carpeta (`Carpeta/Sub/título`) para referenciar el correcto.
 */
export function wikilinkCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\[\[([^[\]\n]*)$/);
  if (!before) return null;

  const typed = before.text.slice(2); // texto tras los `[[`
  if (typed.includes("|")) return null; // ya está escribiendo el alias

  const from = before.from + 2;
  const query = typed.toLowerCase();

  const { notas, carpetas } = useVaultStore.getState();

  // Conteo de títulos para detectar ambigüedad.
  const counts = new Map<string, number>();
  for (const n of notas) {
    const k = n.titulo.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const options = notas
    .map((n) => {
      const segs = folderSegments(n.carpetaId, carpetas);
      const ambiguous = (counts.get(n.titulo.toLowerCase()) ?? 0) > 1;
      const path = segs.length > 0 ? `${segs.join("/")}/${n.titulo}` : n.titulo;
      // Las ambiguas se insertan con ruta para que resuelvan de forma única.
      const insert = ambiguous ? path : n.titulo;
      return { titulo: n.titulo, segs, path, insert };
    })
    .filter((o) => {
      if (!query) return true;
      return (
        o.titulo.toLowerCase().includes(query) || o.path.toLowerCase().includes(query)
      );
    })
    .slice(0, 50)
    .map((o) => ({
      label: o.insert,
      detail: o.segs.length > 0 ? o.segs.join("/") : undefined,
      type: "text",
      apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
        const hasClose = view.state.sliceDoc(applyTo, applyTo + 2) === "]]";
        const insert = hasClose ? o.insert : `${o.insert}]]`;
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert },
          // Cursor tras el `]]` de cierre.
          selection: { anchor: applyFrom + o.insert.length + 2 },
        });
      },
    }));

  if (options.length === 0) return null;
  return { from, to: before.to, options, filter: false };
}
