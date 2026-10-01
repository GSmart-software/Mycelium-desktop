/**
 * Cómo se parte un `[[wikilink]]` en destino y alias, y a qué nota apunta. Módulo
 * **puro** a propósito: lo consumen tanto la capa de datos (`lib/db/grafo.ts`)
 * como el editor, y `scripts/test-wikilinks.mjs` lo transpila e importa sin
 * build, igual que `lib/frontmatter.ts` o `lib/bases.ts`. Su único import es
 * `lib/extensionesDeTipo`, que también es puro (solo importa un tipo).
 *
 * > [!important] La barra del alias puede venir escapada (`DEF-045`)
 * > Dentro de una tabla, la barra vertical **separa celdas**, así que
 * > `[[Destino|alias]]` parte la fila donde no debe. La única forma de escribir
 * > un alias ahí es escaparla: `[[Destino\|alias]]` — es también lo que hace
 * > Obsidian.
 * >
 * > Pero entonces hay dos textos distintos según quién mire:
 * >
 * > | Quién | Qué ve |
 * > |---|---|
 * > | La vista de **lectura** | `Destino|alias` — el pipeline de Markdown ya resolvió el escape |
 * > | El **grafo**, la **navegación** y la **vista en vivo** | `Destino\|alias` — leen el archivo crudo |
 * >
 * > Partiendo por el primer `|`, los segundos sacaban el destino `Destino\` y no
 * > encontraban la nota. Lo peligroso era que en lectura se veía **bien**: el
 * > enlace parecía correcto y la conexión no existía, en silencio.
 * >
 * > Por eso el separador es `\|` **o** `|`: las dos formas son el mismo enlace.
 */

import { sinExtensionDeNota, tipoDeExtension } from "@/lib/extensionesDeTipo";

/**
 * El separador entre destino y alias. La barra invertida es opcional porque
 * dentro de una tabla es obligatoria y fuera no se usa: los dos casos tienen
 * que dar el mismo destino.
 */
const SEPARADOR_ALIAS = /\\?\|/;

/** Un `[[wikilink]]` ya partido. `inner` es lo que va ENTRE los corchetes. */
export type WikilinkPartido = {
  /**
   * El destino, sin el alias y sin espacios. Conserva el ancla (`#sección`,
   * `^bloque`) y la ruta (`Carpeta/Nota`) si las traía: quitarlas es cosa de
   * quien resuelve, no de quien parte.
   */
  destino: string;
  /** Lo que se muestra: el alias si lo hay, y si no el propio destino. */
  etiqueta: string;
  /**
   * Índice DENTRO de `inner` donde empieza la etiqueta, para que la vista en
   * vivo sepa hasta dónde ocultar. Vale `0` cuando no hay alias. Con la barra
   * escapada son **dos** caracteres los que hay que saltar, no uno.
   */
  desdeEtiqueta: number;
};

/** Parte `destino|alias` (o `destino\|alias`) en sus dos mitades. */
export function partirWikilink(inner: string): WikilinkPartido {
  const sep = SEPARADOR_ALIAS.exec(inner);
  if (sep === null) {
    const destino = inner.trim();
    return { destino, etiqueta: destino, desdeEtiqueta: 0 };
  }
  const desdeEtiqueta = sep.index + sep[0].length;
  const destino = inner.slice(0, sep.index).trim();
  const alias = inner.slice(desdeEtiqueta).trim();
  return { destino, etiqueta: alias === "" ? destino : alias, desdeEtiqueta };
}

/**
 * Embed de un dibujo de Excalidraw: `![[ref.excalidraw]]`. El grupo 1 es la
 * referencia **sin** la extensión (`Carpeta/Dibujo`), que es lo que resuelve
 * `resolveWikilink` contra los títulos del vault.
 *
 * Vive una sola vez acá (`FUN-M-40`, D6): la vista de lectura, la vista en vivo
 * y la exportación la llevaban copiada, y la de la exportación solo aceptaba un
 * uuid —el embed del mecanismo «embebido», ya retirado—.
 *
 * > [!warning] Es global (`/g`): usarla solo con `matchAll`
 * > `matchAll` trabaja sobre una copia y no toca su `lastIndex`; `exec` o `test`
 * > sí lo harían, y dos consumidores se pisarían.
 */
