import { create } from "zustand";
import type { SyncState } from "@/components/editor/EditorToolbar";

/**
 * Estado de sync por nota (HU-04 CA3): lo escribe el motor de autoguardado
 * del editor y lo leen el dot de las pestañas y la barra de estado.
 *
 * La barra de estado (rediseño del cascarón, 2026-09-19) lee además la hora
 * del último guardado y las palabras de la nota, que también publica el editor.
 */
type SyncStoreState = {
  byNota: Record<string, SyncState>;
  /**
   * Momento (ms) del último guardado de la nota EN ESTA SESIÓN. Solo cuenta el
   * paso «sincronizando → guardado»: abrir la nota también la deja en
   * `synced`, y mostrar esa hora como «guardado» sería mentir.
   */
  guardadoEn: Record<string, number>;
  palabras: Record<string, number>;
  setSyncState: (notaId: string, state: SyncState) => void;
  setPalabras: (notaId: string, n: number) => void;
};

export const useSyncStore = create<SyncStoreState>((set) => ({
  byNota: {},
  guardadoEn: {},
  palabras: {},
  setSyncState: (notaId, state) =>
    set((s) => ({
      byNota: { ...s.byNota, [notaId]: state },
      ...(state === "synced" && s.byNota[notaId] === "syncing"
        ? { guardadoEn: { ...s.guardadoEn, [notaId]: Date.now() } }
        : {}),
    })),
  setPalabras: (notaId, n) =>
    set((s) => (s.palabras[notaId] === n ? s : { palabras: { ...s.palabras, [notaId]: n } })),
}));

/**
 * Palabras de una nota como las contaría quien la lee: sin el frontmatter ni
 * los signos de Markdown, las palabras de `[[Enlace|alias]]` cuentan una vez.
 */
export function contarPalabras(md: string): number {
  const cuerpo = md
    .replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/[#>*_`~[\]()|=-]+/g, " ");
  return cuerpo.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)?.length ?? 0;
}
