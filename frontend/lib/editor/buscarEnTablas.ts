/**
 * El buscador de la nota (HU-31) DENTRO de las tablas renderizadas de la vista
 * en vivo (`DEF-125`).
 *
 * La búsqueda de CodeMirror resalta con decoraciones de marca sobre el texto del
 * editor. Una tabla renderizada (`FUN-L-19`) es un widget de bloque que
 * **reemplaza** su rango: ahí no hay texto del editor que marcar, así que las
 * coincidencias de las celdas se contaban (sobre el markdown) y no se veían.
 *
 * Acá se cubre ese hueco con lo mismo que usa la vista de lectura (`DEF-057`):
 * se busca sobre el DOM de cada celda y se pinta con la CSS Custom Highlight API,
 * que no toca el árbol del widget (el widget se parchea en sitio y no admitiría
 * marcas insertadas). La lista y la navegación las arma `SearchBar` con
 * `coincidenciasEnVivo`; la celda actual viaja en el estado (`celdaActualField`)
 * para que la pinte el plugin cuando el widget exista — fuera de pantalla
 * CodeMirror no lo construye.
 */

import { getSearchQuery, searchPanelOpen, SearchQuery } from "@codemirror/search";
import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  combinarCoincidencias,
  type BloqueBuscable,
  type CeldaBuscada,
  type Coincidencia,
} from "@/lib/buscarCoincidencias";
import { buscarEnDom, centrarRango } from "@/lib/buscarEnDom";
import { renderMarkdown, renderMarkdownEnLinea } from "@/lib/markdown";
import { celdaDe, columnasDe, parsear } from "@/lib/tablas";

/** Nombres de los resaltados (distintos de los de la lectura: conviven). */
export const RESALTADO_CELDAS = "mic-buscar-celda";
export const RESALTADO_CELDA_ACTUAL = "mic-buscar-celda-actual";

/** Marca (o desmarca, con null) la coincidencia actual dentro de una tabla. */
export const celdaActualEffect = StateEffect.define<CeldaBuscada | null>();

/**
 * La coincidencia actual cuando es de una celda. Se suelta en cuanto la
 * selección se mueve por otro motivo: a partir de ahí manda la selección, como
 * en el resto del buscador.
 */
export const celdaActualField = StateField.define<CeldaBuscada | null>({
  create: () => null,
  update(valor, tr) {
    for (const e of tr.effects) if (e.is(celdaActualEffect)) return e.value;
    if (!valor) return valor;
    if (tr.selection) return null;
    if (tr.docChanged) return { ...valor, tabla: tr.changes.mapPos(valor.tabla) };
    return valor;
  },
});

/** Las dos cosas de `livePreview.ts` que hacen falta, sin importarlo (ciclo). */
export type FuenteDeTablas = {
  /** Rangos `[desde, hasta]` de las tablas renderizadas como widget. */
  rangos(state: EditorState): [number, number][];
  /** El rango de la tabla que dibuja ese DOM de widget. */
  rangoDe(view: EditorView, dom: HTMLElement): [number, number] | null;
};

/** Texto visible de un HTML, sin conectarlo al documento. */
function textoVisible(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return tpl.content.textContent ?? "";
}

/**
 * Caché markdown → texto visible. Al teclear en el buscador se recalcula la lista
 * en cada tecla, y sin esto cada celda se renderizaría otra vez.
 */
const cacheTexto = new Map<string, string>();
function visibleDe(md: string, enLinea: boolean): string {
  const clave = (enLinea ? "l" : "b") + md;
  let t = cacheTexto.get(clave);
  if (t === undefined) {
    if (cacheTexto.size > 5000) cacheTexto.clear();
    t = md === "" ? "" : textoVisible(enLinea ? renderMarkdownEnLinea(md) : renderMarkdown(md));
    cacheTexto.set(clave, t);
  }
  return t;
}

/**
 * Lo que muestra cada tabla, celda por celda y en el orden en que se leen. Es
 * lo mismo que pinta `TablaEnSitio`: el markdown de la celda con
 * `renderMarkdownEnLinea`, o la tabla entera con `renderMarkdown` si es
 * irregular y el widget la dibuja sin celdas.
 */
