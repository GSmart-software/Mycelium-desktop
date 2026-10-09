/**
 * Los bloques ```ejemplo de una página de ayuda (`FUN-L-27`).
 *
 * Un ejemplo se escribe como un bloque de código con la info `ejemplo`, y la
 * ayuda lo muestra en dos partes: el texto fuente (con «Copiar») y cómo se ve
 * renderizado con el motor real de la vista de lectura. Así la página no puede
 * mentir: si una sintaxis deja de funcionar, el ejemplo se ve roto.
 *
 * Este módulo solo PARTE el Markdown en trozos; renderizarlos es cosa de
 * `lib/ayuda/render.ts`. Es puro y sin imports para que
 * `scripts/test-ayuda.mjs` lo cargue sin la app.
 *
 * Para mostrar un ejemplo que a su vez lleva un bloque de código, la valla de
 * afuera tiene que ser más larga que la de adentro, como en cualquier Markdown:
 *
 *     ````ejemplo
 *     ```js
 *     const x = 1;
 *     ```
 *     ````
 */

export type TrozoDeAyuda = { tipo: "md"; texto: string } | { tipo: "ejemplo"; fuente: string };

/** Apertura de una valla: hasta tres espacios, tres o más ` o ~, y la info. */
const APERTURA_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;

/** Parte el Markdown de una página en texto común y ejemplos, en orden. */
export function partirEjemplos(md: string): TrozoDeAyuda[] {
  const lineas = md.replace(/\r\n?/g, "\n").split("\n");
  const trozos: TrozoDeAyuda[] = [];
  let comun: string[] = [];
  let i = 0;
  while (i < lineas.length) {
    const apertura = APERTURA_RE.exec(lineas[i]);
    if (!apertura) {
      comun.push(lineas[i++]);
      continue;
    }
    const valla = apertura[1];
    const cierre = new RegExp(`^ {0,3}${valla[0] === "`" ? "`" : "~"}{${valla.length},}[ \\t]*$`);
    let fin = i + 1;
    while (fin < lineas.length && !cierre.test(lineas[fin])) fin++;
    if (apertura[2] === "ejemplo") {
      if (comun.length) trozos.push({ tipo: "md", texto: comun.join("\n") });
      comun = [];
      trozos.push({ tipo: "ejemplo", fuente: lineas.slice(i + 1, fin).join("\n") });
    } else {
      // Un bloque de código común se copia entero: un ```ejemplo escrito ADENTRO
      // de él es texto, no un ejemplo.
      comun.push(...lineas.slice(i, Math.min(fin + 1, lineas.length)));
    }
    i = fin + 1;
  }
  if (comun.length) trozos.push({ tipo: "md", texto: comun.join("\n") });
  return trozos;
}
