/**
 * Búsqueda de texto sobre HTML ya renderizado (`DEF-057`).
 *
 * La vista de lectura no es CodeMirror: es HTML suelto en un panel. El buscador
 * de la nota (HU-31) trabajaba solo contra el editor, así que en modo lectura
 * resaltaba y desplazaba un editor **oculto** y no pasaba nada visible.
 *
 * Devuelve `Range` del DOM, no marcas insertadas: el resaltado se pinta con la
 * **CSS Custom Highlight API** (`CSS.highlights` + `::highlight()`), que no toca
 * el árbol. Es lo que corresponde acá porque el HTML del preview se **regenera
 * entero** en cada cambio del documento: cualquier `<mark>` que insertáramos
 * desaparecería en el siguiente render, o peor, se quedaría pegado al contenido.
 */

/** Un texto y dónde empieza dentro de la concatenación de todos. */
type Tramo = { nodo: Text; desde: number };

/** Recorre los nodos de texto visibles bajo `raiz`, en orden de documento. */
function tramosDe(raiz: HTMLElement): { tramos: Tramo[]; texto: string } {
  const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  const tramos: Tramo[] = [];
  let texto = "";
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const nodo = n as Text;
    if (nodo.data.length === 0) continue;
    tramos.push({ nodo, desde: texto.length });
    texto += nodo.data;
  }
  return { tramos, texto };
}

/** Traduce un índice del texto concatenado a (nodo, desplazamiento). */
function ubicar(tramos: Tramo[], indice: number): { nodo: Text; desp: number } | null {
  if (tramos.length === 0) return null;
  // Binaria: el último tramo que empieza en o antes de `indice`.
  let lo = 0;
  let hi = tramos.length - 1;
  while (lo < hi) {
    const medio = Math.ceil((lo + hi) / 2);
    if (tramos[medio].desde <= indice) lo = medio;
    else hi = medio - 1;
  }
  const t = tramos[lo];
  return { nodo: t.nodo, desp: Math.min(indice - t.desde, t.nodo.data.length) };
}

/**
 * Rangos de todas las apariciones de `termino` bajo `raiz`, en orden.
 *
 * Busca sobre el texto **concatenado**, así que una coincidencia partida entre
 * dos nodos —lo normal en cuanto hay una negrita o un enlace en el medio— se
 * encuentra igual y su `Range` abarca los dos.
 */
export function buscarEnDom(raiz: HTMLElement, termino: string, sensible: boolean): Range[] {
  if (termino === "") return [];
  const { tramos, texto } = tramosDe(raiz);
  const heno = sensible ? texto : texto.toLowerCase();
  const aguja = sensible ? termino : termino.toLowerCase();
  const rangos: Range[] = [];

  let i = heno.indexOf(aguja);
  while (i >= 0) {
    const a = ubicar(tramos, i);
    const b = ubicar(tramos, i + aguja.length);
    if (a && b) {
      const r = document.createRange();
      r.setStart(a.nodo, a.desp);
      r.setEnd(b.nodo, b.desp);
      rangos.push(r);
    }
    // El avance nunca es 0: un término vacío ya se descartó arriba.
    i = heno.indexOf(aguja, i + aguja.length);
  }
  return rangos;
}

/** Nombres de los resaltados registrados en `CSS.highlights`. */
export const RESALTADO_TODOS = "mic-buscar";
export const RESALTADO_ACTUAL = "mic-buscar-actual";

/** ¿El navegador sabe pintar resaltados sin tocar el DOM? */
function haySoporte(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS;
}

/** Pinta las coincidencias, y aparte la actual para distinguirla. */
export function pintarResaltados(rangos: Range[], actual: number): void {
  if (!haySoporte()) return;
  if (rangos.length === 0) {
    limpiarResaltados();
    return;
  }
  CSS.highlights.set(RESALTADO_TODOS, new Highlight(...rangos));
  const sel = rangos[actual];
  if (sel) CSS.highlights.set(RESALTADO_ACTUAL, new Highlight(sel));
  else CSS.highlights.delete(RESALTADO_ACTUAL);
}

/** Quita los resaltados. Hay que llamarlo al cerrar y al desmontar. */
export function limpiarResaltados(): void {
  if (!haySoporte()) return;
  CSS.highlights.delete(RESALTADO_TODOS);
  CSS.highlights.delete(RESALTADO_ACTUAL);
}

/**
 * Centra un rango dentro de su panel de scroll.
 *
 * Se calcula a mano por lo mismo que en el editor (`DEF-056`): `scrollIntoView`
 * decide por su cuenta y puede dejar la coincidencia pegada a un borde.
 */
export function centrarRango(panel: HTMLElement, rango: Range): void {
  const r = rango.getBoundingClientRect();
  if (r.height === 0 && r.width === 0) return; // rango no visible
  const caja = panel.getBoundingClientRect();
  const centrado = panel.scrollTop + (r.top - caja.top) - (panel.clientHeight - r.height) / 2;
  panel.scrollTop = Math.max(0, Math.min(centrado, panel.scrollHeight - panel.clientHeight));
}
