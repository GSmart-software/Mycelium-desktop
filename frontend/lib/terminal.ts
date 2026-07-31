import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSidebarViewerStore } from "@/stores/sidebarViewerStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";

/**
 * Gestor de la terminal integrada (FUN-L-07, solo-desktop). Las instancias xterm
 * viven AQUÍ (nivel de módulo), no en el componente: mover la pestaña de panel
 * remonta el componente React, pero la sesión (xterm + PTY) debe sobrevivir
 * (CA2). El componente solo adjunta/desadjunta el DOM de su instancia.
 *
 * Ciclo de vida (panel de consolas): cerrar la PESTAÑA de una consola solo la
 * oculta — el shell sigue corriendo de fondo y puede reabrirse desde el panel.
 * El shell termina únicamente al FINALIZARLO desde el panel (o si el proceso
 * muere solo, p. ej. con `exit`).
 */

/** Prefijo de las pestañas de terminal en el tabsStore (patrón `graph:global`). */
export const TERMINAL_TAB_PREFIX = "terminal:";

export type ShellInfo = { id: string; nombre: string; ruta: string };

type Instancia = {
  term: Terminal;
  fit: FitAddon;
  serialize: SerializeAddon;
  /** true cuando el PTY de Rust ya está corriendo. */
  ptyAbierto: boolean;
};

const instancias = new Map<string, Instancia>();
/** Creadas NUEVAS en esta corrida (no restauradas): no replayean scrollback. */
const nuevasEstaCorrida = new Set<string>();
/** Abiertas por el usuario en esta corrida (creadas o reabiertas desde el panel). */
const tocadasEstaCorrida = new Set<string>();
let infraLista = false;
let shellsCache: ShellInfo[] | null = null;

/** Id de pestaña ↔ id de terminal. */
export const tabIdDe = (termId: string) => `${TERMINAL_TAB_PREFIX}${termId}`;
export const termIdDe = (tabId: string) => tabId.slice(TERMINAL_TAB_PREFIX.length);
export const esTabTerminal = (tabId: string) => tabId.startsWith(TERMINAL_TAB_PREFIX);

/** Shells detectadas en el sistema (cacheado; no cambian durante la corrida). */
export async function listarShells(): Promise<ShellInfo[]> {
  if (!shellsCache) shellsCache = await invoke<ShellInfo[]>("terminal_shells");
  return shellsCache;
}

/** ¿El PTY de esta consola está corriendo en esta corrida? */
export function estaCorriendo(termId: string): boolean {
  return instancias.get(termId)?.ptyAbierto === true;
}

/** Tema del xterm a partir de los tokens CSS activos de Mycelium. */
function temaXterm() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--mic-bg-canvas", "#1b1305"),
    foreground: v("--mic-text-primary", "#f6e8c8"),
    cursor: v("--mic-accent", "#c77f2e"),
    selectionBackground: "rgba(127, 127, 127, 0.35)",
  };
}

/** Instancia xterm de una terminal (se crea una única vez por sesión). */
export function getInstancia(termId: string): Instancia {
  let inst = instancias.get(termId);
  if (inst) return inst;

  const term = new Terminal({
    fontFamily: "'JetBrains Mono', Consolas, monospace",
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    theme: temaXterm(),
  });
  const fit = new FitAddon();
  const serialize = new SerializeAddon();
  term.loadAddon(fit);
  term.loadAddon(serialize);

  // Teclas del usuario → PTY.
  term.onData((datos) => {
    void invoke("terminal_escribir", { id: termId, datos }).catch(() => {});
  });

  inst = { term, fit, serialize, ptyAbierto: false };
  instancias.set(termId, inst);
  ensureInfra();
  return inst;
}

/**
 * Arranca el PTY de una instancia (idempotente). Resuelve la shell (la de la
 * sesión → la por defecto → la primera detectada) y el cwd (el de la sesión →
 * la raíz del vault → el home, resuelto en Rust).
 */
export async function abrirPty(termId: string): Promise<void> {
  const inst = getInstancia(termId);
  if (inst.ptyAbierto) return;
  inst.ptyAbierto = true;

  const { sesiones, prefs } = useTerminalStore.getState();
  const sesion = sesiones[termId];

  // Historial de la sesión anterior (restauración, CA6) antes de la shell nueva.
  if (!nuevasEstaCorrida.has(termId) && prefs.restaurarScrollback && sesion?.scrollback) {
    inst.term.write(sesion.scrollback);
    inst.term.write("\r\n\x1b[2m── sesión anterior restaurada ──\x1b[0m\r\n");
  }

  const shells = await listarShells();
  if (shells.length === 0) {
    inst.term.write("\x1b[31mNo se detectó ninguna shell en el sistema.\x1b[0m\r\n");
    return;
  }
  const elegida =
    shells.find((s) => s.id === sesion?.shellId) ??
    shells.find((s) => s.id === prefs.shellPorDefecto) ??
    shells[0];

  const cwd = sesion?.cwd ?? useVaultSessionStore.getState().rutaActual ?? null;

  try {
    await invoke("terminal_abrir", {
      id: termId,
      shell: elegida.ruta,
      cwd,
      cols: inst.term.cols,
      rows: inst.term.rows,
    });
  } catch (error) {
    inst.term.write(`\x1b[31m${String(error)}\x1b[0m\r\n`);
  }
}

