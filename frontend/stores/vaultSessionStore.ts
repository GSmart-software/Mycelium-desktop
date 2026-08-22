/**
 * Sesión del vault en carpeta (fase 3 del "vault en carpeta", solo-desktop).
 *
 * Distinto del registro de vaults (`lib/vaultMode.ts`, qué carpetas conoce la
 * app) y del `authStore` (identidad interna sembrada): este store guarda el
 * estado de runtime de QUÉ carpeta usa la sesión actual. Abrir un vault:
 *   1. abre/crea su índice SQLite y lo deja como executor activo,
 *   2. siembra la identidad interna (`ensureSeed`) en ese índice,
 *   3. lo indexa releyendo la carpeta,
 *   4. marca el acceso (para el orden por reciente del selector).
 *
 * La ruta abierta se persiste en `sessionStorage` para sobrevivir a las
 * recargas del webview (el arranque y el guard la releen con
 * `rutaVaultPersistida()`). `salir()` vuelve al executor por defecto
 * (`mycelium.db`, modo SQLite clásico) y limpia la ruta.
 */
import { create } from "zustand";
import { abrirIndiceDeVault, setExecutor } from "@/lib/db/client";
import { ensureSeed } from "@/lib/db/auth";
import { crearEsquemaIndice, indexarVault } from "@/lib/db/indexer";
import { setVaultActual } from "@/lib/db/vaultContext";
import {
  marcarAcceso,
  ponerTituloDeVentana,
  registrarVaultDeVentana,
  soltarVaultDeVentana,
} from "@/lib/vaultMode";
import { useAuthStore } from "@/stores/authStore";
import { useGraphStore } from "@/stores/graphStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

/** Clave de `sessionStorage` con la ruta del vault abierto (sobrevive recargas). */
const CLAVE_VAULT_ABIERTO = "mycelium:vault-abierto";

/**
 * Etapas de la apertura, en orden. La pantalla de carga (`DEF-042`) las muestra
 * para que se vea **en qué** está trabajando la app y no solo que "está
 * cargando": si algo se atasca, saber si fue al indexar o al leer los ajustes es
 * la diferencia entre poder decir algo y no poder decir nada.
 */
export const ETAPAS = [
  "indice",
  "identidad",
  "indexando",
  "ajustes",
  "watcher",
] as const;
export type EtapaApertura = (typeof ETAPAS)[number];

export const ETIQUETA_ETAPA: Record<EtapaApertura, string> = {
  indice: "Abriendo el índice del vault",
  identidad: "Preparando el vault",
  indexando: "Leyendo los archivos de la carpeta",
  ajustes: "Cargando tus ajustes",
  watcher: "Vigilando los cambios de la carpeta",
};

type VaultSessionState = {
  /** Carpeta del vault abierto, o `null` en modo SQLite clásico. */
  rutaActual: string | null;
  /** true mientras se abre/indexa un vault. */
  abriendo: boolean;
  /** Carpeta que se está abriendo, para poder nombrarla en la pantalla de carga. */
  rutaAbriendo: string | null;
  /** En qué punto de la apertura estamos, o `null` fuera de ella (`DEF-042`). */
  etapa: EtapaApertura | null;
  /**
   * `Date.now()` del último avance real (cambio de etapa o de progreso). La
   * pantalla lo usa para poder decir «esto está tardando más de lo normal» en
   * vez de dejar al usuario mirando un spinner sin saber si se colgó.
   */
  avanceEn: number;
  /**
   * Avance del indexado mientras `abriendo` es true, o `null` fuera de él
   * (FUN-M-12). Lo alimenta el `onProgress` de `indexarVault`, que hasta ahora
   * no tenía ningún llamador: el usuario veía un spinner mudo.
   */
  progreso: { hechas: number; total: number } | null;
  /** Detalle del último fallo de `abrir()` (null si no hubo). */
  error: string | null;
  /** Abre un vault (índice + seed + indexado). Devuelve true si quedó listo. */
  abrir: (ruta: string) => Promise<boolean>;
  /** Cierra el vault: vuelve al executor por defecto y limpia el estado. */
  salir: () => Promise<void>;
};

