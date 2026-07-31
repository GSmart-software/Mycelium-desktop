import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { allLeaves, useTabsStore } from "@/stores/tabsStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";

/**
 * Gestor de la terminal integrada (FUN-L-07, solo-desktop). Las instancias xterm
 * viven AQUÍ (nivel de módulo), no en el componente: mover la pestaña de panel
 * remonta el componente React, pero la sesión (xterm + PTY) debe sobrevivir
 * (CA2). El componente solo adjunta/desadjunta el DOM de su instancia.
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
/** Terminales creadas en ESTA corrida (las demás son restauradas de la sesión previa). */
const creadasEstaCorrida = new Set<string>();
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
  if (!creadasEstaCorrida.has(termId) && prefs.restaurarScrollback && sesion?.scrollback) {
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
 * Crea una terminal nueva y la abre como pestaña del workspace (CA1/CA4).
 * Devuelve el id de pestaña para sincronizar la URL.
 */
export function crearTerminal(opts: { shellId?: string; cwd?: string } = {}): string {
  const termId = crypto.randomUUID();
  creadasEstaCorrida.add(termId);
  useTerminalStore.getState().registrar(termId, {
    shellId: opts.shellId ?? null,
    cwd: opts.cwd ?? null,
  });
  const tabId = tabIdDe(termId);
  useTabsStore.getState().openNote(tabId);
  ensureInfra();
  return tabId;
}

/** ¿Esta terminal fue creada en esta corrida (no restaurada)? */
export const esNuevaEstaCorrida = (termId: string) => creadasEstaCorrida.has(termId);

/** Cierra la sesión completa: PTY, instancia xterm y registro persistido. */
function destruirSesion(termId: string) {
  void invoke("terminal_cerrar", { id: termId }).catch(() => {});
  const inst = instancias.get(termId);
  if (inst) {
    inst.term.dispose();
    instancias.delete(termId);
  }
  useTerminalStore.getState().cerrar(termId);
}

/** Cierra la pestaña (si existe) y la sesión: para `exit` del proceso (CA7). */
export function cerrarTerminalCompleta(termId: string) {
  useTabsStore.getState().closeNotaEverywhere(tabIdDe(termId));
  destruirSesion(termId);
}

/** Ids de terminal presentes en el árbol de panes. */
function terminalesEnTabs(): Set<string> {
  const ids = new Set<string>();
  for (const leaf of allLeaves(useTabsStore.getState().root)) {
    for (const tab of leaf.tabs) {
      if (esTabTerminal(tab.notaId)) ids.add(termIdDe(tab.notaId));
    }
  }
  return ids;
}

/**
 * Infraestructura global (una sola vez): enrutado de eventos PTY → xterm,
 * watcher "pestaña cerrada → matar PTY" y volcado del scrollback al salir.
 */
function ensureInfra() {
  if (infraLista) return;
  infraLista = true;

  // Salida del PTY → xterm de la instancia correspondiente.
  void listen<{ id: string; datos: string }>("terminal-datos", (e) => {
    instancias.get(e.payload.id)?.term.write(e.payload.datos);
  });

  // Proceso terminado (p. ej. `exit`) → cerrar la pestaña sola (CA7).
  void listen<{ id: string }>("terminal-salida", (e) => {
    const inst = instancias.get(e.payload.id);
    if (!inst) return;
    cerrarTerminalCompleta(e.payload.id);
  });

  // Pestaña de terminal cerrada por el usuario → matar el PTY (CA7). También
  // limpia sesiones persistidas huérfanas (sin pestaña) al primer disparo.
  useTabsStore.subscribe(() => {
    const abiertas = terminalesEnTabs();
    for (const termId of Object.keys(useTerminalStore.getState().sesiones)) {
      if (!abiertas.has(termId)) destruirSesion(termId);
    }
  });

  // Al cerrar la app: volcar el scrollback de cada terminal para poder
  // restaurarlo (CA6). zustand/persist escribe síncrono en localStorage.
  window.addEventListener("beforeunload", () => {
    const { prefs, guardarScrollback } = useTerminalStore.getState();
    if (!prefs.restaurarSesiones || !prefs.restaurarScrollback) return;
    for (const [termId, inst] of instancias) {
      try {
        guardarScrollback(termId, inst.serialize.serialize({ scrollback: 200 }));
      } catch {
        // serializar es best-effort
      }
    }
  });
}