export const EXCALIDRAW_RE = /!\[\[([^[\]]+)\.excalidraw\]\]/g;

// ── A qué nota apunta un enlace (`FUN-M-40`, D8) ──────────────────────────────
//
// > [!important] Una sola regla para el editor y para el grafo
// > Hasta `FUN-M-40` había dos: el editor (clic, embeds, autocompletado) usaba
// > esta —pista de carpeta, sin extensión, empate a la ruta más corta— y el
// > grafo, las conexiones y los retroenlaces usaban «la primera nota con ese
// > título» en el orden de la consulta, sin pista ni extensión. Con dos notas
// > homónimas el clic iba a una y el grafo dibujaba la arista a otra;
// > `![[x.excalidraw]]` resolvía en el editor y no en el grafo; y renombrar
// > —que reescribe los enlaces entrantes a partir de las conexiones— podía
// > reescribir la nota equivocada. Ahora las dos puntas llaman a esta.

/**
 * Lo mínimo de una nota para resolver un enlace hacia ella. El `tipo` (`DEF-120`)
 * es el de `NotaTipo` (`markdown`, `excalidraw`…): con él, `![[x.excalidraw]]`
 * busca solo entre dibujos y `[[x]]` prefiere la nota `.md`.
 */
export type NotaEnlazable = { id: string; titulo: string; carpetaId: string | null; tipo: string };
/** Lo mínimo de una carpeta para leer la ruta de una nota. */
export type CarpetaEnlazable = { id: string; nombre: string; padreId: string | null };

/**
 * Carpetas por id, calculado una vez por lista de carpetas. Misma idea que el
 * índice por título de abajo: la lista del store no se muta, así que sirve de
 * clave y el índice se libera con ella.
 */
const carpetasPorId = new WeakMap<readonly CarpetaEnlazable[], Map<string, CarpetaEnlazable>>();

/** Segmentos de carpeta (raíz→hoja) que contienen a una nota. */
export function folderSegments(
  carpetaId: string | null,
  carpetas: readonly CarpetaEnlazable[],
): string[] {
  let porId = carpetasPorId.get(carpetas);
  if (!porId) {
    porId = new Map(carpetas.map((c) => [c.id, c]));
    carpetasPorId.set(carpetas, porId);
  }
  const segs: string[] = [];
  const seen = new Set<string>();
  let id = carpetaId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const c = porId.get(id);
    if (!c) break;
    segs.unshift(c.nombre);
    id = c.padreId;
  }
  return segs;
}

/**
 * Notas agrupadas por título en minúsculas: el índice sobre el que se resuelve.
 * Quien resuelve muchos enlaces contra la misma lista —el grafo, una vez por
 * arista— lo arma una vez y llama a `resolveWikilinkEnIndice`.
 */
export function indexarPorTitulo<N extends NotaEnlazable>(notas: readonly N[]): Map<string, N[]> {
  const indice = new Map<string, N[]>();
  for (const n of notas) {
    const clave = n.titulo.toLowerCase();
    const lista = indice.get(clave);
    if (lista) lista.push(n);
    else indice.set(clave, [n]);
  }
  return indice;
}

/**
 * El índice por título de una lista, calculado una vez por lista (`FUN-M-38`,
 * hallazgo H6). `resolveWikilink` se llama por cada `[[enlace]]` visible en
 * cada tecla, y recorrer las notas con `toLowerCase()` costaba 0,34 ms por
 * llamada en un vault de 1.300 notas: con cien enlaces a la vista, 34 ms por
 * tecla solo en resolver. La clave es la lista misma —el store crea una nueva
 * en cada recarga y nunca la muta—, así que el índice se rehace solo cuando
 * cambian las notas y se libera con ellas (`WeakMap`).
 */