function bloquesDeTablas(state: EditorState, rangos: [number, number][]): BloqueBuscable[] {
  return rangos.map(([desde, hasta]) => {
    const md = state.doc.sliceString(desde, hasta);
    const t = parsear(md);
    if (!t) return { desde, hasta, celdas: [{ fila: null, columna: null, texto: visibleDe(md, false) }] };
    const columnas = columnasDe(t);
    const celdas: BloqueBuscable["celdas"] = [];
    for (let fila = -1; fila < t.filas.length; fila++) {
      for (let columna = 0; columna < columnas; columna++) {
        celdas.push({ fila, columna, texto: visibleDe(celdaDe(t, fila, columna), true) });
      }
    }
    return { desde, hasta, celdas };
  });
}

/**
 * Todas las coincidencias de la vista en vivo, en orden: las del texto del
 * editor fuera de las tablas y las que se VEN dentro de cada tabla.
 */
export function coincidenciasEnVivo(
  state: EditorState,
  query: SearchQuery,
  fuente: FuenteDeTablas | null,
): Coincidencia[] {
  if (!query.search || !query.valid) return [];
  const texto: { desde: number; hasta: number }[] = [];
  const cursor = query.getCursor(state);
  for (let it = cursor.next(); !it.done; it = cursor.next()) {
    texto.push({ desde: it.value.from, hasta: it.value.to });
  }
  const rangos = fuente?.rangos(state) ?? [];
  // Una búsqueda por expresión regular no se traduce a las celdas: ahí manda
  // CodeMirror sola, como antes (el buscador de la nota siempre es literal).
  if (rangos.length === 0 || query.regexp) return texto;
  return combinarCoincidencias(
    texto,
    bloquesDeTablas(state, rangos),
    query.search,
    query.caseSensitive,
  );
}

// ── Pintado ──────────────────────────────────────────────────────────────────

/** Rangos pintados por cada vista: `CSS.highlights` es global del documento. */
const pintados = new Map<EditorView, { todos: Range[]; actual: Range | null }>();

const haySoporte = () => typeof CSS !== "undefined" && "highlights" in CSS;

function repintar() {
  if (!haySoporte()) return;
  const todos: Range[] = [];
  const actuales: Range[] = [];
  for (const p of pintados.values()) {
    todos.push(...p.todos);
    if (p.actual) actuales.push(p.actual);
  }
  if (todos.length > 0) CSS.highlights.set(RESALTADO_CELDAS, new Highlight(...todos));
  else CSS.highlights.delete(RESALTADO_CELDAS);
  if (actuales.length > 0) {
    const h = new Highlight(...actuales);
    // Por encima de la de todas, que también la cubre.
    h.priority = 1;
    CSS.highlights.set(RESALTADO_CELDA_ACTUAL, h);
  } else CSS.highlights.delete(RESALTADO_CELDA_ACTUAL);
}

/** El DOM de la tabla que arranca en `desde`, si CodeMirror lo tiene construido. */
export function domDeTabla(
  view: EditorView,
  fuente: FuenteDeTablas,
  desde: number,
): HTMLElement | null {
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(".mic-live-table")) {
    if (fuente.rangoDe(view, el)?.[0] === desde) return el;
  }
  return null;
}

/** Las partes de un widget de tabla donde se busca, con su celda. */
function partesDe(dom: HTMLElement): { fila: number | null; columna: number | null; el: HTMLElement }[] {
  const celdas = dom.querySelectorAll<HTMLElement>(".mic-tab-celda");
  if (celdas.length === 0) {
    // Tabla irregular: el widget la dibuja entera, sin celdas editables.
    const caja = dom.querySelector<HTMLElement>(".mic-tab-caja");
    return caja ? [{ fila: null, columna: null, el: caja }] : [];
  }
  const res: { fila: number | null; columna: number | null; el: HTMLElement }[] = [];
  for (const celda of celdas) {
    // Solo lo renderizado: los tiradores (⋮ ⋯) no son contenido, y una celda
    // abierta a edición es un `<textarea>`, que un resaltado no alcanza.
    const render = celda.querySelector<HTMLElement>(".mic-tab-render");
    if (render) {
      res.push({ fila: Number(celda.dataset.fila), columna: Number(celda.dataset.columna), el: render });
    }
  }
  return res;
}

/**
 * Pinta las coincidencias de las tablas que están en el DOM y, la primera vez
 * que aparece la actual, la centra. Se repinta en cada actualización: el widget
 * se construye al entrar al viewport y parchea sus celdas al cambiar el texto.
 */
