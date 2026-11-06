/**
 * Saltar tecleando en una lista, sobre el DOM (`FUN-XL-04`, rediseño del
 * 2026-11-06). La lógica —qué se acumula, adónde se salta— está en
 * `tecleo.ts`; acá se reconoce la lista del foco, se leen los nombres y se
 * mueve el foco. Lo llama `useTecladoZonas` en cada tecla (en burbuja, después
 * de que los componentes atiendan las suyas).
 *
 * Las listas que se reconocen:
 * - el árbol del explorador (`[role='tree']` con sus `treeitem`);
 * - las filas del cuerpo de una tabla `.base` (`tbody tr`);
 * - las listas de los paneles marcadas con `data-lista="<selector de fila>"`
 *   (resultados de la búsqueda, Esporas, papelera, actividad, salud): el foco
 *   va al primer control de la fila.
 */
import { acumularTecleo, saltoPorTecleo, type Tecleo } from "./tecleo";

const visible = (el: HTMLElement) => el.getClientRects().length > 0 && !el.closest("[aria-hidden='true'], [inert]");

const SEL_CONTROL = "button:not([disabled]), a[href], input:not([disabled]):not([type='hidden']), [tabindex]";

/** ¿Las teclas escriben ahí? (Un campo, el editor, la consola, un dibujo.) */
function escribeAhi(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset"].includes(el.type);
  return el.isContentEditable || el.closest(".cm-editor, .xterm, .excalidraw") !== null;
}

type Lista = { destinos: HTMLElement[]; nombres: string[]; actual: number };

const nombreDe = (el: HTMLElement) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();

/** La lista del elemento enfocado, o `null` si no está en una. */
function listaDe(foco: HTMLElement): Lista | null {
  // El árbol: las filas mismas.
  if (foco.getAttribute("role") === "treeitem") {
    const arbol = foco.closest<HTMLElement>("[role='tree']") ?? foco.parentElement;
    if (!arbol) return null;
    const filas = [...arbol.querySelectorAll<HTMLElement>("[role='treeitem']")].filter(visible);
    return { destinos: filas, nombres: filas.map(nombreDe), actual: filas.indexOf(foco) };
  }
  // Las filas de una tabla.
  const fila = foco.closest<HTMLElement>("tbody tr[tabindex]");
  if (fila && fila === foco) {
    const filas = [...(fila.parentElement?.children ?? [])].filter(
      (f): f is HTMLElement => f instanceof HTMLElement && f.hasAttribute("tabindex") && visible(f),
    );
    return { destinos: filas, nombres: filas.map((f) => f.textContent ?? ""), actual: filas.indexOf(fila) };
  }
  // Las listas de los paneles.
  const lista = foco.closest<HTMLElement>("[data-lista]");
  const selFila = lista?.dataset.lista;
  if (!lista || !selFila) return null;
  const filas = [...lista.querySelectorAll<HTMLElement>(selFila)].filter(visible);
  const destinos: HTMLElement[] = [];
  const nombres: string[] = [];
  let actual = -1;
  for (const f of filas) {
    const control = f.matches(SEL_CONTROL) ? f : [...f.querySelectorAll<HTMLElement>(SEL_CONTROL)].find(visible);
    if (!control) continue;
    if (f.contains(foco)) actual = destinos.length;
    destinos.push(control);
    nombres.push(f.textContent ?? "");
  }
  return destinos.length ? { destinos, nombres, actual } : null;
}

let tecleo: Tecleo | null = null;

/**
 * Atiende una tecla: si es una letra (o un número) sin Ctrl ni Alt, con el
 * foco en un elemento de una lista y no en un campo, salta al siguiente cuyo
 * nombre empieza con lo tecleado. Devuelve si la usó.
 */
export function atenderTecleo(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return false;
  if ([...e.key].length !== 1 || e.key === " ") return false;
  const foco = document.activeElement;
  if (!(foco instanceof HTMLElement) || escribeAhi(foco)) return false;
  const lista = listaDe(foco);
  if (!lista) return false;
  tecleo = acumularTecleo(tecleo, e.key, Date.now());
  e.preventDefault();
  const i = saltoPorTecleo(lista.nombres, lista.actual, tecleo.texto);
  if (i !== null && i !== lista.actual) {
    lista.destinos[i].focus();
    lista.destinos[i].scrollIntoView({ block: "nearest" });
  }
  return true;
}