const indicePorLista = new WeakMap<readonly NotaEnlazable[], Map<string, NotaEnlazable[]>>();

export function notasPorTitulo<N extends NotaEnlazable>(notas: readonly N[]): Map<string, N[]> {
  let indice = indicePorLista.get(notas) as Map<string, N[]> | undefined;
  if (!indice) {
    indice = indexarPorTitulo(notas);
    indicePorLista.set(notas, indice);
  }
  return indice;
}

/**
 * Resuelve una referencia de wikilink contra un índice por título. Acepta solo
 * el título (`archivo`) o una ruta parcial (`Carpeta/archivo`) para desambiguar
 * cuando hay varios archivos con el mismo nombre. Ante empate sin pista de
 * ruta, elige el de ruta más corta (más cercano a la raíz), como Obsidian.
 *
 * `ref` es el destino ya sin alias (`partirWikilink`), con su ruta si la traía.
 *
 * Las reglas, en orden (`DEF-120`):
 *
 * 1. **Con extensión de nota** (`x.excalidraw`, `x.drawio`, `x.canvas`,
 *    `x.base`, `x.md`): candidatos = los archivos **de ese tipo** con título
 *    `x`. Si no hay ninguno, se prueba el título literal (una nota que se llame
 *    `x.excalidraw`), como antes.
 * 2. **Sin extensión**: candidatos = todo lo que se llame así.
 * 3. **Pista de carpeta**: si la hay, se quedan solo los candidatos cuya ruta
 *    termina en ella; **si ninguno calza, no hay destino** —también con un solo
 *    candidato—, para que `Otra/x` no lleve a la `x` de otra carpeta.
 * 4. **Sin extensión**, entre los que quedan se prefiere la nota markdown
 *    (convención de Obsidian: `[[Pedido]]` es `Pedido.md`, no `Pedido.excalidraw`).
 * 5. Empate: la ruta más corta, y a igual profundidad el id.
 *
 * > [!warning] Antes el tipo no participaba (`DEF-120`)
 * > Los candidatos eran **todos** los archivos con ese título, sin importar la
 * > extensión pedida, y el desempate elegía el de ruta más corta. Con
 * > `Devoluciones.md` en la raíz y `Eval/excalidraw/Devoluciones.excalidraw`,
 * > `![[Devoluciones.excalidraw]]` resolvía **a la nota**, y
 * > `resolveExcalidrawTarget` —que exige un dibujo— la descartaba: «No se pudo
 * > cargar el diagrama». Con la pista, una que no calzaba caía igual a todos los
 * > candidatos y repetía el desempate. Y `[[Pedido]]` podía abrir el dibujo si
 * > estaba más cerca de la raíz o a la misma altura con un id menor.
 */
export function resolveWikilinkEnIndice<N extends NotaEnlazable>(
  ref: string,
  porTitulo: Map<string, N[]>,
  carpetas: readonly CarpetaEnlazable[],
): N | undefined {
  const matches = candidatosWikilinkEnIndice(ref, porTitulo, carpetas);
  if (matches.length <= 1) return matches[0];

  // 5) Empate de profundidad → por ruta, y no por el orden de la lista: el editor
  // recibe las notas en el orden del store y el grafo en el de su consulta, y
  // con el orden de llegada dos homónimas a la misma altura podían resolver
  // distinto en cada punta.
  const byDepth = (a: N, b: N) =>
    folderSegments(a.carpetaId, carpetas).length - folderSegments(b.carpetaId, carpetas).length ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...matches].sort(byDepth)[0];
}