export const useVaultSessionStore = create<VaultSessionState>((set) => ({
  rutaActual: null,
  abriendo: false,
  rutaAbriendo: null,
  etapa: null,
  avanceEn: 0,
  progreso: null,
  error: null,

  async abrir(ruta) {
    /** Marca una etapa y sella el instante: lo que alimenta el aviso de atasco. */
    const etapa = (e: EtapaApertura) => set({ etapa: e, avanceEn: Date.now() });

    set({
      abriendo: true,
      rutaAbriendo: ruta,
      error: null,
      progreso: null,
      etapa: "indice",
      avanceEn: Date.now(),
    });
    // Vaciar la caché del grafo del vault anterior: en modo carpeta todos los
    // vaults comparten `LOCAL_VAULT_ID`, así que el grafo no detecta el cambio
    // por sí solo y mostraría el del vault previo.
    useGraphStore.getState().reset();
    // Y el árbol, por el mismo motivo. No es solo cosmético (`DEF-044`): al
    // montar el workspace, `reconcileNotes` descarta las pestañas cuya nota no
    // esté en la lista, y si la lista todavía es la del vault ANTERIOR se lleva
    // por delante las pestañas que se acaban de restaurar — y deja el layout
    // vacío guardado en la clave de este vault.
    useVaultStore.getState().reset();
    try {
      // Antes de tocar nada: reclamar el vault para esta ventana (`FUN-L-16`).
      // Si lo tiene otra, se corta acá — abrir su índice desde dos ventanas
      // dejaría dos indexadores escribiendo el mismo archivo.
      await registrarVaultDeVentana(ruta);
      // Ya es nuestro: se pone el nombre en la barra de la ventana. Con varias
      // abiertas todas se llamaban "Mycelium" y no habia forma de distinguirlas
      // en la barra de tareas ni con Alt+Tab.
      void ponerTituloDeVentana(ruta);
      await abrirIndiceDeVault(ruta);
      // El índice recién abierto puede estar vacío: hay que crear el esquema
      // ANTES de sembrar, porque `ensureSeed()` consulta la tabla `usuarios`.
      await crearEsquemaIndice();
      // A partir de aquí los repos escriben también en disco (modo carpeta).
      setVaultActual(ruta);
      etapa("identidad");
      await ensureSeed();
      etapa("indexando");
      await indexarVault(ruta, (hechas, total) =>
        set({ progreso: { hechas, total }, avanceEn: Date.now() }),
      );
      set({ progreso: null }); // el indexado terminó
      await marcarAcceso(ruta);
      etapa("ajustes");
      // Recargar la sesión (usuario/vaults) y las preferencias DESDE ESTE índice:
      // cada vault tiene sus propios ajustes (grafo, tipografía, tema…). Sin esto,
      // al cambiar de vault el WorkspaceGuard no re-ejecuta restore() (initialized
      // ya es true) y quedarían los ajustes del vault anterior.
      await useAuthStore.getState().restore();
      usePreferencesStore.getState().hydrateFromUser();
      // Las pestañas también son de ESTE vault (`DEF-044`): antes seguían
      // abiertas las del anterior, apuntando a archivos que acá son otros o no
      // existen. En modo carpeta el id interno es común a todos los vaults, así
      // que las distingue la ruta.
      await useTabsStore.getState().usarAlmacenDeVault(ruta);
      // Watcher nativo (fase 5): observa la carpeta para reflejar en la UI los
      // cambios hechos desde fuera de la app. No es fatal si falla (el vault
      // sigue usable, solo no se auto-refresca ante cambios externos).
      etapa("watcher");
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("iniciar_watcher", { vaultRuta: ruta });
      } catch {
        // sin watcher no hay auto-refresco, pero el vault funciona igual
      }
      try {
        sessionStorage.setItem(CLAVE_VAULT_ABIERTO, ruta);
      } catch {
        // sessionStorage puede no estar disponible: no es fatal, solo no persiste.
      }
      // `etapa` y `rutaAbriendo` NO se limpian acá a propósito: la pantalla de
      // carga sigue en pantalla unos milisegundos, hasta que la navegación al
      // workspace se lleve la página. Si se borraran, esos milisegundos se verían
      // como un salto a una pantalla con todas las etapas otra vez pendientes.
      // Las limpia el siguiente `abrir()` (que las reinicia) o `salir()`.
      set({ rutaActual: ruta, abriendo: false, progreso: null, error: null });
      return true;
    } catch (error) {
      console.error("[vault] fallo al abrir el vault:", error);
      const message = error instanceof Error ? error.message : "Error desconocido";
      set({
        abriendo: false,
        rutaAbriendo: null,
        etapa: null,
        progreso: null,
        error: message,
      });
      return false;
    }
  },

  async salir() {
    // Detener el watcher antes de soltar el vault (fase 5). Best-effort.
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("detener_watcher");
    } catch {
      // si no había watcher o falla el invoke, no impide salir del vault
    }
    // Soltar también las pestañas y el árbol de este vault: quien entre después
    // no debe heredarlos (`DEF-044`).
    await useTabsStore.getState().usarAlmacenDeVault(null);
    useVaultStore.getState().reset();
    // Soltar el vault para que otra ventana pueda abrirlo (`FUN-L-16`).
    await soltarVaultDeVentana().catch(() => undefined);
    void ponerTituloDeVentana(null);
    setExecutor(null); // vuelve al executor Tauri por defecto (mycelium.db)
    setVaultActual(null); // los repos vuelven al modo SQLite clásico (sin disco)
    useGraphStore.getState().reset(); // no arrastrar el grafo del vault que se cierra
    try {
      sessionStorage.removeItem(CLAVE_VAULT_ABIERTO);
    } catch {
      // sin sessionStorage no hay nada que limpiar
    }
    set({ rutaActual: null, rutaAbriendo: null, etapa: null, progreso: null, error: null });
  },
}));

/** Ruta del vault abierto persistida en `sessionStorage`, o `null` (para el arranque). */
export function rutaVaultPersistida(): string | null {
  try {
    return sessionStorage.getItem(CLAVE_VAULT_ABIERTO);
  } catch {
    return null;
  }
}
