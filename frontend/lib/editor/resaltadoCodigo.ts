import { Compartment, type Extension } from "@codemirror/state";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { EditorView } from "@codemirror/view";
import { REGLAS_CODIGO } from "@/lib/editor/paletaSintaxis";

/**
 * Resaltado de sintaxis para los archivos de código del vault (`FUN-S-09`).
 *
 * El lenguaje sale del **nombre del archivo**, no de su contenido: es lo único
 * que se sabe con certeza antes de leerlo, y adivinarlo por heurística acierta
 * poco en los archivos cortos, que son la mayoría de los que se abren de paso.
 *
 * > [!important] La gramática se carga BAJO DEMANDA
 * > `@codemirror/language-data` no trae las gramáticas: trae una lista de
 * > descriptores con un `load()` que las importa. Un vault con un `.rs`, un
 * > `.py` y un `.go` no paga por los otros cuarenta lenguajes, y el bundle no
 * > crece por soportarlos. Por eso esto no puede ser una extensión a secas:
 * > cuando la gramática llega, la vista ya está montada, y hay que
 * > **reconfigurar** un compartimento en vez de recrearla.
 */

/** Los colores. Los mismos que dentro de una nota — ver `paletaSintaxis`. */
const resaltado = syntaxHighlighting(HighlightStyle.define(REGLAS_CODIGO));

/**
 * ¿Qué lenguaje le corresponde a este archivo, si alguno?
 *
 * Se busca por **nombre completo** y no solo por extensión: hay archivos que se
 * reconocen por cómo se llaman (`Dockerfile`, `Makefile`) y no tienen ninguna.
 */
export function lenguajeDeArchivo(nombre: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, nombre);
}

/**
 * Las extensiones de resaltado para un archivo, y el compartimento donde vive
 * su gramática.
 *
 * Devuelve la extensión lista para montar —con los colores ya puestos y la
 * gramática vacía— más una función que carga la gramática y la instala en la
 * vista. El llamador decide cuándo llamarla; si el componente se desmonta antes
 * de que llegue, la carga se descarta sola.
 */
export function resaltadoDeCodigo(nombre: string): {
  extension: Extension;
  cargar: (vista: EditorView) => () => void;
} {
  const compartimento = new Compartment();
  const desc = lenguajeDeArchivo(nombre);

  return {
    extension: [resaltado, compartimento.of([])],
    cargar(vista) {
      let vivo = true;
      if (desc !== null) {
        void desc
          .load()
          .then((soporte) => {
            // La vista puede haberse destruido mientras se cargaba: reconfigurar
            // una vista muerta tira, y aquí no habría nada que hacer con el
            // error salvo esconderlo.
            if (!vivo || vista.dom.isConnected === false) return;
            vista.dispatch({ effects: compartimento.reconfigure(soporte) });
          })
          // Una gramática que no carga deja el archivo en texto plano, que es
          // exactamente lo que se veía antes. No hay nada que avisar.
          .catch(() => {});
      }
      return () => {
        vivo = false;
      };
    },
  };
}
