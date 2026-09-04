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
 * Identidad ESTABLE de un título dentro del documento (`DEF-065`/`DEF-075`).
 *
 * Antes el conjunto de plegados guardaba los propios elementos `<h1>`…`<h6>`, y
 * eso los ataba a la vida del DOM. Cualquier cosa que reescribiera el HTML del
 * preview —un re-render por autoguardado, un cambio de pestaña— creaba nodos
 * NUEVOS, así que los guardados dejaban de estar en el contenedor y se
 * descartaban: el plegado se deshacía solo.
 *
 * La identidad es el nivel + el texto, y un contador para los títulos repetidos.
 * Sobrevive al re-render (el texto es el mismo), al cambio de pestaña, y también
 * a editar OTRA parte del documento —cosa que un índice posicional no aguanta,
 * porque agregar un título arriba correría todos los de abajo—. Si se renombra
 * el título, esa sección se despliega: es el precio, y es el caso raro.
 */
function claveDeTitulo(el: Element, vistos: Map<string, number>): string {
  const base = `${el.tagName}:${(el.textContent ?? "").trim()}`;
  const n = (vistos.get(base) ?? 0) + 1;
  vistos.set(base, n);
  return `${base}#${n}`;
}

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
 *
 * **El conjunto de plegados lo pone quien llama** (`DEF-065`): así este módulo no
 * guarda estado propio y la vida de ese estado la decide el que la conoce. En el
 * editor es la pestaña —sobrevive a cambiar de pestaña y muere al cerrarla—, que
 * es justo lo que el defecto pedía.
 */
export function attachHeadingFolds(root: HTMLElement, plegados: Set<string>): void {
  // Las cabeceras cuelgan del div de contenido (`.mic-preview-body`), NO del div
  // opcional del título del documento (`.mic-doc-title`), que es el primer hijo
  // cuando "mostrar título" está activo. Apuntar al `:scope > div` genérico
  // agarraba el título y no encontraba ningún H → no aparecían las flechas.
  const container =
    (root.querySelector(":scope > .mic-preview-body") as HTMLElement | null) ??
    (root.querySelector(":scope > div:not(.mic-doc-title)") as HTMLElement | null) ??
    root;
  const children = Array.from(container.children) as HTMLElement[];

  // La clave de cada título del render de AHORA. Se calcula una vez y se reusa,
  // porque el contador de repetidos depende del orden de recorrido.
  const claves = new Map<HTMLElement, string>();
  const vistos = new Map<string, number>();
  for (const el of children) {
    if (isHeading(el)) claves.set(el, claveDeTitulo(el, vistos));
  }

  const estaPlegado = (el: HTMLElement) => plegados.has(claves.get(el) ?? "");

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
          el.classList.toggle("mic-collapsed", estaPlegado(el));
          if (estaPlegado(el)) activeLevel = lvl; // empieza una región plegada
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
      const clave = claves.get(el);
      if (clave === undefined) return;
      if (plegados.has(clave)) plegados.delete(clave);
      else plegados.add(clave);
      apply();
    });
    el.prepend(arrow);
  }
  apply();
}
