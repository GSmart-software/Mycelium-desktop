import { Facet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { aplicarTitulo } from "@/lib/tituloEditable";

/**
 * Título = nombre del archivo renderizado DENTRO del documento, como un bloque
 * al inicio (se desplaza con el contenido, no es fijo). No forma parte del texto
 * markdown: es un widget decorativo. El color es un degradado glow→accent y la
 * tipografía es la del editor (la vista de lectura usa la suya propia).
 *
 * Desde `FUN-M-24` **también renombra el archivo**: un clic lo abre para editar,
 * <kbd>Enter</kbd> confirma, y <kbd>Esc</kbd> o salir del campo descartan. Solo acá — el título de la
 * vista de lectura sigue siendo texto, porque esa vista es de solo lectura de
 * punta a punta y un único elemento que sí se pueda tocar la vuelve mentira.
 *
 * Dejó de ser un adorno, así que le aplican las reglas del widget de bloque
 * interactivo
 * ([[CodeMirror y la vista en vivo]]) — las que corresponden:
 *
 * - **`updateDOM` obligatorio** (regla 2). Sin él CodeMirror tira el DOM y lo
 *   reconstruye, y el campo pierde el foco a la primera tecla.
 * - **`ignoreEvent()` en `true`** (regla 3). Acá vale para todo el widget y no
 *   solo para los controles: el título entero ES el control, y un clic en él
 *   abre la edición en vez de colocar el cursor en el documento.
 * - **`requestMeasure` en cada cambio de alto** (regla 5). Abrir el campo o
 *   mostrar un error pasa FUERA del ciclo de actualización de CodeMirror, y su
 *   height-map se quedaría con el alto anterior.
 *
 * La 4 y la 6 **no aplican, y no por olvido**: renombrar no edita el documento
 * —no hay `dispatch` de texto que agrupar en el deshacer— y este widget no
 * reemplaza ningún rango, así que no esconde texto en el que el cursor pueda
 * entrar a ciegas.
 */
export const setDocTitle = StateEffect.define<{ title: string; show: boolean }>();

/**
 * Quién renombra de verdad (`FUN-M-24`).
 *
 * Va por un `Facet` y no por un parámetro por el mismo motivo que
 * `navegarPorTitulo` en `livePreview`: el widget lo construye un `StateField`,
 * que no ve ningún closure — lo único que tiene a mano es el `EditorView`, y
 * desde él el estado.
 */
export const renombrarPorTitulo = Facet.define<
  (titulo: string) => Promise<void>,
  ((titulo: string) => Promise<void>) | null
>({
  combine: (valores) => valores[0] ?? null,
});

/**
 * Dibuja el título en modo lectura: el nombre, y debajo el error si lo hubo.
 *
 * El error sobrevive a salir de edición a propósito: es la respuesta a algo que
 * el usuario acaba de intentar, y se va cuando vuelve a intentarlo.
 */
function pintarLectura(
  cont: HTMLElement,
  titulo: string,
  error: string | null,
  view: EditorView,
) {
  cont.textContent = "";

  const texto = document.createElement("div");
  texto.className = "mic-doc-title-texto mic-doc-title-editable";
  texto.textContent = titulo;
  texto.title = "Clic para renombrar el archivo";
  texto.addEventListener("click", () => pintarEdicion(cont, titulo, view));
  cont.appendChild(texto);

  if (error !== null) cont.appendChild(cartelError(error));
  view.requestMeasure();
}

/** El cartel de error. Va fuera del degradado: si no, sería ilegible. */
function cartelError(motivo: string): HTMLElement {
  const el = document.createElement("p");
  el.className = "mic-doc-title-error";
  el.setAttribute("role", "alert");
  el.textContent = motivo;
  return el;
}

/** Abre el campo para escribir el nombre nuevo. */
function pintarEdicion(cont: HTMLElement, titulo: string, view: EditorView) {
  cont.textContent = "";

  // La caja va FUERA del campo, no en él: el degradado del título se pinta con
  // `background-clip: text`, y ese recorte alcanza a todas las capas de fondo —
  // un `background-color` en el propio campo se recortaría contra las letras y
  // no se vería. El campo conserva el degradado; la caja pone el marco.
  const caja = document.createElement("div");
  caja.className = "mic-doc-title-caja";
  cont.appendChild(caja);

  const campo = document.createElement("input");
  campo.className = "mic-doc-title-campo";
  campo.value = titulo;
  campo.spellcheck = false;
  campo.setAttribute("aria-label", "Nombre del archivo");
  caja.appendChild(campo);
  campo.focus();
  campo.select();
  view.requestMeasure();

  // Salir del campo DESCARTA: renombrar mueve el archivo en disco y reescribe
  // los enlaces que le apuntan, así que no puede pasar por un clic distraído en
  // cualquier otro sitio. Confirmar es siempre un acto: Enter.
  //
  // `cerrado` evita que confirmar con Enter dispare además el `blur` que viene
  // detrás, que descartaría lo que se acaba de renombrar.
  let cerrado = false;

  const terminar = async (propuesto: string | null) => {
    if (cerrado) return;
    cerrado = true;
    if (propuesto === null) {
      pintarLectura(cont, titulo, null, view);
      return;
    }
    const renombrar = view.state.facet(renombrarPorTitulo);
    if (renombrar === null) {
      pintarLectura(cont, titulo, null, view);
      return;
    }
    const r = await aplicarTitulo(titulo, propuesto, renombrar);
    // En el caso bueno el título nuevo llega solo, por `setDocTitle`, cuando el
    // árbol del vault se recarga. Se vuelve a lectura con el viejo igual: es lo
    // que hay hasta que llegue, y el parpadeo dura menos que la recarga.
    pintarLectura(cont, titulo, r.estado === "error" ? r.motivo : null, view);
  };

  campo.addEventListener("keydown", (e) => {
    // El editor no debería verlas —`ignoreEvent` lo impide— pero un `Escape` con
    // oyentes globales por encima sí, y cerraría otra cosa de paso.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      void terminar(campo.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      void terminar(null);
    }
  });
  campo.addEventListener("blur", () => void terminar(null));
}

class TitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }
  eq(other: TitleWidget) {
    return other.title === this.title;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "mic-doc-title mic-doc-title-editor";
    pintarLectura(el, this.title, null, view);
    return el;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    // Si el campo está abierto no se pisa lo que el usuario está escribiendo.
    // Pasa de verdad: guardar la nota dispara transacciones mientras se teclea
    // el nombre.
    if (dom.querySelector("input") !== null) return true;
    pintarLectura(dom, this.title, null, view);
    return true;
  }
  ignoreEvent() {
    return true;
  }
}

function buildDeco(title: string, show: boolean): DecorationSet {
  if (!show || !title) return Decoration.none;
  return Decoration.set([
    Decoration.widget({ widget: new TitleWidget(title), side: -1, block: true }).range(0),
  ]);
}

export const docTitleField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setDocTitle)) return buildDeco(e.value.title, e.value.show);
    }
    return deco.map(tr.changes); // el bloque vive en la posición 0 (se conserva)
  },
  provide: (f) => EditorView.decorations.from(f),
});
