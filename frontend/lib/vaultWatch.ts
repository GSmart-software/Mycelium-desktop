/**
 * Reacción a cambios EXTERNOS del vault en carpeta (fase 5, solo-desktop).
 *
 * El watcher nativo (`src-tauri/src/vault_watch.rs`) emite el evento Tauri
 * `vault-cambios` cuando algo cambia en la carpeta del vault desde fuera de la
 * app (otro editor, `git pull`, sincronización…). Aquí lo escuchamos en dos
 * tiempos (`FUN-M-42`, «primero el árbol, después el índice», como Obsidian):
 *
 *   1. **El árbol, en el acto.** Cada ruta del evento trae lo que hay en ella
 *      ahora (nota, otro archivo, carpeta o nada) y se aplica al explorador
 *      apenas llega (`vaultStore.aplicarCambios`), sin debounce propio: el del
 *      watcher ya es corto (60 ms). Antes el explorador esperaba los dos
 *      debounces (400 + 300 ms) y el indexado completo: ~1 s.
 *   2. **El índice, después.** Con un debounce para agrupar ráfagas, se indexa
 *      SOLO lo que avisó el watcher (`indexarRutas`, `FUN-M-14`) en vez de
 *      recorrer el vault entero, y recién entonces se refresca lo que depende
 *      del índice: la recarga del árbol desde SQLite, el grafo, las vistas en
 *      vivo y los editores abiertos.
 *
 * Entre 1 y 2 el árbol tiene cosas que el índice no: los **pendientes** de
 * `lib/arbolVivo.ts`, que `loadTree` vuelve a aplicar para que una recarga en ese
 * hueco no las borre.
 *
 * Y una **reconciliación** (`reconciliar`) para lo que el watcher no avisa:
 * Windows pierde eventos en ráfagas grandes (`ReadDirectoryChangesW` desborda su
 * búfer). Recorre el disco una vez, corrige el árbol y reindexa de forma
 * incremental. Corre al recuperar la ventana el foco si pasaron 30 s desde la
 * última, con el botón «Refrescar» del explorador (`refrescarVault`), y cuando
 * cambia el `.mycignore` (cambia qué se ve).
 *
 * No hay bucle de realimentación: indexar SOLO lee archivos y actualiza el
 * índice SQLite (nunca escribe archivos), así que un cambio escrito por la
 * propia app deriva en un reindex idempotente. Ver el módulo Rust y
 * `docs/features/vault-en-carpeta.md`.
 *
 * Idempotente pero no gratis (`FUN-M-38`): por eso el evento trae el `mtime` de
 * cada ruta y una ráfaga que solo contiene escrituras de la propia app
 * —`esEscrituraPropia`, que compara ese `mtime` con el que devolvió
 * `escribir_nota`— no se indexa. Al árbol sí se aplica, pero para él un guardado
 * propio no cambia nada (`aplicarCambios` devuelve sin tocar el estado).
 *
 * La nota abierta solo se recarga si el editor NO tiene cambios locales sin
 * guardar (el propio `NoteEditor` decide, consultando su `dirtyRef`): este módulo
 * se limita a avisar con el evento de DOM `micelio:vault-recargar`.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  anotarPendientes,
  diferenciasConDisco,
  quitarPendientes,
  type CambioVault,
  type RecorridoVault,
} from "@/lib/arbolVivo";
import { EVENTO_RECARGA } from "@/lib/eventos";
import { refreshAllLiveViews } from "@/lib/editor/livePreview";
import { otrosDesdeMeta } from "@/lib/otrosArchivos";
import { indexarRutas, indexarVault } from "@/lib/db/indexer";
import { esEscrituraPropia } from "@/lib/db/vaultFs";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Nombre del evento Tauri emitido por el watcher nativo. */
const EVENTO_TAURI = "vault-cambios";

/**
 * Evento de DOM que los editores abiertos escuchan para recargar su nota. Se
 * define en `lib/eventos.ts` —neutral y sin dependencias— y se reexporta acá por
 * comodidad de quien ya lo importaba de este módulo.
 */
export { EVENTO_RECARGA };

/** Debounce del INDEXADO para agrupar ráfagas (ms). El árbol no lo espera. */
const DEBOUNCE_MS = 300;

/**
 * Espera MÁXIMA desde el primer evento de una ráfaga (`DEF-106`). Sin tope, el
 * debounce se reiniciaba con cada evento: el watcher nativo emite uno por
 * archivo, y mientras algo escribe sin parar —un agente, una sincronización—
 * llegan cada ~150 ms, así que el reindexado no arrancaba hasta que la escritura
 * terminaba. Medido el 2026-09-25: 50 archivos escritos durante 7,8 s, ninguno
 * visible hasta el final. Con el tope, el índice se pone al día como mucho un
 * segundo después, aunque la ráfaga siga (el árbol, desde `FUN-M-42`, ya los
 * mostraba al llegar).
 */
