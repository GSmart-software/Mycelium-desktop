import { foldService } from "@codemirror/language";

/**
 * Plegado de secciones por título markdown (estilo Obsidian): plegar un título
 * de cualquier nivel (#..######) oculta todo su contenido hasta el próximo
 * título de nivel igual o superior. Se aplica en edición en vivo y raw (mismo
 * EditorView) vía un foldService de CodeMirror, y en lectura sobre el DOM.
 */

const HEADING = /^(#{1,6})\s/;

/** Nivel del título ATX de una línea de texto (1..6), o 0 si no es título. */
function headingLevel(text: string): number {
  const m = HEADING.exec(text);
  return m ? m[1].length : 0;
}

/**
 * foldService de CodeMirror: para una línea de título devuelve el rango a
 * plegar (desde el fin de la línea del título hasta el fin de la sección),
 * dejando visible solo el título. Vale para raw y edición en vivo.
 */
export const headingFoldService = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const level = headingLevel(line.text);
  if (level === 0) return null;

  let end = line.to;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    const lvl = headingLevel(l.text);
    if (lvl > 0 && lvl <= level) break; // siguiente título hermano/superior
    end = l.to;
  }
  return end > line.to ? { from: line.to, to: end } : null;
});

const isHeading = (el: Element): boolean => /^H[1-6]$/.test(el.tagName);

/**
 * Plegado de títulos en la vista de lectura (DOM del preview ya renderizado).
 * Cada título recibe una flecha; al pulsarla se ocultan los elementos siguientes
 * hasta el próximo título de nivel igual o superior. El estado de plegado se
 * recalcula desde cero respetando el anidamiento.
 */
export function attachHeadingFolds(root: HTMLElement): void {
  // Las cabeceras cuelgan del div interno (dangerouslySetInnerHTML).
  const container = (root.querySelector(":scope > div") as HTMLElement | null) ?? root;
  const children = Array.from(container.children) as HTMLElement[];
  const collapsed = new Set<HTMLElement>();

  const apply = () => {
    let activeLevel = 0; // 0 = fuera de cualquier sección plegada
    for (const el of children) {
      if (isHeading(el)) {
        const lvl = Number(el.tagName[1]);
        if (activeLevel && lvl <= activeLevel) activeLevel = 0; // salimos de la región
        if (activeLevel) {
          el.classList.add("mic-fold-hidden");
        } else {
          el.classList.remove("mic-fold-hidden");
          el.classList.toggle("mic-collapsed", collapsed.has(el));
          if (collapsed.has(el)) activeLevel = lvl; // empieza una región plegada
        }
      } else {
        el.classList.toggle("mic-fold-hidden", activeLevel > 0);
      }
    }
  };

  for (const el of children) {
    if (!isHeading(el)) continue;
    if (el.querySelector(":scope > .mic-fold-arrow")) continue; // ya inicializado
    el.classList.add("mic-foldable");
    const arrow = document.createElement("span");
    arrow.className = "mic-fold-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.addEventListener("click", (e) => {
      e.stopPropagation();
      if (collapsed.has(el)) collapsed.delete(el);
      else collapsed.add(el);
      apply();
    });
    el.prepend(arrow);
  }
  apply();
}
