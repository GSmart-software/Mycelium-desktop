/**
 * Las teclas que la consola deja pasar a la app (`FUN-XL-04`, Parte 2; desde
 * la Parte 3, configurables).
 *
 * xterm se queda con casi todo el teclado (cancela con `stopPropagation`
 * Ctrl+letra, Tab, Esc y las F), así que con el foco en una consola los atajos
 * globales no llegaban: era una trampa de foco. El filtro de teclas de
 * `lib/terminal.ts` deja pasar estas —xterm no las procesa y siguen hasta el
 * despachador del workspace— y la shell ya no las recibe.
 *
 * `TECLAS_QUE_SALEN_DE_LA_CONSOLA` es la lista **de fábrica**. En
 * Configuración → Atajos de teclado el usuario prende o apaga cada atajo de
 * cada comando (`PrefsConsola`, guardadas con los atajos en
 * `preferenciasAtajos.ts`): por ejemplo, devolverle Ctrl+P a la shell o dejar
 * que Ctrl+W cierre la consola. F6 y Shift+F6 no se pueden apagar: son la
 * salida; tampoco las pistas (F10), que como F6 se atienden en captura, antes
 * que la consola. Si el usuario cambia el atajo de un comando que sale de la consola,
 * el atajo nuevo también sale.
 *
 * Lo que **no** sale de fábrica, a propósito, porque es de la shell:
 * - **Ctrl+W** (borra la palabra anterior en bash, readline y PSReadLine) y
 *   **Ctrl+Shift+T**: para cerrar una consola con el teclado, F6 y Ctrl+W
 *   desde la barra de pestañas o el documento seleccionado.
 * - **Ctrl+C / Ctrl+V**: copiar y pegar, que el filtro atiende aparte.
 * - **Esc**: lo usan vim, less y la línea de comandos. De la consola se sale con F6.
 *
 * Ctrl+P le quita a la shell su `^P` (comando anterior; queda la flecha ↑):
 * sale de fábrica porque es la paleta, el atajo más usado de la app.
 *
 * Lógica pura salvo por el estado de las preferencias: la prueban
 * `scripts/test-teclado-zonas.mjs` y `scripts/test-atajos.mjs`.
 */
import { claveAtajo, coincide, mismoAtajo, type Atajo, type EventoTecla } from "./atajos";
import { efectivosDe, listarComandos, type Comando } from "./registro";

export const TECLAS_QUE_SALEN_DE_LA_CONSOLA: readonly { atajo: Atajo; para: string }[] = [
  { atajo: { code: "F6" }, para: "zona.siguiente" },
  { atajo: { shift: true, code: "F6" }, para: "zona.anterior" },
  { atajo: { code: "F10" }, para: "pistas.mostrar" },
  { atajo: { code: "F1" }, para: "ayuda.abrir" },
  { atajo: { ctrl: true, code: "KeyP" }, para: "paleta.comandos" },
  { atajo: { ctrl: true, shift: true, code: "KeyP" }, para: "paleta.comandos" },
  { atajo: { ctrl: true, code: "KeyO" }, para: "paleta.notas" },
  { atajo: { ctrl: true, code: "Tab" }, para: "pestana.siguiente" },
  { atajo: { ctrl: true, shift: true, code: "Tab" }, para: "pestana.anterior" },
  { atajo: { ctrl: true, code: "Backslash" }, para: "panel-izquierdo.alternar" },
  { atajo: { ctrl: true, code: "Comma" }, para: "configuracion.abrir" },
  { atajo: { ctrl: true, code: "Numpad1" }, para: "zona.rail" },
  { atajo: { ctrl: true, code: "Numpad2" }, para: "zona.izquierda" },
  { atajo: { ctrl: true, code: "Numpad3" }, para: "zona.pestanas" },
  { atajo: { ctrl: true, code: "Numpad4" }, para: "zona.enlaces" },
  { atajo: { ctrl: true, code: "Numpad5" }, para: "zona.estado" },
  { atajo: { ctrl: true, shift: true, code: "Slash" }, para: "atajos.hoja" },
];

