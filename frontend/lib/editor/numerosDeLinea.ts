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
 * `lineNumberWidgetMarker` existe justo para eso. Acá se le da el número de la
 * **primera línea** del bloque, que es donde empieza la tabla en el archivo: es
 * el número que sirve para ubicarse, y es lo mismo que muestra un editor cuando
 * pliega una región.
 */

/** El número de una línea, con la pinta de los demás del margen. */
class MarcaNumero extends GutterMarker {
  constructor(private readonly numero: number) {
    super();
  }

  /** Sin esto CodeMirror rehace el DOM del margen en cada medición. */
  eq(otra: MarcaNumero) {
    return otra.numero === this.numero;
  }

  toDOM() {
    return document.createTextNode(String(this.numero));
  }
}

export function numerosDeLineaExt(): Extension {
  return [
    lineNumbers(),
    lineNumberWidgetMarker.of((view, _widget, bloque) => {
      // `bloque.from` es el arranque del rango que el widget reemplaza, así que
      // esta es la línea donde empieza la tabla en el documento.
      const linea = view.state.doc.lineAt(bloque.from).number;
      return new MarcaNumero(linea);
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
    }),
  ];
}