function pluginDeResaltado(fuente: FuenteDeTablas) {
  return ViewPlugin.fromClass(
    class {
      /** Hay una celda actual nueva que todavía no se llevó a la vista. */
      centrar = false;

      constructor(readonly view: EditorView) {
        this.programar();
      }

      update(u: ViewUpdate) {
        const antes = u.startState.field(celdaActualField, false);
        const ahora = u.state.field(celdaActualField, false);
        if (ahora !== antes) this.centrar = ahora != null;
        // Con el buscador cerrado no hay nada que pintar; solo hace falta una
        // pasada más para borrar lo que haya quedado de cuando estaba abierto.
        if (searchPanelOpen(u.state) || pintados.has(this.view)) this.programar();
      }

      /** Pinta en la fase de escritura: después de que CodeMirror dibujó el DOM. */
      programar() {
        this.view.requestMeasure({
          key: this,
          read: () => null,
          write: () => this.pintar(),
        });
      }

      pintar() {
        const view = this.view;
        const state = view.state;
        const query = getSearchQuery(state);
        if (!searchPanelOpen(state) || !query.search || !query.valid || query.regexp) {
          if (pintados.delete(view)) repintar();
          this.centrar = false;
          return;
        }
        const actualCelda = state.field(celdaActualField, false) ?? null;
        const todos: Range[] = [];
        let actual: Range | null = null;
        for (const dom of view.contentDOM.querySelectorAll<HTMLElement>(".mic-live-table")) {
          const rango = fuente.rangoDe(view, dom);
          for (const parte of partesDe(dom)) {
            const rangos = buscarEnDom(parte.el, query.search, query.caseSensitive);
            todos.push(...rangos);
            if (
              actualCelda &&
              rango?.[0] === actualCelda.tabla &&
              parte.fila === actualCelda.fila &&
              parte.columna === actualCelda.columna
            ) {
              actual = rangos[actualCelda.n] ?? null;
            }
          }
        }
        if (todos.length === 0 && !pintados.has(view)) return;
        pintados.set(view, { todos, actual });
        repintar();
        if (this.centrar && actual) {
          this.centrar = false;
          centrarRango(view.scrollDOM, actual);
        }
      }

      destroy() {
        if (pintados.delete(this.view)) repintar();
      }
    },
  );
}

/** Extensiones del buscador dentro de las tablas renderizadas (modo en vivo). */
export function buscarEnTablas(fuente: FuenteDeTablas): Extension {
  return [celdaActualField, fuenteDeTablas.of(fuente), pluginDeResaltado(fuente)];
}

/**
 * La fuente de tablas, para que `SearchBar` la encuentre desde el estado sin
 * saber si la vista es del editor en vivo (con tablas) o de otro modo (sin).
 */
export const fuenteDeTablas = Facet.define<FuenteDeTablas, FuenteDeTablas | null>({
  combine: (v) => v[0] ?? null,
});

/**
 * Lleva el buscador a una coincidencia de la lista: la selecciona si es del
 * texto, o la marca como actual si es de una celda.
 */
export function irACoincidencia(view: EditorView, c: Coincidencia): void {
  if (!c.celda) {
    view.dispatch({
      selection: { anchor: c.desde, head: c.hasta },
      // DEF-056: centrada, no pegada al borde.
      effects: [celdaActualEffect.of(null), EditorView.scrollIntoView(c.desde, { y: "center" })],
      userEvent: "select.search",
    });
    return;
  }
  const fuente = view.state.facet(fuenteDeTablas);
  const efectos: StateEffect<unknown>[] = [celdaActualEffect.of(c.celda)];
  // Si la tabla no está construida (fuera del viewport) se la trae primero; el
  // plugin centra la celda cuando el widget aparezca. Si ya está, el plugin la
  // centra directamente: un scroll de CodeMirror después lo deshacería.
  if (!fuente || !domDeTabla(view, fuente, c.desde)) {
    efectos.push(EditorView.scrollIntoView(c.desde, { y: "center" }));
  }
  view.dispatch({
    // El cursor va al borde de la tabla: así la coincidencia del texto que
    // estaba seleccionada deja de verse como la actual.
    selection: { anchor: c.desde },
    effects: efectos,
    userEvent: "select.search",
  });
}
