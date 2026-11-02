import { create } from "zustand";
import {
  ARCHIVO_ACTIVIDAD,
  TOPE_ENTRADAS,
  agregarEntrada,
  comoGuardar,
  leerActividad,
  nuevaEntrada,
  renglonesEnDisco,
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
/**
 * Cuántos renglones tiene el archivo de cada vault, según lo último que se
 * leyó o escribió (`FUN-M-58`). Con eso se decide entre agregar el renglón o
 * reescribirlo recortado (`comoGuardar`).
 */
const renglones = new Map<string, number>();

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
      const texto = await invocar<string | null>("leer_estado_vault", { ruta, nombre: ARCHIVO_ACTIVIDAD });
      renglones.set(ruta, renglonesEnDisco(texto));
      // El archivo puede tener hasta `MARGEN_COMPACTAR` renglones de más: en
      // memoria (y en el panel) siguen siendo las últimas `TOPE_ENTRADAS`.
      entradas = leerActividad(texto).slice(-TOPE_ENTRADAS);
    } catch (e) {
      // Sin registro el vault funciona igual: se arranca vacío.
      console.warn(`[Mycelium] actividad · no se pudo leer ${ARCHIVO_ACTIVIDAD}`, e);
    }
    if (carga !== cargaVigente) return;
    // Lo que se registró mientras se leía (un pedido muy temprano) no se pierde.
    // Antes llegaba al disco con la reescritura siguiente; ahora que se agrega
    // renglón por renglón, se agrega acá.
    const tempranas = get().entradas;
    set({ ruta, entradas: [...entradas, ...tempranas].slice(-TOPE_ENTRADAS) });
    if (tempranas.length > 0) {
      renglones.set(ruta, (renglones.get(ruta) ?? 0) + tempranas.length);
      const contenido = serializar(tempranas);
      cola = cola
        .then(() => invocar<void>("agregar_estado_vault", { ruta, nombre: ARCHIVO_ACTIVIDAD, contenido }))
        .catch((e) => console.warn(`[Mycelium] actividad · no se pudo guardar ${ARCHIVO_ACTIVIDAD}`, e));
    }
  },

  registrar(datos) {
    const entrada = nuevaEntrada(datos);
    const entradas = agregarEntrada(get().entradas, entrada);
    set({ entradas });
    const { ruta } = get();
    if (ruta !== null) {
      // Se agrega el renglón al final (`FUN-M-58`): antes se reescribía el
      // archivo entero en cada operación, cientos de KB con el registro lleno.
      // Cuando pasaría del margen, se reescribe entero —ya recortado, con
      // escritura atómica— con lo que hay en memoria en este momento, que
      // incluye todo lo anterior: la cola mantiene el orden.
      const enDisco = renglones.get(ruta) ?? 0;
      if (comoGuardar(enDisco) === "reescribir") {
        renglones.set(ruta, entradas.length);
        const contenido = serializar(entradas);
        cola = cola
          .then(() => invocar<void>("escribir_estado_vault", { ruta, nombre: ARCHIVO_ACTIVIDAD, contenido }))
          .catch((e) => console.warn(`[Mycelium] actividad · no se pudo guardar ${ARCHIVO_ACTIVIDAD}`, e));
      } else {
        renglones.set(ruta, enDisco + 1);
        const contenido = serializar([entrada]);
        cola = cola
          .then(() => invocar<void>("agregar_estado_vault", { ruta, nombre: ARCHIVO_ACTIVIDAD, contenido }))
          .catch((e) => console.warn(`[Mycelium] actividad · no se pudo guardar ${ARCHIVO_ACTIVIDAD}`, e));
      }
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
