import { create } from "zustand";
import {
  ARCHIVOS_CON_MARCA,
  RUTA_VERSION_IA,
  estadoInstrucciones,
  type EstadoInstrucciones,
} from "@/lib/ia/instruccionesInstaladas";
import { FRAMEWORK_IA_VERSION } from "@/lib/ia/versionFramework";
import { usePrefsVaultStore } from "@/stores/prefsVaultStore";

/**
 * Las instrucciones de IA del vault abierto frente a las que trae la app
 * (`FUN-S-45`): la única lectura de la versión instalada. La usan Configuración
 * → Vault, el aviso de «Actividad de la IA» con su marca en el rail, y
 * `mycelium_estado` (`lib/mcpControl.ts`).
 *
 * Se comprueba al abrir el vault, después de generar o actualizar, al abrir el
 * panel de actividad y al volver a la ventana (los archivos de `.claude/` no
 * pasan por el watcher: está ignorado). Son cinco lecturas chicas.
 *
 * «Ahora no» pospone el aviso hasta que se vuelva a abrir el vault, o hasta que
 * cambie lo que se compara (otra versión instalada o una app nueva): se guarda
 * en memoria, no en disco. Quien pospuso un aviso no quiere verlo a cada rato,
 * pero tampoco olvidarse para siempre de que la IA trabaja con instrucciones
 * viejas.
 */

async function leer(vaultRuta: string, rutaRel: string): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("leer_archivo_texto", { vaultRuta, rutaRel });
  } catch {
    return null;
  }
}

/** La clave de lo pospuesto: si cambia algo de esto, el aviso vuelve. */
const clavePospuesta = (ruta: string, e: EstadoInstrucciones) => `${ruta}|${e.instalada}|${e.disponible}`;

type Estado = {
  /** El vault de `estado`; `null` = ninguno abierto. */
  ruta: string | null;
  /** `null` mientras no se leyó. */
  estado: EstadoInstrucciones | null;
  /** Clave del aviso que el usuario pospuso en esta apertura del vault. */
  pospuesta: string | null;
  actualizando: boolean;

  /** Al abrir (o cerrar, con `null`) un vault: se olvida lo pospuesto y se lee. */
  abrir: (ruta: string | null) => Promise<void>;
  /** Vuelve a leer las del vault abierto. */
  comprobar: () => Promise<void>;
  /** «Ahora no». */
  posponer: () => void;
  /** Genera o actualiza las instrucciones y vuelve a leer. Devuelve qué pasó; lanza si falla. */
  actualizar: () => Promise<string>;
};

let lecturaVigente = 0;

export const useInstruccionesIaStore = create<Estado>((set, get) => ({
  ruta: null,
  estado: null,
  pospuesta: null,
  actualizando: false,

  async abrir(ruta) {
    set({ ruta, estado: null, pospuesta: null });
    if (ruta !== null) await get().comprobar();
  },

  async comprobar() {
    const { ruta } = get();
    if (ruta === null) return;
    const lectura = ++lecturaVigente;
    const [json, claudeMd, ...marcas] = await Promise.all([
      leer(ruta, RUTA_VERSION_IA),
      leer(ruta, "CLAUDE.md"),
      ...ARCHIVOS_CON_MARCA.map((r) => leer(ruta, r)),
    ]);
    // Otra lectura más nueva, u otro vault, ganó mientras tanto.
    if (lectura !== lecturaVigente || get().ruta !== ruta) return;
    set({ estado: estadoInstrucciones({ json, claudeMd, marcas }, FRAMEWORK_IA_VERSION) });
  },

  posponer() {
    const { ruta, estado } = get();
    if (ruta !== null && estado !== null) set({ pospuesta: clavePospuesta(ruta, estado) });
  },

  async actualizar() {
    const { ruta } = get();
    if (ruta === null) throw new Error("No hay un vault en carpeta abierto.");
    set({ actualizando: true });
    try {
      const { actualizarInstrucciones } = await import("@/lib/ia/actualizarInstrucciones");
      return await actualizarInstrucciones(ruta, usePrefsVaultStore.getState().prefs.controlIa);
    } finally {
      // Aunque falle a medias, se relee: lo que quedó en disco es lo que vale.
      await get().comprobar();
      set({ actualizando: false });
    }
  },
}));

/**
 * Si hay que avisar: las instrucciones están desactualizadas y el usuario no
 * pospuso este aviso. Es lo que muestra el aviso del panel y la marca del rail.
 */
export function hayAvisoInstrucciones(s: Pick<Estado, "ruta" | "estado" | "pospuesta">): boolean {
  if (s.ruta === null || s.estado === null || s.estado.situacion !== "desactualizadas") return false;
  return s.pospuesta !== clavePospuesta(s.ruta, s.estado);
}