const ESPERA_MAXIMA_MS = 1000;

/**
 * Cuánto tiene que haber pasado desde la última reconciliación para que
 * recuperar el foco dispare otra (`FUN-M-42`). Es un recorrido del disco y un
 * indexado incremental: barato, pero no para cada Alt+Tab.
 */
const RECONCILIAR_AL_FOCO_TRAS_MS = 30_000;

/**
 * Pide una reconciliación a la cola del listener activo. `null` si no hay
 * listener (fuera del workspace): `refrescarVault` reconcilia entonces por su
 * cuenta.
 */
let pedirReconciliacion: (() => Promise<void>) | null = null;

/**
 * El botón «Refrescar» del explorador (`FUN-M-42`): recorre el disco, corrige
 * el árbol con lo que el watcher no avisó y reindexa lo distinto. Se resuelve
 * cuando terminó. Va por la misma cola que los eventos del watcher, para no
 * indexar dos veces a la vez.
 */
export async function refrescarVault(): Promise<void> {
  if (pedirReconciliacion) return pedirReconciliacion();
  const ruta = useVaultSessionStore.getState().rutaActual;
  if (ruta) await reconciliar(ruta);
}

/** Recarga el árbol desde el índice (con los pendientes encima: ver `loadTree`). */
async function recargarArbol(): Promise<void> {
  const vaultId =
    useVaultStore.getState().vaultId ?? useAuthStore.getState().vaults[0]?.id ?? null;
  if (vaultId) await useVaultStore.getState().loadTree(vaultId);
}

/**
 * Lo que depende del índice, tras ponerlo al día: el grafo, las vistas en vivo
 * y los editores abiertos.
 */
function avisarIndexado(rutas: string[]): void {
  // El grafo también quedó viejo (`DEF-054`). Faltaba: los mutadores de
  // `vaultStore` lo marcan al crear o borrar desde la UI, pero por acá pasan
  // los cambios hechos desde FUERA —otro editor, un `git pull`, un agente de
  // IA escribiendo en la carpeta— y nadie lo avisaba. `GraphView` refresca
  // solo si está abierto, y si no, al abrirlo.
  useGraphStore.getState().markStale();
  // Y las vistas en vivo: un archivo nuevo puede hacer que un `[[enlace]]`
  // que se mostraba como roto pase a resolver.
  refreshAllLiveViews();
  // Avisar a los editores abiertos para que recarguen su nota si no tienen
  // cambios locales sin guardar (lo decide cada vista). Con las rutas
  // (`FUN-L-26`): un lienzo o un diagrama abierto solo relee su archivo si está
  // entre ellas. Sin rutas (no debería pasar) va sin detalle, que significa
  // «pudo cambiar cualquier cosa».
  window.dispatchEvent(
    rutas.length > 0
      ? new CustomEvent(EVENTO_RECARGA, { detail: { rutas } })
      : new Event(EVENTO_RECARGA),
  );
}

/**
 * La reconciliación (`FUN-M-42`): un recorrido del disco contra el árbol, para
 * lo que el watcher no avisó. Primero corrige el árbol —lo que el usuario ve—
 * y después reindexa de forma incremental con ESE recorrido (no recorre dos
 * veces): lo que cambió de contenido lo encuentra comparando `mtime`.
 *
 * @returns las rutas que cambiaron (en el árbol o en el índice).
 */
async function reconciliar(ruta: string): Promise<string[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const recorrido = await invoke<RecorridoVault>("recorrer_vault", { origen: ruta });
  if (useVaultSessionStore.getState().rutaActual !== ruta) return [];
  const store = useVaultStore.getState();
  const diferencias = diferenciasConDisco(store, recorrido);
  if (diferencias.length > 0) store.aplicarCambios(diferencias);
  // Los otros archivos, tal cual los vio el disco (no los guarda el índice).
  store.setOtros(otrosDesdeMeta(recorrido.otros));
  const indexado = await indexarVault(ruta, undefined, recorrido);
  await recargarArbol();
  const rutas = [...new Set([...diferencias.map((d) => d.ruta), ...indexado.rutas])];
  if (rutas.length > 0) avisarIndexado(rutas);
  return rutas;
}

/**
 * Empieza a escuchar `vault-cambios`. Devuelve una función para dejar de
 * escuchar (llamarla al desmontar/salir para no duplicar listeners).
 */
