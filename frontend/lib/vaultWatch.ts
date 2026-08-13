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
 * La nota abierta solo se recarga si el editor NO tiene cambios locales sin
 * guardar (el propio `NoteEditor` decide, consultando su `dirtyRef`): este módulo
 * se limita a avisar con el evento de DOM `micelio:vault-recargar`.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { EVENTO_RECARGA } from "@/lib/eventos";
import { refreshAllLiveViews } from "@/lib/editor/livePreview";
import { indexarVault } from "@/lib/db/indexer";
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

/** Debounce propio para agrupar ráfagas de eventos del watcher (ms). */
const DEBOUNCE_MS = 300;

/**
 * Empieza a escuchar `vault-cambios`. Devuelve una función para dejar de
 * escuchar (llamarla al desmontar/salir para no duplicar listeners).
 */
export async function escucharCambiosVault(): Promise<UnlistenFn> {
  const { listen } = await import("@tauri-apps/api/event");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let procesando = false;

  const refrescar = async () => {
    // Si se salió del vault entre el evento y el debounce, no hay nada que hacer.
    const ruta = useVaultSessionStore.getState().rutaActual;
    if (!ruta || procesando) return;
    procesando = true;
    try {
      await indexarVault(ruta); // incremental por mtime
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
    } catch {
      // Best-effort: un reindex fallido no debe romper la UI.
    } finally {
      procesando = false;
    }
  };

  const unlisten = await listen(EVENTO_TAURI, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refrescar(), DEBOUNCE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unlisten();
  };
}
