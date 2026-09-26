/**
 * Reacción a cambios EXTERNOS del vault en carpeta (fase 5, solo-desktop).
 *
 * El watcher nativo (`src-tauri/src/vault_watch.rs`) emite el evento Tauri
 * `vault-cambios` cuando algo cambia en la carpeta del vault desde fuera de la
 * app (otro editor, `git pull`, sincronización…). Aquí lo escuchamos y, con un
 * debounce propio para agrupar ráfagas, reindexamos (incremental por `mtime`) y
 * refrescamos la UI: el árbol del explorador y —si procede— la nota abierta.
 *
 * No hay bucle de realimentación: `indexarVault` SOLO lee archivos y actualiza el
 * índice SQLite (nunca escribe archivos) y es incremental, así que un cambio
 * escrito por la propia app deriva en un reindex idempotente. Ver el módulo Rust
 * y `docs/features/vault-en-carpeta.md`.
 *
 * Idempotente pero no gratis (`FUN-M-38`): cada guardado disparaba el recorrido
 * del vault, una recarga del árbol, el grafo marcado como viejo y una recarga de
 * todos los editores abiertos (con dos escaneos del grafo detrás). Por eso el
 * evento trae el `mtime` de cada ruta y una ráfaga que solo contiene escrituras
 * de la propia app —`esEscrituraPropia`, que compara ese `mtime` con el que
 * devolvió `escribir_nota`— se descarta entera. Con una sola ruta ajena en la
 * ráfaga se reindexa como siempre.
 *
 * La nota abierta solo se recarga si el editor NO tiene cambios locales sin
 * guardar (el propio `NoteEditor` decide, consultando su `dirtyRef`): este módulo
 * se limita a avisar con el evento de DOM `micelio:vault-recargar`.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { EVENTO_RECARGA } from "@/lib/eventos";
import { refreshAllLiveViews } from "@/lib/editor/livePreview";
import { indexarVault } from "@/lib/db/indexer";
import { esEscrituraPropia } from "@/lib/db/vaultFs";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Nombre del evento Tauri emitido por el watcher nativo. */
const EVENTO_TAURI = "vault-cambios";

/** Una ruta afectada y el `mtime` que tenía en disco al emitir el evento. */
type CambioVault = { ruta: string; mtime: number };

/**
 * Evento de DOM que los editores abiertos escuchan para recargar su nota. Se
 * define en `lib/eventos.ts` —neutral y sin dependencias— y se reexporta acá por
 * comodidad de quien ya lo importaba de este módulo.
 */
export { EVENTO_RECARGA };

/** Debounce propio para agrupar ráfagas de eventos del watcher (ms). */
const DEBOUNCE_MS = 300;

/**
 * Espera MÁXIMA desde el primer evento de una ráfaga (`DEF-106`). Sin tope, el
 * debounce se reiniciaba con cada evento: el watcher nativo emite uno por
 * archivo, y mientras algo escribe sin parar —un agente, una sincronización—
 * llegan cada ~150 ms, así que el reindexado no arrancaba hasta que la escritura
 * terminaba. Medido el 2026-09-25: 50 archivos escritos durante 7,8 s, ninguno
 * visible hasta el final. Con el tope, lo nuevo aparece como mucho un segundo
 * después, aunque la ráfaga siga.
 */
const ESPERA_MAXIMA_MS = 1000;

/**
 * Empieza a escuchar `vault-cambios`. Devuelve una función para dejar de
 * escuchar (llamarla al desmontar/salir para no duplicar listeners).
 */
export async function escucharCambiosVault(): Promise<UnlistenFn> {
  const { listen } = await import("@tauri-apps/api/event");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let procesando = false;
  // Llegó un cambio mientras se procesaba otro (`DEF-106`). Antes ese cambio se
  // DESCARTABA —`refrescar` salía por `procesando` y nadie lo volvía a correr—,
  // así que un archivo creado durante un reindexado no aparecía hasta que
  // ocurriera OTRO cambio en la carpeta. Con un agente escribiendo en el vault
  // los eventos son constantes y el caso, frecuente. Ahora se anota y, al
  // terminar, se corre una vez más: el reindexado es incremental, así que una
  // pasada alcanza para todo lo que se acumuló mientras tanto.
  let pendiente = false;
  // Lo que trajo la ráfaga que se está juntando (y lo que llegó mientras se
  // procesaba la anterior): ruta → último `mtime` visto.
  const rafaga = new Map<string, number>();

  const refrescar = async () => {
    // Si se salió del vault entre el evento y el debounce, no hay nada que hacer.
    const ruta = useVaultSessionStore.getState().rutaActual;
    if (!ruta) return;
    if (procesando) {
      pendiente = true;
      return;
    }
    procesando = true;
    pendiente = false;
    const cambios = [...rafaga];
    rafaga.clear();
    // Si TODO lo que cambió lo escribió esta app hace un momento y el archivo
    // sigue como lo dejó, no hay nada que reindexar ni que avisar (`FUN-M-38`):
    // el guardado ya dejó `notas.mtime` al día y el editor ya marcó el grafo.
    if (cambios.length > 0 && cambios.every(([r, mtime]) => esEscrituraPropia(r, mtime))) {
      procesando = false;
      if (pendiente) void refrescar();
      return;
    }
    try {
      const indexado = await indexarVault(ruta); // incremental por mtime
      useVaultStore.getState().setOtros(indexado.otros);
      const vaultId =
        useVaultStore.getState().vaultId ?? useAuthStore.getState().vaults[0]?.id ?? null;
      if (vaultId) await useVaultStore.getState().loadTree(vaultId);
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
      // cambios locales sin guardar (lo decide cada NoteEditor).
      window.dispatchEvent(new Event(EVENTO_RECARGA));
    } catch (e) {
      // Un reindex fallido no debe romper la UI, pero tampoco pasar en silencio:
      // sin este rastro, un archivo que no aparece no tiene explicación.
      console.error("[Mycelium] watcher · falló el reindexado tras un cambio externo", e);
    } finally {
      procesando = false;
      if (pendiente) void refrescar();
    }
  };

  // Cuándo llegó el primer evento de la ráfaga que se está juntando.
  let desde: number | null = null;

  const unlisten = await listen<CambioVault[]>(EVENTO_TAURI, (evento) => {
    for (const c of evento.payload ?? []) rafaga.set(c.ruta, c.mtime);
    const ahora = Date.now();
    desde ??= ahora;
    if (timer) clearTimeout(timer);
    const espera = Math.max(0, Math.min(DEBOUNCE_MS, desde + ESPERA_MAXIMA_MS - ahora));
    timer = setTimeout(() => {
      timer = null;
      desde = null;
      void refrescar();
    }, espera);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unlisten();
  };
}