/**
 * Crea una consola nueva y la abre como pestaña del workspace (CA1/CA4).
 * Devuelve el id de pestaña para sincronizar la URL.
 */
export function crearTerminal(opts: { shellId?: string; cwd?: string } = {}): string {
  const termId = crypto.randomUUID();
  nuevasEstaCorrida.add(termId);
  tocadasEstaCorrida.add(termId);
  useTerminalStore.getState().registrar(termId, {
    shellId: opts.shellId ?? null,
    cwd: opts.cwd ?? null,
  });
  const tabId = tabIdDe(termId);
  useTabsStore.getState().openNote(tabId);
  ensureInfra();
  return tabId;
}

/**
 * Abre (o enfoca) la pestaña de una consola existente desde el panel de
 * consolas. Si está anclada en el visor del explorador, la activa allí.
 */
export function abrirConsola(termId: string): string {
  tocadasEstaCorrida.add(termId);
  ensureInfra();
  const tabId = tabIdDe(termId);
  const dock = useSidebarViewerStore.getState();
  if (dock.tabs.includes(tabId)) {
    dock.activar(tabId);
  } else {
    useTabsStore.getState().openNote(tabId);
  }
  return tabId;
}

/**
 * FINALIZA una consola (panel de consolas o `exit` del proceso): mata el PTY,
 * descarta la instancia xterm, cierra sus pestañas (workspace y visor del
 * explorador) y elimina su registro.
 */
export function finalizarConsola(termId: string) {
  ocultarPestanas(termId);
  void invoke("terminal_cerrar", { id: termId }).catch(() => {});
  const inst = instancias.get(termId);
  if (inst) {
    inst.term.dispose();
    instancias.delete(termId);
  }
  nuevasEstaCorrida.delete(termId);
  tocadasEstaCorrida.delete(termId);
  useTerminalStore.getState().cerrar(termId);
}

/** Cierra las pestañas de una consola SIN finalizarla (ocultar). */
export function ocultarPestanas(termId: string) {
  const tabId = tabIdDe(termId);
  useTabsStore.getState().closeNotaEverywhere(tabId);
  const dock = useSidebarViewerStore.getState();
  if (dock.tabs.includes(tabId)) dock.cerrar(tabId);
}

/** ¿Esta consola fue abierta/creada por el usuario en esta corrida? */
export const fueTocadaEstaCorrida = (termId: string) => tocadasEstaCorrida.has(termId);

/**
 * Infraestructura global (una sola vez): enrutado de eventos PTY → xterm,
 * fin de proceso y volcado del scrollback al salir. Cerrar una pestaña NO pasa
 * por aquí: solo oculta la consola (el PTY sigue vivo hasta finalizarla).
 */
function ensureInfra() {
  if (infraLista) return;
  infraLista = true;

  // Salida del PTY → xterm de la instancia correspondiente.
  void listen<{ id: string; datos: string }>("terminal-datos", (e) => {
    instancias.get(e.payload.id)?.term.write(e.payload.datos);
  });

  // Proceso terminado por sí mismo (p. ej. `exit`) → finalizar la consola (CA7).
  void listen<{ id: string }>("terminal-salida", (e) => {
    if (instancias.has(e.payload.id)) finalizarConsola(e.payload.id);
  });

  // Cambio de tema/modo oscuro de Mycelium (data-theme/data-dark en <html>):
  // re-aplicar los colores a todas las consolas vivas (el tema del xterm se fija
  // al crear la instancia y no sigue las variables CSS por sí solo).
  const observerTema = new MutationObserver(() => {
    const tema = temaXterm();
    for (const inst of instancias.values()) {
      inst.term.options.theme = tema;
    }
  });
  observerTema.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-dark"],
  });

  // Al cerrar la app: volcar el scrollback de cada consola para poder
  // restaurarlo (CA6). zustand/persist escribe síncrono en localStorage.
  window.addEventListener("beforeunload", () => {
    const { prefs, guardarScrollback } = useTerminalStore.getState();
    if (!prefs.restaurarScrollback) return;
    for (const [termId, inst] of instancias) {
      try {
        guardarScrollback(termId, inst.serialize.serialize({ scrollback: 200 }));
      } catch {
        // serializar es best-effort
      }
    }
  });
}
