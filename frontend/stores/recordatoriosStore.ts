import { create } from "zustand";
import {
  alternarCompletada,
  archivoVacio,
  avisosPendientes,
  descartar,
  fechaLocal,
  fijarCompletada,
  leerArchivo,
  limpiarOcurrencias,
  momentoLocal,
  posponer,
  restaurarRecordatorio,
  type ArchivoRecordatorios,
  type Aviso,
  type EstadoOcurrencia,
  type Recordatorio,
} from "@/lib/recordatorios";
import {
  detenerProgramador,
  iniciarProgramador,
  notificarNuevos,
  olvidarNotificados,
} from "@/lib/avisosRecordatorio";
import { avisar } from "@/stores/avisosStore";

/**
 * Los recordatorios del calendario (`FUN-L-22`), **del vault abierto**.
 *
 * Viven en `.mycelium/recordatorios.json` (§ 3 de la spec): no son archivos del
 * vault —no aparecen en el explorador, la búsqueda ni el grafo— pero viajan con
 * él, igual que la papelera o las preferencias del vault. Abrir otro vault trae
 * los suyos, y con ellos sus avisos: cada ventana tiene su propio store, así
 * que un vault nunca avisa lo de otro.
 *
 * El ciclo lo lleva `vaultSessionStore`: `cargar(ruta)` al abrir, que además
 * arranca el programador de avisos, y `cargar(null)` al salir, que lo detiene y
 * vacía todo.
 */

const NOMBRE = "recordatorios.json";

async function invocar<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Qué pidió «Abrir» en una tarjeta: el día, y el recordatorio a seleccionar. */
export type FocoCalendario = { fecha: string; id: string | null; n: number };

type Estado = {
  /** Vault de estos recordatorios; `null` = ninguno abierto. */
  ruta: string | null;
  archivo: ArchivoRecordatorios;
  /**
   * El archivo existe pero no se pudo leer. Mientras tanto **no se escribe**:
   * el calendario arranca vacío y sobrescribirlo borraría lo que todavía se
   * puede recuperar a mano (§ 3).
   */
  bloqueado: boolean;
  /** Los avisos que se muestran ahora: tarjetas que no se van solas. */
  avisos: Aviso[];
  /** El último pedido de «Abrir» desde una tarjeta; lo consume el calendario. */
  foco: FocoCalendario | null;

  cargar: (ruta: string | null) => Promise<void>;
  /** Crea o reemplaza un recordatorio (por `id`). */
  guardar: (r: Recordatorio) => void;
  eliminar: (id: string) => void;
  /** «Listo» en una tarjeta. */
  listo: (clave: string) => void;
  /** «Posponer» en una tarjeta. */
  posponer: (clave: string, hasta: Date) => void;
  /** Marca o desmarca una ocurrencia como completada. */
  alternarCompletada: (clave: string) => void;
  /** Deja una ocurrencia completada o no (el MCP de control y su Deshacer). */
  fijarCompletada: (clave: string, completada: boolean) => void;
  /**
   * Vuelve a poner un recordatorio borrado con su id y el estado de sus
   * ocurrencias (el Deshacer del registro de actividad). Como al crearlo, su
   * `vigenteDesde` es ahora: restaurar no avisa lo que venció mientras no estaba.
   */
  restaurar: (r: Recordatorio, ocurrencias: Record<string, EstadoOcurrencia>) => void;
  /** Recalcula qué hay que avisar. La llama el programador cada minuto. */
  revisar: () => void;
  enfocar: (fecha: string, id: string | null) => void;
  /** El calendario ya aplicó el pedido de «Abrir». */
  consumirFoco: () => void;
};

/**
 * Las escrituras van en fila: dos cambios seguidos —descartar una tarjeta y
 * enseguida otra— no pueden terminar en disco en otro orden y dejar el primero.
 */
let cola: Promise<void> = Promise.resolve();
let avisadoBloqueo = false;

function persistir(ruta: string, archivo: ArchivoRecordatorios) {
  const contenido = JSON.stringify(archivo, null, 2);
  cola = cola
    .then(() => invocar<void>("escribir_estado_vault", { ruta, nombre: NOMBRE, contenido }))
    .catch((e) => {
      console.error(`[Mycelium] recordatorios · no se pudo guardar ${NOMBRE}`, e);
      avisar("No se pudo guardar el calendario. El último cambio puede perderse al cerrar.");
    });
}

let serie = 0;
/** Cuál es la última carga pedida: una más vieja que termina tarde no manda. */
let cargaVigente = 0;

