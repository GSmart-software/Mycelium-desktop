import { indentLess, indentMore } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { separarFrontmatter } from "@/lib/frontmatter";

/**
 * Comandos de formato de la toolbar (HU-02 CA4/CA5):
 * con selección envuelve; sin selección inserta la sintaxis con el
 * cursor en el medio.
 */
export function wrapSelection(view: EditorView, marker: string, closing?: string) {
  const close = closing ?? marker;
  const { from, to } = view.state.selection.main;

  if (from === to) {
    view.dispatch({
      changes: { from, insert: `${marker}${close}` },
      selection: EditorSelection.cursor(from + marker.length),
    });
    return;
  }

  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${marker}${selected}${close}` },
    selection: EditorSelection.range(from + marker.length, to + marker.length),
  });
}

/**
 * Inserta o reemplaza el prefijo # de la línea actual (HU-02 CA13):
 * H1 sobre "## Título" → "# Título".
 */
export function setHeading(view: EditorView, level: number) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const prefix = "#".repeat(level) + " ";
  const current = /^(#{1,6})\s+/.exec(line.text);

  if (current) {
    view.dispatch({
      changes: { from: line.from, to: line.from + current[0].length, insert: prefix },
    });
  } else {
    view.dispatch({ changes: { from: line.from, insert: prefix } });
  }
}

/** Prepende (o quita) un prefijo de línea: "- ", "1. ", "> ". */
export function toggleLinePrefix(view: EditorView, prefix: string) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  if (line.text.startsWith(prefix)) {
    view.dispatch({
      changes: { from: line.from, to: line.from + prefix.length, insert: "" },
    });
  } else {
    view.dispatch({ changes: { from: line.from, insert: prefix } });
  }
}

/** Inserta un link markdown desde el popover (HU-02). */
export function insertLink(view: EditorView, text: string, url: string) {
  const { from, to } = view.state.selection.main;
  const label = text || "enlace";
  const markdown = `[${label}](${url})`;
  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: EditorSelection.cursor(from + markdown.length),
  });
}

/** Aumenta la sangría de la(s) línea(s) seleccionada(s) — botón y Tab. */
export function indentLine(view: EditorView) {
  indentMore(view);
}

/** Disminuye la sangría de la(s) línea(s) seleccionada(s) — botón y Shift+Tab. */
export function outdentLine(view: EditorView) {
  indentLess(view);
}

/**
 * Aplica al documento el texto `nuevo` con UNA transacción que cambia el rango
 * MÍNIMO que difiere (prefijo/sufijo comunes descartados). Lo usa el panel de
 * propiedades (`FUN-M-04`).
 *
 * Es deliberado que el panel NO escriba el archivo por su cuenta: si llamara a
 * `putContenido` mientras el editor tiene el documento montado, el siguiente
 * autoguardado del editor (debounce de 800 ms sobre SU estado) pisaría el
 * cambio, y el usuario no podría deshacerlo con Ctrl+Z. Despachando la
 * transacción, el flujo de guardado normal hace el resto, el undo es de una sola
 * acción y ni el scroll ni el cursor se mueven.
 */
export function aplicarTextoMinimo(view: EditorView, nuevo: string): void {
  const actual = view.state.doc.toString();
  if (actual === nuevo) return;

  let inicio = 0;
  const maximo = Math.min(actual.length, nuevo.length);
  while (inicio < maximo && actual[inicio] === nuevo[inicio]) inicio++;

  let finActual = actual.length;
  let finNuevo = nuevo.length;
  while (finActual > inicio && finNuevo > inicio && actual[finActual - 1] === nuevo[finNuevo - 1]) {
    finActual--;
    finNuevo--;
  }

  view.dispatch({
    changes: { from: inicio, to: finActual, insert: nuevo.slice(inicio, finNuevo) },
    // `userEvent` para que el editor marque la nota como editada (y fije la
    // pestaña de previsualización) igual que si se hubiera escrito a mano.
    userEvent: "input",
  });
}

/**
 * Aplica una edición de `lib/frontmatter.ts` (`ponerPropiedad` y compañía)
 * reemplazando SOLO el bloque de frontmatter (`FUN-M-19`).
 *
 * Esas funciones reciben y devuelven el DOCUMENTO ENTERO, pero solo tocan las
 * líneas del bloque. Despacharlo como un cambio de todo el documento arruinaría
 * el deshacer (un `Ctrl+Z` que revierte medio archivo) y movería el cursor del
 * cuerpo. Como el cuerpo queda intacto, se lo usa de ancla: el cambio va del 0
 * al final del bloque viejo y el `insert` es todo lo que en el texto nuevo
 * queda por delante de ese mismo cuerpo.
 *
 * El `userEvent` es propio y NO es de los que agrupa `history` (solo agrupa
 * `input.type` y `delete`), así que cada operación es un paso de deshacer
 * entero; sigue empezando por `input.` para que el editor la trate como una
 * edición del usuario (marcar la nota sucia, fijar la pestaña).
 *
 * Lanza lo que lance `transformar` — la guarda de frontmatter no soportado
 * (`guardaEdicion`) vive en el módulo puro y llega hasta acá.
 */
export function aplicarEdicionFrontmatter(
  view: EditorView,
  transformar: (texto: string) => string,
): void {
  const texto = view.state.doc.toString();
  const nuevo = transformar(texto);
  if (nuevo === texto) return;

  const cuerpo = texto.slice(inicioDeLinea(texto, separarFrontmatter(texto).cuerpoDesde));
  if (!nuevo.endsWith(cuerpo)) {
    // No debería pasar (las funciones solo tocan el bloque); si pasa, el diff
    // mínimo es correcto igual y es preferible a escribir un rango mal.
    aplicarTextoMinimo(view, nuevo);
    return;
  }

  view.dispatch({
    changes: {
      from: 0,
      to: texto.length - cuerpo.length,
      insert: nuevo.slice(0, nuevo.length - cuerpo.length),
    },
    userEvent: "input.propiedad",
  });
}

/** Posición del inicio de la línea `n` (0-based) dentro de `texto`. */
function inicioDeLinea(texto: string, n: number): number {
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const salto = texto.indexOf("\n", pos);
    if (salto === -1) return texto.length;
    pos = salto + 1;
  }
  return pos;
}

/**
 * Asegura que la nota tenga bloque de propiedades y deja el foco donde se
 * escribe la primera (`FUN-M-19`). Es la vía para una nota SIN frontmatter: ahí
 * no hay widget donde pulsar «+ Agregar propiedad», así que el botón vive en la
 * barra de herramientas. Un bloque vacío (`---`/`---`) es frontmatter válido.
 */
export function insertarBloquePropiedades(view: EditorView) {
  const texto = view.state.doc.toString();
  if (!separarFrontmatter(texto).hay) {
    const cr = texto.includes("\r\n") ? "\r" : "";
    const insert = `---${cr}\n---${cr}\n`;
    view.dispatch({
      changes: { from: 0, insert },
      // El cursor va al cuerpo: dentro del bloque el editor mostraría el YAML
      // crudo en vez de la tarjeta que se acaba de crear.
      selection: EditorSelection.cursor(insert.length),
      userEvent: "input.propiedad",
    });
  }
  // El campo vive en el widget, que se dibuja en el ciclo de medida siguiente.
  requestAnimationFrame(() => {
    const campo = view.dom.querySelector<HTMLInputElement>(".mic-props-nueva");
    campo?.focus();
  });
}

/** Inserta `---` en una línea nueva (HU-02). */
export function insertHorizontalRule(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const insert = line.length === 0 ? "---\n" : "\n---\n";
  view.dispatch({
    changes: { from: line.to, insert },
    selection: EditorSelection.cursor(line.to + insert.length),
  });
}
