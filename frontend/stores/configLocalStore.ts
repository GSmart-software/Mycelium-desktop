import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

/**
 * Lo que **esta máquina** decidió sobre el vault abierto (`DEF-164`, `DEF-169`):
 * qué snippets CSS se aplican, si la IA puede controlar la app y si se pueden
 * abrir las herramientas de desarrollo.
 *
 * No vive en `.mycelium/` —que viaja con el vault— sino en `config-local.json`
 * del config-dir de la app, con una entrada por vault (`src-tauri/src/config_local.rs`).
 * Un vault que esta máquina nunca vio arranca con todo apagado, aunque traiga
 * sus snippets o un `controlIa: true` en sus preferencias.
 */
export type ConfigLocalVault = {
  controlIa: boolean;
  devtools: boolean;
  /** id del snippet → encendido. Un snippet que no está acá nunca se decidió. */
  snippets: Record<string, boolean>;
};

/** La lista cerrada de cambios que acepta Rust (`config_local::Cambio`). */
export type CambioConfigLocal =
  | { clave: "controlIa"; valor: boolean }
  | { clave: "devtools"; valor: boolean }
  | { clave: "snippet"; id: string; activo: boolean }
  | { clave: "olvidarSnippet"; id: string };

export const CONFIG_LOCAL_APAGADA: ConfigLocalVault = { controlIa: false, devtools: false, snippets: {} };

type Estado = {
  config: ConfigLocalVault;
  /** Vault al que corresponde `config`; null = ninguno. */
  ruta: string | null;
  /** Carga la del vault indicado. Idempotente para la misma ruta. */
  cargar: (ruta: string | null) => Promise<ConfigLocalVault>;
  /** Guarda un cambio del vault cargado. Lanza si Rust lo rechaza. */
  fijar: (cambio: CambioConfigLocal) => Promise<ConfigLocalVault>;
};

/** Se queda con lo que tiene el tipo correcto: lo de Rust ya viene saneado. */
function normalizar(crudo: unknown): ConfigLocalVault {
  if (crudo === null || typeof crudo !== "object") return { ...CONFIG_LOCAL_APAGADA, snippets: {} };
  const o = crudo as Record<string, unknown>;
  const snippets: Record<string, boolean> = {};
  if (o.snippets && typeof o.snippets === "object") {
    for (const [id, v] of Object.entries(o.snippets as Record<string, unknown>)) {
      if (typeof v === "boolean") snippets[id] = v;
    }
  }
  return { controlIa: o.controlIa === true, devtools: o.devtools === true, snippets };
}

export const useConfigLocalStore = create<Estado>((set, get) => ({
  config: { ...CONFIG_LOCAL_APAGADA, snippets: {} },
  ruta: null,

  async cargar(ruta) {
    if (get().ruta === ruta && ruta !== null) return get().config;
    if (ruta === null) {
      const config = { ...CONFIG_LOCAL_APAGADA, snippets: {} };
      set({ config, ruta: null });
      return config;
    }
    let config: ConfigLocalVault;
    try {
      config = normalizar(await invoke("config_local_leer", { ruta }));
    } catch (e) {
      // Sin poder leerla, todo apagado: es el lado seguro.
      console.warn("[Mycelium] configuración local · no se pudo leer", e);
      config = { ...CONFIG_LOCAL_APAGADA, snippets: {} };
    }
    set({ config, ruta });
    return config;
  },

  async fijar(cambio) {
    const ruta = get().ruta;
    if (ruta === null) throw new Error("No hay un vault abierto.");
    const config = normalizar(await invoke("config_local_fijar", { ruta, cambio }));
    // Si mientras tanto se cambió de vault, no se pisa la del nuevo.
    if (get().ruta === ruta) set({ config });
    return config;
  },
}));
