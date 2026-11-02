import type { StateEffectType } from "@codemirror/state";
import { getAllViews } from "@/lib/editor/viewRegistry";

/**
 * El «refrescá el live preview» vive aparte de `livePreview.ts` (`FUN-M-58`,
 * C-H3 de la auditoría de eficiencia del 2026-11-01): lo llaman los stores
 * (`vaultStore`) y los módulos del vault, que cargan desde `/` y el selector de
 * vaults. Importarlo de `livePreview` arrastraba CodeMirror entero, KaTeX y
 * unified/highlight.js a esas rutas: 1,29 MB de JS para una pantalla que no
 * edita nada (con este módulo, ~210 KB).
 *
 * Ni siquiera importa `@codemirror/state` (45 KB): el efecto lo define
 * `livePreview` y lo registra acá al cargarse. Antes de eso no hay ningún
 * editor con live preview que refrescar, así que basta con avanzar la
 * generación.
 */

let efectoRefresco: StateEffectType<null> | null = null;

/** Lo llama `livePreview` al cargarse, con su `refreshLiveEffect`. */
export function registrarEfectoRefresco(efecto: StateEffectType<null>) {
  efectoRefresco = efecto;
}

// Generación de los embeds excalidraw en vivo: aumenta en cada refresh para que
// los widgets se vuelvan a renderizar (su eq() la incluye) tras guardar un dibujo.
let liveGen = 0;

/** La generación vigente del live preview (ver `liveGen`). */
export function generacionViva(): number {
  return liveGen;
}

/** Redispara el live preview en todos los editores abiertos. */
export function refreshAllLiveViews() {
  liveGen++;
  const efecto = efectoRefresco;
  if (!efecto) return;
  for (const view of getAllViews()) {
    view.dispatch({ effects: efecto.of(null) });
  }
}
