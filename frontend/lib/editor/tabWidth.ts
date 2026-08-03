import { indentUnit } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { anchoTabValido } from "@/stores/preferencesStore";

/**
 * Ancho de tabulación del editor (`FUN-S-02`).
 *
 * CodeMirror trata por separado las dos caras del asunto, y por defecto **no**
 * coinciden (`tabSize` = 4, `indentUnit` = 2 espacios):
 *
 * - `tabSize`: cuántas columnas ocupa un tabulador que YA está en el archivo.
 * - `indentUnit`: qué inserta la tecla Tab, vía el comando `indentWithTab`.
 *
 * Acá se fijan las dos con el mismo valor, que es lo que el usuario espera al
 * elegir "4 espacios": da igual si el tabulador lo escribió él o venía en el
 * archivo, ocupa lo mismo.
 *
 * Se indenta con **espacios**, no con tabuladores: el markdown de una lista
 * anidada se ve igual en cualquier visor, y evita mezclar ambos en un archivo
 * que después edita otra herramienta.
 */
export function extensionesTab(ancho: unknown): Extension {
  const n = anchoTabValido(ancho);
  return [EditorState.tabSize.of(n), indentUnit.of(" ".repeat(n))];
}
