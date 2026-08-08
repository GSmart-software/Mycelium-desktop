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
 * Qué secciones están plegadas, POR CONTENEDOR y fuera de la función (DEF-050).
 *
 * Antes vivía dentro de `attachHeadingFolds`, así que cada llamada empezaba con un
 * conjunto vacío: reejecutarla reseteaba el plegado y dejaba a los manejadores de
 * clic viejos apuntando a un conjunto huérfano. Eso volvía la función insegura de
 * repetir, justo lo que hace falta para que las flechas se puedan recuperar solas.
 *
 * `WeakMap` y no `Map`: la clave es un nodo del DOM y no debe impedir que se libere
 * cuando la nota se cierra.
 */
const plegadasPorContenedor = new WeakMap<HTMLElement, Set<HTMLElement>>();

/**
 * Plegado de títulos en la vista de lectura (DOM del preview ya renderizado).
 * Cada título recibe una flecha; al pulsarla se ocultan los elementos siguientes
 * hasta el próximo título de nivel igual o superior.
 *
 * **Es idempotente y se puede llamar tras cada render** (DEF-050): salta los títulos
 * que ya tienen flecha y conserva qué había plegado. Hace falta que lo sea porque
 * las flechas se inyectan en el DOM *después* de que React lo pinte, así que
 * cualquier cosa que reescriba el HTML del preview se las lleva por delante — y el
 * usuario lo veía al cambiar una preferencia, que re-renderiza el editor sin que
 * cambie el contenido.
 */
export function attachHeadingFolds(root: HTMLElement): void {
  // Las cabeceras cuelgan del div de contenido (`.mic-preview-body`), NO del div
  // opcional del título del documento (`.mic-doc-title`), que es el primer hijo
  // cuando "mostrar título" está activo. Apuntar al `:scope > div` genérico
  // agarraba el título y no encontraba ningún H → no aparecían las flechas.
  const container =
    (root.querySelector(":scope > .mic-preview-body") as HTMLElement | null) ??
    (root.querySelector(":scope > div:not(.mic-doc-title)") as HTMLElement | null) ??
    root;
  const children = Array.from(container.children) as HTMLElement[];
  let collapsed = plegadasPorContenedor.get(container);
  if (!collapsed) {
    collapsed = new Set<HTMLElement>();
    plegadasPorContenedor.set(container, collapsed);
  }
  // Si el HTML se reescribió, los títulos son nodos NUEVOS y los viejos que
  // quedaron marcados ya no cuelgan de nada: se descartan para no retenerlos.
  for (const el of collapsed) {
    if (!container.contains(el)) collapsed.delete(el);
  }

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
