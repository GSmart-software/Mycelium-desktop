import { create } from "zustand";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { esTabArchivo, rutaDeTabArchivo } from "@/lib/otrosArchivos";
import { tipoDePestana } from "@/lib/pestanas";
import { rutaAbsolutaEnVault } from "@/lib/rutasSoltadas";
import { allLeaves, useTabsStore } from "@/stores/tabsStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";

/**
 * Soltar archivos en la consola escribe su ruta (`FUN-S-43`): lo que une el
 * arrastre con la consola. Es liviano a propósito (no importa xterm): lo usan
 * el explorador y las filas del árbol, que se cargan siempre.
 *
 * Tres caminos llegan a una consola:
 *
 * 1. **Archivos de fuera de la app** (el Explorador de Windows, el escritorio,
 *    otro programa). Es arrastre HTML5 —`dragDropEnabled` está en `false` en
 *    `tauri.conf.json` a propósito: con `true`, Tauri se come todo arrastre y
 *    el interno deja de andar— y WebView2 entrega los `File` **sin ruta**. La
 *    ruta la pide {@link rutasDeArchivosExternos} al host por
 *    `postMessageWithAdditionalObjects`, que es la vía documentada de WebView2
 *    (`src-tauri/src/rutas_soltadas.rs`). Solo Windows: en macOS y Linux no hay
 *    equivalente y la consola no ofrece soltar archivos de afuera.
 * 2. **Notas y carpetas del explorador del vault.** El árbol arrastra con
 *    dnd-kit (eventos de puntero, no HTML5): la consola no recibe nada. El
 *    explorador ubica la consola bajo el puntero por geometría
 *    ({@link consolaEnPunto}), publica el destino en {@link useConsolaDestino}
 *    para que se vea la indicación y, al soltar, escribe la ruta.
 * 3. **Pestañas y archivos que no son notas.** Arrastre HTML5 interno: una
 *    pestaña pone `text/plain` con su id y deja `tabsStore.dragging`; una fila
 *    de «otro archivo» pone {@link MIME_RUTA_VAULT}. La propia consola lo
 *    atiende ({@link rutaDeArrastreInterno}).
 */

/** Tipo del `dataTransfer` con la ruta relativa de un archivo del vault que no es nota. */
export const MIME_RUTA_VAULT = "application/x-mycelium-ruta";

/** Evento con el que Rust devuelve las rutas de un pedido (`rutas_soltadas.rs`). */
const EVENTO_RUTAS = "rutas-soltadas";

/** Cuánto se espera la respuesta del host antes de darse por vencido. */
const ESPERA_MS = 3000;

/**
 * La consola sobre la que está el puntero mientras se arrastra una nota o una
 * carpeta desde el explorador (camino 2). `TerminalView` muestra la indicación
 * si es la suya.
 */
export const useConsolaDestino = create<{
  termId: string | null;
  fijar: (termId: string | null) => void;
}>((set, get) => ({
  termId: null,
  fijar: (termId) => {
    if (get().termId !== termId) set({ termId });
  },
}));

/**
 * La consola bajo un punto de pantalla, por geometría (`[data-consola-soltar]`
 * es el área de texto de cada `TerminalView` visible). Se usa la geometría y no
 * `elementFromPoint` por lo mismo que `paneObjetivoEnPunto`: en el WebView,
 * durante un arrastre de dnd-kit, el fantasma tapa lo de abajo.
 */
export function consolaEnPunto(x: number, y: number): string | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-consola-soltar]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    return el.dataset.consolaSoltar ?? null;
  }
  return null;
}

/** La ruta absoluta de algo del vault abierto, por su ruta relativa. */
export function rutaDeVault(relativa: string): string | null {
  return rutaAbsolutaEnVault(useVaultSessionStore.getState().rutaActual, relativa);
}

/**
 * Si el arrastre HTML5 en curso es interno y trae algo del vault, su ruta
 * relativa; si no, `null`. Durante `dragover` el navegador no deja leer los
 * datos (solo los tipos): por eso las pestañas se reconocen por
 * `tabsStore.dragging` y no por su `text/plain`, que también pone cualquier
 * texto seleccionado.
 *
 * `datos` es el `dataTransfer` del evento; con `leer` se intenta además leer
 * la ruta de un archivo que no es nota (solo vale en `drop`). Devuelve `""`
 * cuando se sabe que es un archivo del vault pero todavía no se puede leer
 * cuál (en `dragover`).
 */
