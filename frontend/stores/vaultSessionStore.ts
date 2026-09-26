/**
 * Sesión del vault en carpeta (fase 3 del "vault en carpeta", solo-desktop).
 *
 * Distinto del registro de vaults (`lib/vaultMode.ts`, qué carpetas conoce la
 * app): este store guarda el estado de runtime de QUÉ carpeta usa la sesión
 * actual. Sin vault abierto no hay capa de datos (el workspace redirige a la
 * selección). Abrir un vault:
 *   1. abre/crea su índice SQLite y lo deja como executor activo,
 *   2. lo indexa releyendo la carpeta,
 *   3. carga lo que es del vault y vive en `.mycelium/`: la papelera, las
 *      preferencias con la apariencia, los snippets CSS,
 *   4. marca el acceso (para el orden por reciente del selector).
 *
 * La ruta abierta se persiste en `sessionStorage` para sobrevivir a las
 * recargas del webview (el arranque y el guard la releen con
 * `rutaVaultPersistida()`). `salir()` suelta el índice y limpia la ruta.
 */
import { create } from "zustand";
import { abrirIndiceDeVault, setExecutor } from "@/lib/db/client";
import { crearEsquemaIndice, indexarVault } from "@/lib/db/indexer";
import { restaurarEstadoVault } from "@/lib/db/estadoVault";
import { migrarEstadoLegado } from "@/lib/db/legado";
import { setVaultActual } from "@/lib/db/vaultContext";
import {
  marcarAcceso,
  ponerTituloDeVentana,
  registrarVaultDeVentana,
  soltarVaultDeVentana,
} from "@/lib/vaultMode";
import { useCssStore } from "@/stores/cssStore";
import { useGraphStore } from "@/stores/graphStore";
import { usePrefsVaultStore } from "@/stores/prefsVaultStore";
import { useRecordatoriosStore } from "@/stores/recordatoriosStore";
import { useTabsStore } from "@/stores/tabsStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { useVaultStore } from "@/stores/vaultStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

/** Clave de `sessionStorage` con la ruta del vault abierto (sobrevive recargas). */
const CLAVE_VAULT_ABIERTO = "mycelium:vault-abierto";

/**
 * Mata los PTY de las consolas vivas antes de cambiar de vault (`DEF-099`).
 *
 * Va por `import()` y no por import normal a propósito: `lib/terminal` arrastra
 * xterm entero y a su vez importa ESTE store —el cwd por defecto de una consola
 * es la raíz del vault—, así que el import estático sería un ciclo y además
 * metería el emulador de terminal en el arranque de la app, que hoy lo carga
 * perezoso. Si no hay consolas, la función no hace nada.
 */
async function soltarConsolasSiHay(): Promise<void> {
  try {
    const { soltarConsolasDeVault } = await import("@/lib/terminal");
    soltarConsolasDeVault();
  } catch {
    // Sin terminal (o si falla su carga) no hay nada que soltar: cambiar de
    // vault no puede quedar bloqueado por esto.
  }
}

/**
 * Etapas de la apertura, en orden. La pantalla de carga (`DEF-042`) las muestra
 * para que se vea **en qué** está trabajando la app y no solo que "está
 * cargando": si algo se atasca, saber si fue al indexar o al leer los ajustes es
 * la diferencia entre poder decir algo y no poder decir nada.
 */
export const ETAPAS = [
  "indice",
  "indexando",
  "ajustes",
  "watcher",
] as const;
export type EtapaApertura = (typeof ETAPAS)[number];

export const ETIQUETA_ETAPA: Record<EtapaApertura, string> = {
  indice: "Abriendo el índice del vault",
  indexando: "Leyendo los archivos de la carpeta",
  ajustes: "Cargando tus ajustes",
  watcher: "Vigilando los cambios de la carpeta",
};

