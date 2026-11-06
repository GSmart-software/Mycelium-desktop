/**
 * Las teclas que la consola deja pasar a la app (`FUN-XL-04`, Parte 2).
 *
 * xterm se queda con casi todo el teclado (cancela con `stopPropagation`
 * Ctrl+letra, Tab, Esc y las F), así que con el foco en una consola los atajos
 * globales no llegaban: era una trampa de foco. El filtro de teclas de
 * `lib/terminal.ts` deja pasar estas —xterm no las procesa y siguen hasta el
 * despachador del workspace— y la shell ya no las recibe.
 *
 * **Es la única lista**, para que la Parte 3 (atajos configurables) la vuelva
 * editable desde un solo lugar. Lógica pura: la prueba `scripts/test-teclado-zonas.mjs`.
 *
 * Lo que **no** está, a propósito, porque es de la shell:
 * - **Ctrl+W** (borra la palabra anterior en bash, readline y PSReadLine) y
 *   **Ctrl+Shift+T**: para cerrar una consola con el teclado, F6 y Ctrl+W
 *   desde la barra de pestañas o el documento seleccionado.
 * - **Ctrl+C / Ctrl+V**: copiar y pegar, que el filtro atiende aparte.
 * - **Esc**: lo usan vim, less y la línea de comandos. De la consola se sale con F6.
 *
 * Ctrl+P le quita a la shell su `^P` (comando anterior; queda la flecha ↑):
 * se deja pasar porque es la paleta, el atajo más usado de la app. Si
 * molesta, la Parte 3 la hará configurable.
 */
import { coincide, type Atajo, type EventoTecla } from "./atajos";

export const TECLAS_QUE_SALEN_DE_LA_CONSOLA: readonly { atajo: Atajo; para: string }[] = [
  { atajo: { code: "F6" }, para: "zona.siguiente" },
  { atajo: { shift: true, code: "F6" }, para: "zona.anterior" },
  { atajo: { code: "F1" }, para: "ayuda.abrir" },
  { atajo: { ctrl: true, code: "KeyP" }, para: "paleta.comandos" },
  { atajo: { ctrl: true, shift: true, code: "KeyP" }, para: "paleta.comandos" },
  { atajo: { ctrl: true, code: "KeyO" }, para: "paleta.notas" },
  { atajo: { ctrl: true, code: "Tab" }, para: "pestana.siguiente" },
  { atajo: { ctrl: true, shift: true, code: "Tab" }, para: "pestana.anterior" },
  { atajo: { ctrl: true, code: "Backslash" }, para: "panel-izquierdo.alternar" },
  { atajo: { ctrl: true, code: "Comma" }, para: "configuracion.abrir" },
  { atajo: { ctrl: true, alt: true, code: "ArrowLeft" }, para: "panel.izquierda" },
  { atajo: { ctrl: true, alt: true, code: "ArrowRight" }, para: "panel.derecha" },
];

/** ¿Esta tecla, pulsada en una consola, es de la app y no de la shell? */
export function teclaSaleDeLaConsola(e: EventoTecla): boolean {
  return TECLAS_QUE_SALEN_DE_LA_CONSOLA.some((t) => coincide(t.atajo, e));
}
