/**
 * Qué dibuja un `![[embed]]` (`FUN-S-18`). Módulo **puro**: recibe las notas y
 * las carpetas por parámetro, para que `scripts/test-embeds.mjs` lo pruebe sin
 * arrancar la app. Lo que toca el DOM y el store vive en `lib/embedsRender.ts`.
 *
 * > [!important] Primero el destino, después el tipo
 * > Hasta `FUN-S-18` el reconocedor decidía **por la extensión escrita**: un
 * > `![[x.excalidraw]]` lo dibujaba Excalidraw, un `![[x.drawio]]` draw.io, y un
 * > `![[Mi diagrama]]` —la forma de Obsidian— quedaba como un enlace. Ahora el
 * > embed se resuelve por título, con la MISMA regla que los `[[enlaces]]` y el
 * > grafo (`resolverReferencia`), y se mira el tipo del archivo encontrado.
 * >
 * > El desempate entre homónimos es el del resolutor: la nota markdown gana
 * > (y como el embed de notas, `FUN-M-37`, no existe, sigue siendo un enlace);
 * > entre los demás, `PRIORIDAD_SIN_EXTENSION` (dibujo, diagrama, lienzo,
 * > tabla). Con la extensión escrita gana siempre lo que se escribió.
 */

import type { NotaTipo } from "@/stores/vaultStore";
import { EXTENSION_POR_TIPO, tipoDeExtension } from "@/lib/extensionesDeTipo";
import {
  partirWikilink,
  resolverReferencia,
  type CarpetaEnlazable,
  type NotaEnlazable,
} from "@/lib/wikilinks";

/** Los tipos que un embed sabe dibujar dentro de una nota. */
export const TIPOS_EMBEBIBLES = ["excalidraw", "drawio", "canvas", "base"] as const satisfies readonly NotaTipo[];
export type TipoEmbebible = (typeof TIPOS_EMBEBIBLES)[number];

const esEmbebible = (tipo: string): tipo is TipoEmbebible =>
  (TIPOS_EMBEBIBLES as readonly string[]).includes(tipo);

/** Un embed resuelto a un archivo que se sabe dibujar. */
export type Embebido<N extends NotaEnlazable = NotaEnlazable> = {
  tipo: TipoEmbebible;
  nota: N;
  /**
   * La referencia CON la extensión del tipo encontrado (`Carpeta/Plano.drawio`):
   * es lo que reciben los que dibujan, que vuelven a resolver y exigen ese tipo.
   * Sin la extensión, su resolución preferiría una nota homónima.
   */
  ref: string;
  /** Lo que sigue al `#` (`![[tabla.base#Vista]]`), o `null`. */
  ancla: string | null;
};

/**
 * A qué archivo dibujable apunta lo que va entre `![[` y `]]`, o `null` si no
 * resuelve, si resuelve a una nota markdown o a un tipo que no se embebe. El
 * alias (`|…`) no participa.
 */
export function embebidoDe<N extends NotaEnlazable>(
  inner: string,
  notas: readonly N[],
  carpetas: readonly CarpetaEnlazable[],
): Embebido<N> | null {
  const { destino } = partirWikilink(inner);
  if (destino === "") return null;
  const r = resolverReferencia(destino, notas, carpetas);
  if (!r.nota || !esEmbebible(r.nota.tipo)) return null;
  const tipo = r.nota.tipo;
  const ext = EXTENSION_POR_TIPO[tipo];
  const ref = tipoDeExtension(r.base) === tipo ? r.base : `${r.base}.${ext}`;
  return { tipo, nota: r.nota, ref, ancla: r.ancla };
}
