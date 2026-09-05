import { EditorView, GutterMarker, lineNumbers, lineNumberWidgetMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * Números de línea del editor (`FUN-M-28`).
 *
 * No es `lineNumbers()` a secas por una razón concreta: **un bloque renderizado
 * se queda sin número**. Una tabla o la tarjeta de propiedades son *widgets de
 * bloque* que reemplazan varias líneas del documento por un solo bloque, y el
 * margen no dibuja nada para esos —su `widgetMarker` por defecto devuelve
 * `null`—. El resultado era un hueco: la numeración se cortaba en la tabla y
 * volvía más abajo, contando bien pero sin nada a la vista en el medio.
 *
 * `lineNumberWidgetMarker` existe justo para eso, y acá se le dan **las dos
 * líneas que el bloque abarca**, como `34–40`, arriba del bloque.
 *
 * > [!important] El margen necesita sitio para el rango, y se lo damos
 * > El ancho del margen lo fija lo más largo que haya **a la vista**, así que un
 * > rango ensancharía el margen al entrar una tabla en pantalla y lo angostaría
 * > al salir: el texto saltaría de lado al hacer scroll.
 * >
 * > La solución no es achicar el rango sino **reservar el sitio de antemano**:
 * > con los números activos, `.cm-scroller` cede su relleno izquierdo y el
 * > margen se lleva ese espacio con un ancho MÍNIMO fijo (`--mic-ancho-numeros`,
 * > en `styles/editor.css`). Como el mínimo ya es más ancho que un rango
 * > corriente, el margen no cambia de tamaño con lo que entre o salga de la
 * > pantalla, y el texto no se mueve.
 *
 * Alinear un número por FILA es otra cosa y no se puede desde acá: el margen
 * admite **una sola marca por bloque**, y además las filas no se corresponden
 * una a una con las líneas —el `|---|` de una tabla es una línea del archivo que
 * no dibuja ninguna fila—. Eso solo podría hacerlo el propio widget.
 */

/**
 * Las líneas que abarca un bloque renderizado, como `34–40`. Si cubre una sola,
 * se muestra el número a secas.
 */
class MarcaRango extends GutterMarker {
  constructor(
    private readonly desde: number,
    private readonly hasta: number,
  ) {
    super();
  }

  /** Sin esto CodeMirror rehace el DOM del margen en cada medición. */
  eq(otra: MarcaRango) {
    return otra.desde === this.desde && otra.hasta === this.hasta;
  }

  toDOM() {
    const caja = document.createElement("span");
    caja.className = "mic-num-rango";
    // Guion corto y sin espacios: es lo más angosto que se sigue leyendo como
    // «de acá hasta acá».
    caja.textContent =
      this.hasta > this.desde ? `${this.desde}-${this.hasta}` : String(this.desde);
    return caja;
  }
}

export function numerosDeLineaExt(): Extension {
  return [
    lineNumbers(),
    lineNumberWidgetMarker.of((view, _widget, bloque) => {
      // Un widget que NO reemplaza texto —el título del documento se INSERTA en
      // la posición 0— no cubre ninguna línea, así que no le corresponde
      // ninguna. Sin esta guarda mostraba un «1» propio, y la línea 1 de verdad
      // mostraba otro justo debajo.
      if (bloque.from === bloque.to) return null;
      // `bloque.from` es el arranque del rango que el widget reemplaza, así que
      // esta es la línea donde empieza la tabla en el documento.
      const doc = view.state.doc;
      return new MarcaRango(doc.lineAt(bloque.from).number, doc.lineAt(bloque.to).number);
    }),
    // El número, vertical y horizontalmente donde corresponde:
    //
    // - **Centrado en su línea.** Por defecto se apoya arriba, y en una línea
    //   más alta que las demás —un título, una línea que envuelve— quedaba
    //   despegado del texto al que numera.
    // - **Alineado a la derecha** de su columna, que es lo que hace que los
    //   números de distinto largo (9, 10, 100) queden pegados al texto y no
    //   bailando.
    EditorView.theme({
      ".cm-lineNumbers .cm-gutterElement": {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "0 0.55em 0 0.6em",
      },
      // El rango va ARRIBA del bloque, no centrado en él: es donde empieza la
      // tabla en el archivo, y centrado en una tabla alta quedaba flotando lejos
      // de todo.
      //
      // El fondo marca CUÁNTO ocupa el bloque: la casilla del margen mide
      // exactamente lo que mide el bloque, así que teñirla dibuja de un vistazo
      // qué tramo del archivo cubren esas líneas. Sin él, un rango arriba de una
      // tabla alta no dice dónde termina.
      //
      // El tinte sale de `--mic-num-rango-fondo` (`styles/editor.css`) y no de
      // un valor escrito acá: se calcula del color del texto —así se aclara en
      // oscuro y se oscurece en claro— pero además lleva una proporción DISTINTA
      // por modo, porque la misma proporción no se nota lo mismo en los dos.
      ".cm-lineNumbers .cm-gutterElement:has(.mic-num-rango)": {
        alignItems: "flex-start",
        paddingTop: "0.15em",
        background: "var(--mic-num-rango-fondo)",
        borderRadius: "var(--mic-radius-sm)",
      },
      ".cm-lineNumbers .mic-num-rango": {
        whiteSpace: "nowrap",
      },
    }),
  ];
}
