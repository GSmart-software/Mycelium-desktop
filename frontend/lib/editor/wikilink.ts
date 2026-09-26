import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { TreeCarpeta, TreeNota } from "@/stores/vaultStore";
import { useVaultStore } from "@/stores/vaultStore";
import { folderSegments, notasPorTitulo, resolveWikilink } from "@/lib/wikilinks";

/**
 * Wikilinks estilo Obsidian en el editor: `[[archivo]]`, `[[archivo|alias]]` y
 * desambiguación por ruta de carpeta `[[Carpeta/Sub/archivo]]`.
 *
 * - `resolveWikilink`: resuelve una referencia (con o sin ruta) a una nota. Vive
 *   en `lib/wikilinks.ts` desde `FUN-M-40` (D8) —es la MISMA regla que usa el
 *   grafo— y se reexporta acá para los consumidores de siempre.
 * - `markMissingWikilinks`: oscurece en un preview los enlaces que no resuelven.
 * - `wikilinkCompletions`: fuente de autocompletado al escribir dentro de `[[`.
 */
export { folderSegments, resolveWikilink };

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

  // Títulos repetidos (ambiguos), del mismo índice que usa `resolveWikilink`.
  const porTitulo = notasPorTitulo(notas);

  const options = notas
    .map((n) => {
      const segs = folderSegments(n.carpetaId, carpetas);
      const ambiguous = (porTitulo.get(n.titulo.toLowerCase())?.length ?? 0) > 1;
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
