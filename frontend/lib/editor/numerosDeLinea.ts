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
 * líneas que el bloque abarca**: la primera arriba y la última abajo, pegadas a
 * los bordes del bloque. Así se lee de un vistazo desde dónde hasta dónde va la
 * tabla en el archivo.
 *
 * > [!important] Por qué NO va como «34–40» en una línea
 * > El ancho del margen lo fija el número más largo de lo que hay **a la
 * > vista**. Un rango en una sola línea es más ancho que cualquier número, así
 * > que el margen se ensancharía al entrar una tabla en pantalla y se angostaría
 * > al salir: el texto saltaría de lado mientras se hace scroll. Repartidos en
 * > los dos extremos ocupan el ancho de un número normal y el margen no se
 * > mueve nunca.
 *
 * Alinear un número por FILA es otra cosa y no se puede desde acá: el margen
 * admite **una sola marca por bloque**, y además las filas no se corresponden
 * una a una con las líneas —el `|---|` de una tabla es una línea del archivo que
 * no dibuja ninguna fila—. Eso solo podría hacerlo el propio widget.
 */

/**
 * Las líneas que abarca un bloque renderizado: la primera arriba y la última
 * abajo. Si el bloque cubre una sola línea, se muestra una sola.
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
    const caja = document.createElement("div");
    caja.className = "mic-num-rango";
    const primera = document.createElement("span");
    primera.textContent = String(this.desde);
    caja.append(primera);
    if (this.hasta > this.desde) {
      const ultima = document.createElement("span");
      ultima.textContent = String(this.hasta);
      caja.append(ultima);
    }
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
      // El rango de un bloque ocupa su alto entero y manda cada número a un
      // borde. `align-items: center` de arriba lo centraría como si fuera un
      // número suelto, que es justo lo que se veía mal.
      ".cm-lineNumbers .cm-gutterElement:has(.mic-num-rango)": {
        alignItems: "stretch",
      },
      ".cm-lineNumbers .mic-num-rango": {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        alignItems: "flex-end",
        width: "100%",
        height: "100%",
        padding: "0.15em 0",
      },
    }),
  ];
}