type VaultSessionState = {
  /** Carpeta del vault abierto, o `null` si no hay ninguno. */
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
  /** Abre un vault (índice + indexado + ajustes). Devuelve true si quedó listo. */
  abrir: (ruta: string) => Promise<boolean>;
  /** Cierra el vault: suelta su índice y limpia el estado. */
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
    // Y los recordatorios del anterior (`FUN-L-22`): mientras se abre este, no
    // tiene que sonar ninguno de aquel.
    void useRecordatoriosStore.getState().cargar(null);
    // Y las consolas del vault anterior (`DEF-099`): sus procesos tienen el cwd
    // en la carpeta que se está dejando. Se sueltan ANTES de cambiar de almacén
    // para que el scrollback se guarde en la clave a la que pertenece.
    await soltarConsolasSiHay();
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
      // El índice recién abierto puede estar vacío (o venir de una versión
      // anterior, sin las columnas nuevas): el esquema va antes que nada.
      await crearEsquemaIndice();
      // A partir de aquí los repos saben sobre qué carpeta operan.
      setVaultActual(ruta);
      etapa("indexando");
      const indexado = await indexarVault(ruta, (hechas, total) =>
        set({ progreso: { hechas, total }, avanceEn: Date.now() }),
      );
      set({ progreso: null }); // el indexado terminó
      // Los archivos no indexados salen del mismo recorrido (`FUN-M-38`); el
      // explorador los toma del store en vez de recorrer el vault otra vez.
      useVaultStore.getState().setOtros(indexado.otros);
      // El registro de la papelera NO se deriva de los archivos: vive en
      // `.mycelium/papelera.json` y se vuelca al índice acá (`DEF-107`). La
      // primera vez, con un índice anterior, hace lo inverso.
      await restaurarEstadoVault(ruta);
      await marcarAcceso(ruta);
      etapa("ajustes");
      // Los ajustes son de ESTE vault (decisión D3): preferencias, tema,
      // tipografía y snippets viven en su `.mycelium/`. Primero la migración
      // única de lo que una versión anterior dejó en otro lado (`FUN-L-24`);
      // después se cargan, y la apariencia se aplica ANTES de mostrar el
      // workspace, para que no parpadee con la del vault anterior.
      await migrarEstadoLegado(ruta);
      await usePrefsVaultStore.getState().cargar(ruta);
      usePreferencesStore.getState().hydrateFromUser();
      await useCssStore.getState().load();
      // Las pestañas también son de ESTE vault (`DEF-044`): antes seguían
      // abiertas las del anterior, apuntando a archivos que acá son otros o no
      // existen. En modo carpeta el id interno es común a todos los vaults, así
      // que las distingue la ruta.
      await useTabsStore.getState().usarAlmacenDeVault(ruta);
      // Y las consolas, por lo mismo (`DEF-099`): la lista es de ESTE vault, no
      // de la instalación. Con una clave por vault, dos ventanas dejan de
      // compartirlas (`DEF-100`), porque no pueden tener el mismo vault abierto.
      await useTerminalStore.getState().usarAlmacenDeVault(ruta);
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
      // Los recordatorios del calendario (`FUN-L-22`) también son del vault: se
      // cargan acá, y al cargarlos arranca el programador, que avisa en el acto
      // lo que venció con la app cerrada. Sin esperar, por lo mismo que arriba.
      void useRecordatoriosStore.getState().cargar(ruta);
      set({ rutaActual: ruta, abriendo: false, progreso: null, error: null });
      return true;
    } catch (error) {
      console.error("[vault] fallo al abrir el vault:", error);
      // `invoke` de Tauri rechaza con un STRING, no con un `Error`: sin esta
      // rama, el motivo real —«Ese vault ya está abierto en otra ventana»— se
      // perdía y el usuario veía «Error desconocido».
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Error desconocido";
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
    // no debe heredarlos (`DEF-044`). Y las consolas, por el mismo motivo
    // (`DEF-099`): primero se matan los procesos —su cwd es de este vault— y
    // después se suelta la lista, que se queda guardada en su clave.
    await soltarConsolasSiHay();
    await useTabsStore.getState().usarAlmacenDeVault(null);
    await useTerminalStore.getState().usarAlmacenDeVault(null);
    useVaultStore.getState().reset();
    // Soltar el vault para que otra ventana pueda abrirlo (`FUN-L-16`).
    await soltarVaultDeVentana().catch(() => undefined);
    void ponerTituloDeVentana(null);
    setExecutor(null); // sin vault no hay índice
    setVaultActual(null); // ni carpeta sobre la que operar
    useGraphStore.getState().reset(); // no arrastrar el grafo del vault que se cierra
    try {
      sessionStorage.removeItem(CLAVE_VAULT_ABIERTO);
    } catch {
      // sin sessionStorage no hay nada que limpiar
    }
    // Las preferencias del vault que se cierra no deben quedar puestas: el
    // siguiente vault trae las suyas, y mientras tanto valen las por defecto.
    void usePrefsVaultStore.getState().cargar(null);
    // Ni sus snippets CSS: sin vault, `load` los deja vacíos y quita el <style>.
    void useCssStore.getState().load();
    // Y sus recordatorios: fuera del vault no se muestran ni avisan (`FUN-L-22`).
    // Vaciar el store detiene también el programador.
    void useRecordatoriosStore.getState().cargar(null);
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
