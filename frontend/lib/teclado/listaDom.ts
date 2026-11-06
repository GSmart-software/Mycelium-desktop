/**
 * Flechas en las listas de los paneles (`FUN-XL-04`, Parte 7): resultados de la
 * búsqueda, Esporas, papelera, actividad y salud. Cada fila tiene uno o más
 * controles (un botón principal y sus acciones, una casilla); Tab los sigue
 * recorriendo todos, y además:
 *
 * - ↑ ↓ pasan a la fila de arriba o de abajo, al control de la misma columna
 *   (o al último, si esa fila tiene menos); Inicio / Fin, a la primera y a la
 *   última; RePág / AvPág, de a diez.
 * - ← → pasan entre los controles de la misma fila.
 *
 * Las filas se deducen de los controles: la fila de un control es su
 * antecesor más cercano que cumple `fila`. Con el foco en un campo de texto
 * no se hace nada (las flechas son del campo).
 */
import { pasoDeLista } from "./navegacion";

const SEL_CONTROL = [
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const visible = (el: HTMLElement) => el.getClientRects().length > 0 && !el.closest("[aria-hidden='true'], [inert]");

/** ¿Es un campo donde las flechas mueven el cursor? */
function esCampoDeTexto(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset"].includes(el.type);
  return (el as HTMLElement).isContentEditable;
}

/**
 * Atiende una tecla en una lista. `raiz` es el contenedor (el que escucha la
 * tecla); `fila`, el selector de una fila. `alSalirArriba`: qué hacer con ↑ en
 * la primera fila (la búsqueda vuelve a su campo). Devuelve si la atendió (y
 * entonces ya hizo `preventDefault`).
 */
export function navegarFilas(
  e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; preventDefault: () => void },
  raiz: HTMLElement,
  fila: string,
  alSalirArriba?: () => void,
): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  const activo = document.activeElement as HTMLElement | null;
  if (!activo || !raiz.contains(activo) || esCampoDeTexto(activo)) return false;

  const controles = [...raiz.querySelectorAll<HTMLElement>(SEL_CONTROL)].filter(visible);
  const filas: HTMLElement[] = [];
  const porFila = new Map<HTMLElement, HTMLElement[]>();
  for (const c of controles) {
    const f = c.closest<HTMLElement>(fila);
    if (!f || !raiz.contains(f)) continue;
    let lista = porFila.get(f);
    if (!lista) {
      lista = [];
      porFila.set(f, lista);
      filas.push(f);
    }
    lista.push(c);
  }
  const filaActual = activo.closest<HTMLElement>(fila);
  const propios = filaActual ? porFila.get(filaActual) : undefined;
  if (!filaActual || !propios) return false;
  const columna = Math.max(0, propios.indexOf(activo));

  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const j = columna + (e.key === "ArrowRight" ? 1 : -1);
    if (j < 0 || j >= propios.length) return false;
    e.preventDefault();
    propios[j].focus();
    return true;
  }

  const i = filas.indexOf(filaActual);
  if (e.key === "ArrowUp" && i === 0 && alSalirArriba) {
    e.preventDefault();
    alSalirArriba();
    return true;
  }
  const j = pasoDeLista(i, filas.length, e.key);
  if (j === null) return false;
  e.preventDefault();
  const destino = porFila.get(filas[j])!;
  destino[Math.min(columna, destino.length - 1)].focus();
  return true;
}

/** El primer control de una lista (↓ desde el campo de la búsqueda). */
export function primerControl(raiz: HTMLElement | null): HTMLElement | null {
  if (!raiz) return null;
  for (const el of raiz.querySelectorAll<HTMLElement>(SEL_CONTROL)) if (visible(el)) return el;
  return null;
}
