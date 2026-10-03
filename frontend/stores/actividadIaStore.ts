import { create } from "zustand";
import {
  ARCHIVO_ACTIVIDAD,
  agregarEntrada,
  leerActividad,
  nuevaEntrada,
  serializar,
  type Entrada,
} from "@/lib/actividadIa";

/**
 * El registro de actividad de la IA (`FUN-L-09`, Parte 2), **del vault
 * abierto**: lo que hizo el agente por el MCP de control, y el estado del
 * canal para la cabecera del panel. La lógica pura está en `lib/actividadIa.ts`.
 *
 * Vive en `.mycelium/actividad.jsonl` por los comandos de estado del vault
 * (`prefs_vault.rs`, lista cerrada de nombres). Se carga al abrir el vault y
 * se vacía al salir (`vaultSessionStore`), como los recordatorios.
 */

async function invocar<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

type Estado = {
  /** Vault de este registro; `null` = ninguno abierto. */
  ruta: string | null;
  entradas: Entrada[];
  /** El canal de esta ventana está escuchando. */
  canalAbierto: boolean;
  /** Por qué no se pudo abrir el canal, si falló. */
  errorCanal: string | null;
  /** Cuándo llegó el último pedido del servidor (ms). */
  ultimoPedido: number | null;

  cargar: (ruta: string | null) => Promise<void>;
  /** Agrega una entrada y la guarda. Devuelve la entrada (con id y momento). */
  registrar: (datos: Omit<Entrada, "v" | "id" | "momento">) => Entrada;
  /** Lo llama `lib/mcpControl.ts` al abrir, cerrar o fallar el canal. */
  fijarCanal: (abierto: boolean, error?: string | null) => void;
  /** Lo llama `lib/mcpControl.ts` con cada pedido que llega. */
  pedidoRecibido: () => void;
};

/** Las escrituras van en fila, como las del calendario: el orden en disco es el de los hechos. */
let cola: Promise<void> = Promise.resolve();
let cargaVigente = 0;

export const useActividadIaStore = create<Estado>((set, get) => ({
  ruta: null,
  entradas: [],
  canalAbierto: false,
  errorCanal: null,
  ultimoPedido: null,

  async cargar(ruta) {
    if (get().ruta === ruta) return;
    const carga = ++cargaVigente;
    set({ ruta: null, entradas: [], ultimoPedido: null });
    if (ruta === null) {
      set({ canalAbierto: false, errorCanal: null });
      return;
    }
    let entradas: Entrada[] = [];
    try {
      entradas = leerActividad(await invocar<string | null>("leer_estado_vault", { ruta, nombre: ARCHIVO_ACTIVIDAD }));
    } catch (e) {
      // Sin registro el vault funciona igual: se arranca vacío.
      console.warn(`[Mycelium] actividad · no se pudo leer ${ARCHIVO_ACTIVIDAD}`, e);
    }
    if (carga !== cargaVigente) return;
    // Lo que se registró mientras se leía (un pedido muy temprano) no se pierde.
    set((s) => ({ ruta, entradas: [...entradas, ...s.entradas] }));
  },

  registrar(datos) {
    const entrada = nuevaEntrada(datos);
    const entradas = agregarEntrada(get().entradas, entrada);
    set({ entradas });
    const { ruta } = get();
    if (ruta !== null) {
      // Se reescribe entero —ya recortado— con escritura atómica: el
      // contenido es *append-only* (ninguna entrada cambia), el archivo no.
      const contenido = serializar(entradas);
      cola = cola
        .then(() => invocar<void>("escribir_estado_vault", { ruta, nombre: ARCHIVO_ACTIVIDAD, contenido }))
        .catch((e) => console.warn(`[Mycelium] actividad · no se pudo guardar ${ARCHIVO_ACTIVIDAD}`, e));
    }
    return entrada;
  },

  fijarCanal(abierto, error = null) {
    set({ canalAbierto: abierto, errorCanal: error });
  },

  pedidoRecibido() {
    set({ ultimoPedido: Date.now() });
  },
}));