/**
 * Los candidatos de una referencia tras las reglas 1 a 4 de
 * `resolveWikilinkEnIndice`, **antes** del desempate. Un enlace escrito se
 * resuelve igual con homónimos —elige el más cercano a la raíz, como
 * Obsidian—, pero quien pregunta por un título para actuar sobre él (el MCP de
 * control, `FUN-L-09`) necesita saber que había más de uno para no elegir a
 * ciegas: con dos o más, contesta `AMBIGUO` con las rutas.
 */
export function candidatosWikilinkEnIndice<N extends NotaEnlazable>(
  ref: string,
  porTitulo: Map<string, N[]>,
  carpetas: readonly CarpetaEnlazable[],
): N[] {
  const parts = ref
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];

  const title = parts[parts.length - 1].toLowerCase();
  const hint = parts.slice(0, -1).map((s) => s.toLowerCase());

  // 1) Con extensión: solo los archivos de ese tipo. El título de una nota no
  // lleva la extensión, así que se busca por el título sin ella y se filtra por
  // tipo. Las extensiones salen de `lib/extensionesDeTipo` y no de una lista
  // escrita acá: cuando estaban a mano decían solo `excalidraw|md`, y
  // `![[diagrama.drawio]]` no resolvía a nada.
  const tipoPedido = tipoDeExtension(title);
  let matches: N[] = [];
  if (tipoPedido !== null) {
    matches = (porTitulo.get(sinExtensionDeNota(title)) ?? []).filter((n) => n.tipo === tipoPedido);
  }
  const porExtension = matches.length > 0;
  // 2) Sin extensión —o con una que ningún archivo de ese tipo tiene—: el
  // título tal cual.
  if (!porExtension) matches = porTitulo.get(title) ?? [];
  if (matches.length === 0) return [];

  // 3) La pista de carpeta: la ruta del archivo debe terminar con sus
  // segmentos. Una pista que no calza con ninguno no resuelve —ni siquiera con
  // un único candidato—: antes caía a todos y `Otra/x` llevaba a la `x` de otra
  // carpeta (o, entre homónimos de distinto tipo, al de la raíz: `DEF-120`).
  if (hint.length > 0) {
    matches = matches.filter((n) => {
      const segs = folderSegments(n.carpetaId, carpetas).map((s) => s.toLowerCase());
      if (hint.length > segs.length) return false;
      return hint.every((h, i) => segs[segs.length - hint.length + i] === h);
    });
    if (matches.length === 0) return [];
  }

  // 4) Sin extensión, la nota markdown le gana a un dibujo, un lienzo o una
  // tabla con el mismo nombre (lo que hace Obsidian).
  if (!porExtension && matches.length > 1) {
    const notas = matches.filter((n) => n.tipo === "markdown");
    if (notas.length > 0) matches = notas;
  }
  return matches;
}

/**
 * La referencia más corta que resuelve a `nota`: su título si es el único con
 * ese nombre, y si no `Carpeta/Sub/título`. Es lo que inserta quien escribe un
 * enlace o un embed por su cuenta —crear o soltar un dibujo en una nota—, para
 * que no termine apuntando a una homónima más cercana a la raíz.
 */
export function refUnivoca(
  nota: NotaEnlazable,
  notas: readonly NotaEnlazable[],
  carpetas: readonly CarpetaEnlazable[],
): string {
  const homonimas = notasPorTitulo(notas).get(nota.titulo.toLowerCase())?.length ?? 0;
  if (homonimas <= 1) return nota.titulo;
  return [...folderSegments(nota.carpetaId, carpetas), nota.titulo].join("/");
}

/** `resolveWikilinkEnIndice` sobre una lista de notas (con su índice en caché). */
export function resolveWikilink<N extends NotaEnlazable>(
  ref: string,
  notas: readonly N[],
  carpetas: readonly CarpetaEnlazable[],
): N | undefined {
  return resolveWikilinkEnIndice(ref, notasPorTitulo(notas), carpetas);
}