export const useRecordatoriosStore = create<Estado>((set, get) => {
  /** Aplica un archivo nuevo: lo guarda en disco y recalcula los avisos. */
  function aplicar(archivo: ArchivoRecordatorios) {
    set({ archivo });
    const { ruta, bloqueado } = get();
    if (ruta !== null) {
      if (bloqueado) {
        // Se conserva en memoria, pero el archivo dañado no se toca. Se dice
        // una vez: repetirlo en cada cambio no ayudaría a arreglarlo.
        if (!avisadoBloqueo) {
          avisadoBloqueo = true;
          avisar(
            "El calendario no se guarda: .mycelium/recordatorios.json está dañado. Arreglalo o borralo para volver a guardar.",
          );
        }
      } else {
        persistir(ruta, archivo);
      }
    }
    get().revisar();
  }

  return {
    ruta: null,
    archivo: archivoVacio(),
    bloqueado: false,
    avisos: [],
    foco: null,

    async cargar(ruta) {
      if (get().ruta === ruta) return;
      const carga = ++cargaVigente;
      detenerProgramador();
      olvidarNotificados();
      avisadoBloqueo = false;
      set({ ruta: null, archivo: archivoVacio(), bloqueado: false, avisos: [], foco: null });
      if (ruta === null) return;

      let archivo = archivoVacio();
      let bloqueado = false;
      try {
        const texto = await invocar<string | null>("leer_estado_vault", { ruta, nombre: NOMBRE });
        if (texto !== null) {
          let json: unknown = null;
          try {
            json = JSON.parse(texto);
          } catch {
            // esperado: lo trata el `null` de abajo como archivo dañado.
          }
          const leido = leerArchivo(json);
          if (leido === null) {
            bloqueado = true;
            console.error(
              `[Mycelium] recordatorios · ${NOMBRE} no tiene una forma válida; el calendario arranca vacío y NO se sobrescribe`,
            );
          } else {
            archivo = leido;
          }
        }
      } catch (e) {
        // Sin poder leer no se sabe qué hay: por las dudas, tampoco se escribe.
        bloqueado = true;
        console.error(`[Mycelium] recordatorios · no se pudo leer ${NOMBRE}`, e);
      }
      // Otro `cargar` pudo empezar mientras se leía (cambio rápido de vault, o
      // salir antes de que termine de abrir): manda el último.
      if (carga !== cargaVigente) return;
      const limpio = limpiarOcurrencias(archivo, new Date());
      set({ ruta, archivo: limpio, bloqueado });
      get().revisar();
      iniciarProgramador(() => get().revisar());
    },

    guardar(r) {
      const { archivo } = get();
      const previo = archivo.recordatorios.find((x) => x.id === r.id);
      // `vigenteDesde` se renueva si cambia CUÁNDO ocurre: editar un diario de
      // las 9 a las 8, a las 8:30, no debe avisar en el acto por las 8 de hoy.
      const cambiaCuando =
        !previo ||
        previo.fecha !== r.fecha ||
        previo.hora !== r.hora ||
        previo.repeticion !== r.repeticion;
      const nuevo: Recordatorio = {
        ...r,
        vigenteDesde: cambiaCuando ? momentoLocal(new Date()) : previo?.vigenteDesde,
      };
      const recordatorios = previo
        ? archivo.recordatorios.map((x) => (x.id === r.id ? nuevo : x))
        : [...archivo.recordatorios, nuevo];
      aplicar({ ...archivo, recordatorios });
    },

    eliminar(id) {
      const { archivo } = get();
      // Se va la serie entera (§ 4.3), y con ella el estado de sus ocurrencias.
      aplicar(
        limpiarOcurrencias(
          { ...archivo, recordatorios: archivo.recordatorios.filter((r) => r.id !== id) },
          new Date(),
        ),
      );
    },

    listo(clave) {
      aplicar(descartar(get().archivo, clave));
    },

    posponer(clave, hasta) {
      aplicar(posponer(get().archivo, clave, hasta));
    },

    alternarCompletada(clave) {
      aplicar(alternarCompletada(get().archivo, clave));
    },

    fijarCompletada(clave, completada) {
      aplicar(fijarCompletada(get().archivo, clave, completada));
    },

    restaurar(r, ocurrencias) {
      const nuevo: Recordatorio = { ...r, vigenteDesde: momentoLocal(new Date()) };
      aplicar(restaurarRecordatorio(get().archivo, nuevo, ocurrencias));
    },

    revisar() {
      if (get().ruta === null) {
        set({ avisos: [] });
        return;
      }
      const avisos = avisosPendientes(get().archivo, new Date());
      set({ avisos });
      notificarNuevos(avisos);
    },

    enfocar(fecha, id) {
      set({ foco: { fecha, id, n: ++serie } });
    },

    consumirFoco() {
      set({ foco: null });
    },
  };
});

/** Hoy, como `AAAA-MM-DD` local: el día en el que arranca el calendario. */
export const hoy = () => fechaLocal(new Date());

/** Un id nuevo para un recordatorio. */
export function idRecordatorio(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Qué ventana del calendario está abierta ───────────────────────────────

/**
 * El modal del calendario: ver un recordatorio (su detalle renderizado, con
 * Editar y Eliminar) o editarlo en el formulario. Uno solo para toda la app,
 * montado en el workspace: lo abren la pestaña, el panel y las tarjetas.
 */
export type ModalRecordatorio =
  | { tipo: "ver"; id: string; fecha: string }
  | { tipo: "editar"; borrador: Recordatorio; nuevo: boolean };

export const useModalRecordatorioStore = create<{
  modal: ModalRecordatorio | null;
  abrir: (m: ModalRecordatorio) => void;
  cerrar: () => void;
}>((set) => ({
  modal: null,
  abrir: (modal) => set({ modal }),
  cerrar: () => set({ modal: null }),
}));

/** Abre el formulario para un recordatorio nuevo en `fecha`. */
export function nuevoRecordatorio(fecha: string): void {
  useModalRecordatorioStore.getState().abrir({
    tipo: "editar",
    nuevo: true,
    borrador: {
      id: idRecordatorio(),
      titulo: "",
      fecha,
      hora: null,
      repeticion: "ninguna",
      color: 1,
      detalle: "",
    },
  });
}