export function rutaDeArrastreInterno(datos: DataTransfer, leer: boolean): string | null {
  if (datos.types.includes(MIME_RUTA_VAULT)) {
    return leer ? datos.getData(MIME_RUTA_VAULT) || null : "";
  }
  const pestana = useTabsStore.getState().dragging;
  if (!pestana) return null;
  const tab = allLeaves(useTabsStore.getState().root)
    .flatMap((p) => p.tabs)
    .find((t) => t.id === pestana.tabId);
  if (!tab) return null;
  // Solo lo que es un archivo del vault: una nota o un archivo que no es nota.
  // El grafo, el calendario, otra consola o la Bandeja personal no tienen una
  // ruta que tenga sentido escribir.
  const tipo = tipoDePestana(tab.notaId);
  if (tipo === "nota") return tab.notaId;
  if (tipo === "archivo" && esTabArchivo(tab.notaId)) return rutaDeTabArchivo(tab.notaId);
  return null;
}

/** El puente de WebView2 que acepta objetos adicionales (`File`) en un mensaje al host. */
type PuenteWebView2 = {
  postMessageWithAdditionalObjects: (mensaje: unknown, objetos: ArrayLike<File>) => void;
};

function puenteWebView2(): PuenteWebView2 | null {
  if (typeof window === "undefined") return null;
  const webview = (window as unknown as { chrome?: { webview?: Partial<PuenteWebView2> } }).chrome?.webview;
  return typeof webview?.postMessageWithAdditionalObjects === "function"
    ? (webview as PuenteWebView2)
    : null;
}

/**
 * ¿Se pueden soltar archivos de fuera de la app? Solo en Windows, donde
 * WebView2 sabe dar la ruta de un `File`. En macOS y Linux la consola ni
 * siquiera ofrece soltarlos: no se vería nada al hacerlo.
 */
export const puedeSoltarExternos = () => puenteWebView2() !== null;

let siguienteId = 1;
const pendientes = new Map<number, (rutas: string[]) => void>();
let escuchando: Promise<unknown> | null = null;

/** Escucha (una sola vez por ventana) las respuestas del host. */
function escucharRespuestas() {
  escuchando ??= getCurrentWebviewWindow().listen<{ id: number; rutas: string[] }>(EVENTO_RUTAS, (e) => {
    const resolver = pendientes.get(e.payload.id);
    if (!resolver) return;
    pendientes.delete(e.payload.id);
    resolver(Array.isArray(e.payload.rutas) ? e.payload.rutas : []);
  });
  return escuchando;
}

/**
 * Las rutas absolutas de los `File` que el usuario soltó desde fuera de la app.
 * Se le pasan al host con `postMessageWithAdditionalObjects`; el host lee
 * `ICoreWebView2File::Path` de cada uno y las devuelve por el evento
 * `rutas-soltadas`, con el mismo `id` para no confundir dos soltadas seguidas.
 *
 * El mensaje es un **texto**, `mycelium:rutas-soltadas:<id>`, y no un objeto:
 * el manejador del IPC de wry va primero y falla con un objeto, y cuando un
 * manejador falla WebView2 no llama a los siguientes (el nuestro). El costo es
 * un `console.error` de Tauri por soltada, en la consola de desarrollador (ver
 * `rutas_soltadas.rs`).
 *
 * Sin puente, sin archivos o si el host no contesta a tiempo: `[]`.
 */
export async function rutasDeArchivosExternos(archivos: ArrayLike<File>): Promise<string[]> {
  const puente = puenteWebView2();
  if (!puente || archivos.length === 0) return [];
  await escucharRespuestas();
  const id = siguienteId++;
  return new Promise<string[]>((resolver) => {
    const vencer = window.setTimeout(() => {
      pendientes.delete(id);
      resolver([]);
    }, ESPERA_MS);
    pendientes.set(id, (rutas) => {
      window.clearTimeout(vencer);
      resolver(rutas);
    });
    try {
      puente.postMessageWithAdditionalObjects(`mycelium:${EVENTO_RUTAS}:${id}`, archivos);
    } catch {
      window.clearTimeout(vencer);
      pendientes.delete(id);
      resolver([]);
    }
  });
}

/**
 * Escribe las rutas en la consola `termId`. Carga `lib/terminal` recién acá: si
 * hay una consola a la vista ya está cargado, y así el explorador no arrastra
 * xterm a su paquete.
 */
export async function escribirRutasEnConsola(termId: string, rutas: readonly string[]): Promise<void> {
  if (rutas.length === 0) return;
  const { escribirRutas } = await import("@/lib/terminal");
  escribirRutas(termId, rutas);
}