/** Los comandos que siempre salen de la consola: la salida misma y las pistas (en captura). */
export const FIJOS_EN_LA_CONSOLA: ReadonlySet<string> = new Set(["zona.siguiente", "zona.anterior", "pistas.mostrar"]);

/** Lo que el usuario decidió por cada fila: `clave de la fila → sale`. Lo que falta, de fábrica. */
export type PrefsConsola = Readonly<Record<string, boolean>>;

/** La clave de una fila: el comando y el atajo. */
export const claveFilaConsola = (id: string, atajo: Atajo) => `${id}|${claveAtajo(atajo)}`;

/** Lo que venga de `localStorage` → preferencias válidas. */
export function normalizarPrefsConsola(crudo: unknown): PrefsConsola {
  if (crudo === null || typeof crudo !== "object" || Array.isArray(crudo)) return {};
  const salida: Record<string, boolean> = {};
  for (const [clave, v] of Object.entries(crudo as Record<string, unknown>)) {
    if (typeof v === "boolean" && /^[a-z][a-z0-9.-]*\|[A-Za-z0-9+]+$/.test(clave)) salida[clave] = v;
  }
  return salida;
}

export type FilaConsola = {
  id: string;
  atajo: Atajo;
  clave: string;
  /** F6 y Shift+F6: siempre salen. */
  fija: boolean;
  porDefecto: boolean;
  sale: boolean;
};

/**
 * Las filas de la lista de Configuración: cada atajo de hoy de cada comando,
 * con si sale de la consola. `comandos` son los visibles (sin los de
 * desarrollador si el modo está apagado). Los de manejador propio que no están
 * en la lista de fábrica no se ofrecen: escuchan su tecla antes que la
 * consola, en captura, y ya llegan siempre.
 */
export function filasConsola(
  comandos: readonly Comando[],
  porId: ReadonlyMap<string, readonly Atajo[]>,
  prefs: PrefsConsola,
): FilaConsola[] {
  const filas: FilaConsola[] = [];
  for (const c of comandos) {
    const deFabrica = TECLAS_QUE_SALEN_DE_LA_CONSOLA.filter((t) => t.para === c.id);
    if (c.manejadorPropio && deFabrica.length === 0) continue;
    for (const atajo of porId.get(c.id) ?? c.atajos ?? []) {
      const fija = FIJOS_EN_LA_CONSOLA.has(c.id);
      const esDeFabrica = (c.atajos ?? []).some((a) => mismoAtajo(a, atajo));
      // Un atajo que el usuario le dio a un comando que sale de fábrica, sale también.
      const porDefecto =
        fija || deFabrica.some((t) => mismoAtajo(t.atajo, atajo)) || (!esDeFabrica && deFabrica.length > 0);
      const clave = claveFilaConsola(c.id, atajo);
      filas.push({ id: c.id, atajo, clave, fija, porDefecto, sale: fija || (prefs[clave] ?? porDefecto) });
    }
  }
  return filas;
}

// ── el estado ──────────────────────────────────────────────────────────────

let prefsConsola: PrefsConsola = {};

/** Las preferencias en uso (las fija `preferenciasAtajos.ts`). */
export const prefsConsolaActuales = () => prefsConsola;

export function fijarPrefsConsola(p: PrefsConsola) {
  prefsConsola = p;
}

/**
 * ¿Esta tecla, pulsada en una consola, es de la app y no de la shell? Con los
 * comandos registrados, según sus atajos de hoy y las preferencias; sin
 * comandos (fuera del workspace, o en una prueba), la lista de fábrica.
 */
export function teclaSaleDeLaConsola(e: EventoTecla): boolean {
  const comandos = listarComandos();
  if (comandos.length === 0) return TECLAS_QUE_SALEN_DE_LA_CONSOLA.some((t) => coincide(t.atajo, e));
  return filasConsola(comandos, efectivosDe(comandos).porId, prefsConsola).some(
    (f) => f.sale && coincide(f.atajo, e),
  );
}