export async function escucharCambiosVault(): Promise<UnlistenFn> {
  const { listen } = await import("@tauri-apps/api/event");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let procesando = false;
  // Llegó un cambio mientras se procesaba otro (`DEF-106`). Antes ese cambio se
  // DESCARTABA —`procesar` salía por `procesando` y nadie lo volvía a correr—,
  // así que un archivo creado durante un reindexado no se indexaba hasta que
  // ocurriera OTRO cambio en la carpeta. Ahora se anota y, al terminar, se corre
  // una vez más con todo lo que se acumuló mientras tanto.
  let pendiente = false;
  // Lo que trajo la ráfaga que se está juntando (y lo que llegó mientras se
  // procesaba la anterior): ruta → último cambio visto.
  const rafaga = new Map<string, CambioVault>();
  // Reconciliación pedida y quiénes esperan a que termine (el botón).
  let reconciliacion: (() => void)[] | null = null;
  let ultimaReconciliacion = Date.now();

  /** Indexa lo acumulado en la ráfaga (o reconcilia, si se pidió). */
  const procesar = async () => {
    // Si se salió del vault entre el evento y el debounce, no hay nada que hacer.
    const ruta = useVaultSessionStore.getState().rutaActual;
    if (!ruta) {
      rafaga.clear();
      for (const listo of reconciliacion ?? []) listo();
      reconciliacion = null;
      return;
    }
    if (procesando) {
      pendiente = true;
      return;
    }
    procesando = true;
    pendiente = false;
    const cambios = [...rafaga.values()];
    rafaga.clear();
    const esperan = reconciliacion;
    reconciliacion = null;
    try {
      // Una reconciliación ve todo lo del disco: también lo de la ráfaga. Igual
      // si cambió el `.mycignore`: cambia qué se ve, y eso solo lo sabe un
      // recorrido completo.
      if (esperan || cambios.some((c) => c.ruta === ".mycignore")) {
        ultimaReconciliacion = Date.now();
        await reconciliar(ruta);
        quitarPendientes(cambios);
      } else if (cambios.length > 0) {
        // Si TODO lo que cambió lo escribió esta app hace un momento y el archivo
        // sigue como lo dejó, no hay nada que reindexar ni que avisar
        // (`FUN-M-38`): el guardado ya dejó `notas.mtime` al día y el editor ya
        // marcó el grafo.
        if (cambios.every((c) => esEscrituraPropia(c.ruta, c.mtime))) {
          quitarPendientes(cambios);
        } else {
          await indexarRutas(ruta, cambios);
          quitarPendientes(cambios);
          await recargarArbol();
          avisarIndexado(cambios.map((c) => c.ruta));
        }
      }
    } catch (e) {
      // Un reindex fallido no debe romper la UI, pero tampoco pasar en silencio:
      // sin este rastro, un archivo que no se indexa no tiene explicación. Los
      // pendientes quedan: lo que muestran es lo que hay en disco, y la
      // próxima pasada (o la reconciliación) los indexa.
      console.error("[Mycelium] watcher · falló el reindexado tras un cambio externo", e);
    } finally {
      procesando = false;
      for (const listo of esperan ?? []) listo();
      if (pendiente || reconciliacion) void procesar();
    }
  };

  const reconciliarEnCola = () =>
    new Promise<void>((listo) => {
      (reconciliacion ??= []).push(listo);
      ultimaReconciliacion = Date.now();
      void procesar();
    });
  pedirReconciliacion = reconciliarEnCola;

  // Al volver a la ventana, si pasó un rato: lo que el watcher pudo perder
  // mientras tanto (una sincronización, un `git checkout` grande).
  const alRecuperarFoco = () => {
    if (document.visibilityState === "hidden") return;
    if (Date.now() - ultimaReconciliacion < RECONCILIAR_AL_FOCO_TRAS_MS) return;
    void reconciliarEnCola();
  };
  window.addEventListener("focus", alRecuperarFoco);
  document.addEventListener("visibilitychange", alRecuperarFoco);

  // Cuándo llegó el primer evento de la ráfaga que se está juntando.
  let desde: number | null = null;

  const unlisten = await listen<CambioVault[]>(EVENTO_TAURI, (evento) => {
    const cambios = evento.payload ?? [];
    if (cambios.length === 0) return;
    // 1) El árbol, ya. Anotados como pendientes ANTES de aplicarlos: si una
    // recarga desde el índice llega en el medio, los vuelve a poner.
    anotarPendientes(cambios);
    useVaultStore.getState().aplicarCambios(cambios);
    // 2) El índice, con debounce.
    for (const c of cambios) rafaga.set(c.ruta, c);
    const ahora = Date.now();
    desde ??= ahora;
    if (timer) clearTimeout(timer);
    const espera = Math.max(0, Math.min(DEBOUNCE_MS, desde + ESPERA_MAXIMA_MS - ahora));
    timer = setTimeout(() => {
      timer = null;
      desde = null;
      void procesar();
    }, espera);
  });

  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener("focus", alRecuperarFoco);
    document.removeEventListener("visibilitychange", alRecuperarFoco);
    // Solo si sigue siendo el nuestro: al cambiar de vault, el listener nuevo
    // puede haberse montado antes de que este se desmonte.
    if (pedirReconciliacion === reconciliarEnCola) pedirReconciliacion = null;
    unlisten();
  };
}
