import { tags } from "@lezer/highlight";
import type { TagStyle } from "@codemirror/language";

/**
 * Cómo se colorea **código** en Mycelium (`FUN-S-09`).
 *
 * Una sola lista para los dos sitios donde se colorea código de **cualquier**
 * lenguaje: los bloques cercados dentro de una nota (`livePreview`) y los
 * archivos del vault (`VisorArchivo`). Vivía dentro del primero, y el visor iba
 * a ser la segunda copia.
 *
 * El editor de CSS personalizado (`cssExtensions`) conserva la suya, y no por
 * descuido: ahí los mismos tags significan otra cosa —`propertyName` es una
 * propiedad CSS, `className` un selector de clase, `atom` un valor como `flex`—
 * y unificarlos perdería justo lo que hace legible una hoja de estilos. Comparten
 * los tokens `--mic-syntax-*`, que es donde vive la coherencia.
 *
 * > [!important] Que el mismo código se vea igual en los tres sitios no es
 * > cosmética
 * > Un fragmento pegado en una nota y el archivo del que salió son lo mismo. Si
 * > una `keyword` es azul en un lado y verde en el otro, el lector deja de leer
 * > color y pasa a leer «esto es otra cosa» — que es justo lo contrario de lo
 * > que el resaltado existe para decir.
 *
 * Los colores salen de `--mic-syntax-*` (`tokens.css`), que ya tiene juego claro
 * y oscuro. No se fijan valores acá: un hex en este archivo sería un color que
 * no sabe en qué modo está.
 */
export const REGLAS_CODIGO: TagStyle[] = [
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--mic-syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.self,
      tags.null,
    ],
    color: "var(--mic-syntax-keyword)",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.escape],
    color: "var(--mic-syntax-string)",
  },
  { tag: [tags.number, tags.bool, tags.atom, tags.unit], color: "var(--mic-syntax-number)" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName],
    color: "var(--mic-syntax-keyword)",
  },
  { tag: [tags.variableName, tags.propertyName], color: "var(--mic-syntax-variable)" },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    color: "var(--mic-syntax-tag)",
  },
  { tag: [tags.attributeName], color: "var(--mic-syntax-property)" },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: "var(--mic-text-muted)" },
  // Lo que el lenguaje marca como inválido: se dice, no se disimula.
  { tag: tags.invalid, color: "var(--mic-syntax-id)" },
];
