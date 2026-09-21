import { invoke } from "@tauri-apps/api/core";

/**
 * Lo de la terminal integrada (FUN-L-07) que NO necesita xterm: reconocer una
 * pestaña de consola y listar las shells. Vive aparte de `lib/terminal.ts` para
 * que los componentes que están siempre montados —pestañas, panes, explorador,
 * Configuración— no arrastren xterm al paquete inicial: xterm se carga recién
 * cuando se muestra una consola. `lib/terminal.ts` lo reexporta todo, así que
 * quien ya usa la consola puede seguir importando de ahí.
 */

/** Prefijo de las pestañas de terminal en el tabsStore (patrón `graph:global`). */
export const TERMINAL_TAB_PREFIX = "terminal:";

export type ShellInfo = { id: string; nombre: string; ruta: string };

/** Id de pestaña ↔ id de terminal. */
export const tabIdDe = (termId: string) => `${TERMINAL_TAB_PREFIX}${termId}`;
export const termIdDe = (tabId: string) => tabId.slice(TERMINAL_TAB_PREFIX.length);
export const esTabTerminal = (tabId: string) => tabId.startsWith(TERMINAL_TAB_PREFIX);

let shellsCache: ShellInfo[] | null = null;

/** Shells detectadas en el sistema (cacheado; no cambian durante la corrida). */
export async function listarShells(): Promise<ShellInfo[]> {
  if (!shellsCache) shellsCache = await invoke<ShellInfo[]>("terminal_shells");
  return shellsCache;
}
