/**
 * Cómo se parte un `[[wikilink]]` en destino y alias. Módulo **puro y sin
 * imports** a propósito: lo consumen tanto la capa de datos (`lib/db/grafo.ts`)
 * como el editor, y `scripts/test-wikilinks.mjs` lo transpila e importa sin
 * build, igual que `lib/frontmatter.ts` o `lib/bases.ts`.
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
 * El destino ya listo para buscar por título: sin alias y sin la ruta de
 * carpetas que lo desambigua. Es lo que necesitan el grafo y el canvas, que
 * comparan contra los títulos del vault.
 */
export function destinoDeWikilink(inner: string): string {
  const { destino } = partirWikilink(inner);
  const barra = destino.lastIndexOf("/");
  return (barra >= 0 ? destino.slice(barra + 1) : destino).trim();
}
