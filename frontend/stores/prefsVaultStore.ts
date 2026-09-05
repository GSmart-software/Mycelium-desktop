import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

/**
 * Preferencias **de un vault**, no del usuario (`FUN-M-28` / `FUN-M-21`).
 *
 * `preferencesStore` guarda lo que es de la persona —tema, tipografía, ancho de
 * tabulación— y vale para todo. Acá van los ajustes que pertenecen al vault: si
 * se ven los números de línea, cómo se muestran los nombres en el grafo. Abrir
 * otro vault trae los suyos.
 *
 * Viven en `.mycelium/preferencias.json` **dentro del vault**, así que viajan
 * con él: copiar la carpeta a otra máquina se lleva también sus ajustes. En web
 * no hay carpeta, y ahí este módulo divergirá — ver la nota de abajo.
 *
 * > [!important] Los valores por defecto están en UN solo sitio
 * > `POR_DEFECTO`. Un vault sin archivo, con el archivo corrupto, o con una
 * > preferencia que todavía no existía cuando se guardó, cae acá. Repartir los
 * > defaults por los componentes haría que «apagado por defecto» significara
 * > cosas distintas según quién preguntara.
 */

/** Modos de nombres del grafo (`FUN-M-21`). */
export type ModoNombresGrafo = "todos" | "vecinos" | "apuntado";

export type PrefsVault = {
  /** Números de línea al costado de una nota markdown (`FUN-M-28`). */
  numerosDeLinea: boolean;
  /** Qué nombres se dibujan en el grafo (`FUN-M-21`). */
  nombresGrafo: ModoNombresGrafo;
};

/**
 * Los valores con los que arranca un vault que nunca guardó nada.
 *
 * `numerosDeLinea` va **apagado** a propósito: es lo que pidió el usuario y es
 * lo que hace que un vault existente no cambie de aspecto al actualizar.
 */
export const POR_DEFECTO: PrefsVault = {
  numerosDeLinea: false,
  nombresGrafo: "todos",
};

/**
 * Mezcla lo leído del disco con los valores por defecto, quedándose solo con lo
 * que reconoce y con el tipo correcto.
 *
 * Es deliberadamente desconfiada: el archivo vive en la carpeta del usuario y se
 * puede editar a mano, y una preferencia agregada después no está en los vaults
 * viejos. Un valor con el tipo equivocado se ignora en vez de propagarse hasta
 * el componente que lo use.
 *
 * Pura y exportada para poder testearla sin Tauri.
 */
export function normalizar(crudo: unknown): PrefsVault {
  if (crudo === null || typeof crudo !== "object") return { ...POR_DEFECTO };
  const o = crudo as Record<string, unknown>;
  return {
    numerosDeLinea:
      typeof o.numerosDeLinea === "boolean" ? o.numerosDeLinea : POR_DEFECTO.numerosDeLinea,
    nombresGrafo:
      o.nombresGrafo === "todos" || o.nombresGrafo === "vecinos" || o.nombresGrafo === "apuntado"
        ? o.nombresGrafo
        : POR_DEFECTO.nombresGrafo,
  };
}

type EstadoPrefsVault = {
  prefs: PrefsVault;
  /** Ruta del vault que cargó estas preferencias; null = ninguno todavía. */
  ruta: string | null;
  /** Carga las del vault indicado. Idempotente para la misma ruta. */
  cargar: (ruta: string | null) => Promise<void>;
  set: <K extends keyof PrefsVault>(clave: K, valor: PrefsVault[K]) => void;
};

/**
 * Guardado diferido: cambiar un ajuste con un interruptor no debe escribir el
 * archivo en cada pulsación, y algunos —el modo de nombres del grafo— se tocan
 * varias veces seguidas mientras se busca el que gusta.
 */
const ESPERA_GUARDADO_MS = 400;
let temporizador: ReturnType<typeof setTimeout> | null = null;

function guardarDiferido(ruta: string | null, prefs: PrefsVault) {
  if (ruta === null) return;
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    temporizador = null;
    // Si falla, se pierde la preferencia y no pasa nada más: no se avisa porque
    // no hay nada que el usuario pueda hacer, y un cartel por un ajuste de
    // aspecto sería más molesto que el propio fallo.
    void invoke("escribir_prefs_vault", {
      ruta,
      contenido: JSON.stringify(prefs, null, 2),
    }).catch(() => {});
  }, ESPERA_GUARDADO_MS);
}

export const usePrefsVaultStore = create<EstadoPrefsVault>((set, get) => ({
  prefs: { ...POR_DEFECTO },
  ruta: null,

  async cargar(ruta) {
    if (get().ruta === ruta) return;
    if (ruta === null) {
      set({ prefs: { ...POR_DEFECTO }, ruta: null });
      return;
    }
    let crudo: unknown = null;
    try {
      const texto = await invoke<string | null>("leer_prefs_vault", { ruta });
      crudo = texto === null ? null : JSON.parse(texto);
    } catch {
      // Ni un archivo ausente ni uno corrupto deben impedir abrir el vault: se
      // arranca con los valores por defecto y el próximo guardado lo rehace.
      crudo = null;
    }
    set({ prefs: normalizar(crudo), ruta });
  },

  set(clave, valor) {
    const prefs = { ...get().prefs, [clave]: valor };
    set({ prefs });
    guardarDiferido(get().ruta, prefs);
  },
}));

/** Atajo de lectura para los componentes. */
export const usePrefVault = <K extends keyof PrefsVault>(clave: K): PrefsVault[K] =>
  usePrefsVaultStore((s) => s.prefs[clave]);
