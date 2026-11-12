import { create } from "zustand";
import {
  archivoVacio,
  avisosPendientes,
  combinarAlcances,
  conAlcance,
  descartar,
  fechaLocal,
  filtrarPorAlcance,
  fijarCompletada,
  idDeClave,
  leerArchivo,
  limpiarOcurrencias,
  momentoLocal,
  ocurrenciasDe,
  ponerRecordatorio,
  posponer,
  quitarRecordatorio,
  restaurarRecordatorio,
  type Alcance,
  type ArchivoRecordatorios,
  type Aviso,
  type EstadoOcurrencia,
  type FiltroAlcance,
  type Recordatorio,
} from "@/lib/recordatorios";
import {
  detenerProgramador,
  iniciarProgramador,
  notificarNuevos,
  olvidarNotificados,
} from "@/lib/avisosRecordatorio";
import {
  escucharPersonales,
  leerPersonales,
  modificarPersonales,
  PersonalesDanados,
  reclamarAvisos,
} from "@/lib/recordatoriosPersonales";
import { avisar } from "@/stores/avisosStore";

/**
 * Los recordatorios del calendario (`FUN-L-22`): los **del vault abierto** y,
 * desde `FUN-M-60`, los **personales**.
 *
 * Los del vault viven en `.mycelium/recordatorios.json` (§ 3 de la spec): no
 * son archivos del vault —no aparecen en el explorador, la búsqueda ni el
 * grafo— pero viajan con él. Cada ventana tiene su propio store, así que un
 * vault nunca avisa lo de otro.
 *
 * Los personales viven en la carpeta de datos de la app
 * (`lib/recordatoriosPersonales.ts`): los mismos desde todos los vaults. Cada
 * ventana los carga y escucha sus cambios; cambiar uno se guarda con la huella
 * de lo leído (dos ventanas no se pisan), y su aviso lo muestra **una sola
 * ventana** (`reclamarAvisos`).
 *
 * El calendario los muestra juntos (`vista`), con el filtro aplicado en
 * `visibles`. Las operaciones por id o por clave buscan solas en qué archivo
 * está el recordatorio: los ids son UUID y no se repiten entre los dos.
 *
 * El ciclo lo lleva `vaultSessionStore`: `cargar(ruta)` al abrir, que además
 * arranca el programador de avisos, y `cargar(null)` al salir, que lo detiene y
 * vacía todo.
 */

const NOMBRE = "recordatorios.json";

/** Clave de `localStorage`: el filtro del calendario. Comodidad, no estado. */
const CLAVE_FILTRO = "mic-calendario-filtro";

async function invocar<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Qué pidió «Abrir» en una tarjeta: el día, y el recordatorio a seleccionar. */
export type FocoCalendario = { fecha: string; id: string | null; n: number };

type Estado = {
  /** Vault de estos recordatorios; `null` = ninguno abierto. */
  ruta: string | null;
  /** Los del vault (`.mycelium/recordatorios.json`). */
  archivo: ArchivoRecordatorios;
  /**
   * El archivo existe pero no se pudo leer. Mientras tanto **no se escribe**:
   * el calendario arranca vacío y sobrescribirlo borraría lo que todavía se
   * puede recuperar a mano (§ 3).
   */
  bloqueado: boolean;
  /** Los personales (`FUN-M-60`). */
  personal: ArchivoRecordatorios;
  /** Lo mismo que `bloqueado`, para el archivo de los personales. */
  personalBloqueado: boolean;
  /** Los dos alcances juntos: lo que muestra el calendario, sin filtrar. */
  vista: ArchivoRecordatorios;
  /** Los ids de los personales, para la marca y el filtro. */
  personales: ReadonlySet<string>;
  filtro: FiltroAlcance;
  /** Los recordatorios que deja ver el filtro. */
  visibles: Recordatorio[];
  /** Los avisos que se muestran ahora: tarjetas que no se van solas. */
  avisos: Aviso[];
  /** El último pedido de «Abrir» desde una tarjeta; lo consume el calendario. */
  foco: FocoCalendario | null;

  cargar: (ruta: string | null) => Promise<void>;
  /**
   * Crea o reemplaza un recordatorio (por `id`). `alcance`: dónde va; sin él,
   * donde ya estaba (o en el vault, si es nuevo). Si cambia, lo **mueve** de un
   * archivo al otro con el estado de sus ocurrencias.
   */
  guardar: (r: Recordatorio, alcance?: Alcance) => void;
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
   * ocurrencias (el Deshacer del registro de actividad), en su alcance. Como
   * al crearlo, su `vigenteDesde` es ahora: restaurar no avisa lo que venció
   * mientras no estaba.
   */
  restaurar: (r: Recordatorio, ocurrencias: Record<string, EstadoOcurrencia>, alcance?: Alcance) => void;
  /** En qué archivo está ese recordatorio; `null` si en ninguno. */
  alcanceDe: (id: string) => Alcance | null;
  setFiltro: (f: FiltroAlcance) => void;
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
let avisadoBloqueoPersonal = false;

function persistir(ruta: string, archivo: ArchivoRecordatorios) {
  const contenido = JSON.stringify(archivo, null, 2);
  cola = cola
    .then(() => invocar<void>("escribir_estado_vault", { ruta, nombre: NOMBRE, contenido }))
    .catch((e) => {
      console.error(`[Mycelium] recordatorios · no se pudo guardar ${NOMBRE}`, e);
      avisar("No se pudo guardar el calendario. El último cambio puede perderse al cerrar.");
    });
}

/** La fila de los personales: cada cambio se aplica sobre lo último del disco. */
let colaPersonal: Promise<void> = Promise.resolve();
/** Cuántos cambios personales faltan escribir: mientras haya, no se recarga del disco. */
let personalesEnCurso = 0;
/** Con qué dejar de escuchar los cambios de los personales. */
let dejarDeEscuchar: (() => void) | null = null;
/** Los avisos personales (`clave|momento`) que muestra ESTA ventana. */
let reclamados = new Set<string>();

const llaveAviso = (a: Aviso) => `${a.clave}|${a.momento.getTime()}`;

let serie = 0;
/** Cuál es la última carga pedida: una más vieja que termina tarde no manda. */
let cargaVigente = 0;

function filtroGuardado(): FiltroAlcance {
  try {
    const f = localStorage.getItem(CLAVE_FILTRO);
    return f === "vault" || f === "personal" ? f : "todos";
  } catch {
    return "todos";
  }
}

/** Lo que se deriva de los dos archivos y el filtro. */
function derivar(archivo: ArchivoRecordatorios, personal: ArchivoRecordatorios, filtro: FiltroAlcance) {
  const vista = combinarAlcances(archivo, personal);
  const personales: ReadonlySet<string> = new Set(personal.recordatorios.map((r) => r.id));
  return { vista, personales, visibles: filtrarPorAlcance(vista.recordatorios, personales, filtro) };
}

/** Lee el archivo del vault: el archivo, o `null` si está dañado o no se pudo leer. */
async function leerDelVault(ruta: string): Promise<ArchivoRecordatorios | null> {
  try {
    const texto = await invocar<string | null>("leer_estado_vault", { ruta, nombre: NOMBRE });
    if (texto === null) return archivoVacio();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // esperado: lo trata el `null` de abajo como archivo dañado.
    }
    const leido = leerArchivo(json);
    if (leido === null) {
      console.error(
        `[Mycelium] recordatorios · ${NOMBRE} no tiene una forma válida; el calendario arranca vacío y NO se sobrescribe`,
      );
    }
    return leido;
  } catch (e) {
    // Sin poder leer no se sabe qué hay: por las dudas, tampoco se escribe.
    console.error(`[Mycelium] recordatorios · no se pudo leer ${NOMBRE}`, e);
    return null;
  }
}

/** Lee los personales: el archivo, o `null` si está dañado o no se pudo leer. */
async function leerLosPersonales(): Promise<ArchivoRecordatorios | null> {
  try {
    const { archivo, ruta } = await leerPersonales();
    if (archivo === null) {
      console.error(`[Mycelium] recordatorios · ${ruta} no tiene una forma válida; los personales NO se sobrescriben`);
    }
    return archivo;
  } catch (e) {
    console.error("[Mycelium] recordatorios · no se pudieron leer los personales", e);
    return null;
  }
}

export const useRecordatoriosStore = create<Estado>((set, get) => {
  /** Pone archivos nuevos en memoria y recalcula lo derivado. */
  function poner(cambios: { archivo?: ArchivoRecordatorios; personal?: ArchivoRecordatorios; filtro?: FiltroAlcance }) {
    const s = get();
    const archivo = cambios.archivo ?? s.archivo;
    const personal = cambios.personal ?? s.personal;
    const filtro = cambios.filtro ?? s.filtro;
    set({ archivo, personal, filtro, ...derivar(archivo, personal, filtro) });
  }

  /** Aplica un archivo del vault nuevo: lo guarda en disco y recalcula los avisos. */
  function aplicar(archivo: ArchivoRecordatorios) {
    poner({ archivo });
    const { ruta, bloqueado } = get();
    if (ruta !== null) {
      if (bloqueado) {
        // Se conserva en memoria, pero el archivo dañado no se toca. Se dice
        // una vez: repetirlo en cada cambio no ayudaría a arreglarlo.
        if (!avisadoBloqueo) {
          avisadoBloqueo = true;
          avisar(
            "El calendario no se guarda: .mycelium/recordatorios.json está dañado. Arréglalo o bórralo para volver a guardar.",
          );
        }
      } else {
        persistir(ruta, archivo);
      }
    }
    get().revisar();
  }

  /**
   * Aplica un cambio a los personales: en memoria al instante, y en disco
   * sobre lo último que haya (otra ventana pudo escribir en el medio).
   */
  function aplicarPersonal(cambio: (a: ArchivoRecordatorios) => ArchivoRecordatorios) {
    const { ruta, personalBloqueado } = get();
    if (ruta === null) return;
    poner({ personal: cambio(get().personal) });
    get().revisar();
    if (personalBloqueado) {
      if (!avisadoBloqueoPersonal) {
        avisadoBloqueoPersonal = true;
        avisar(
          "Los recordatorios personales no se guardan: su archivo está dañado. Arréglalo o bórralo para volver a guardar.",
        );
      }
      return;
    }
    personalesEnCurso++;
    colaPersonal = colaPersonal
      .then(async () => {
        const escrito = await modificarPersonales(cambio);
        // Con la fila vacía, lo escrito es lo último: incluye lo que hayan
        // hecho otras ventanas. Con más cambios atrás, manda la memoria.
        if (personalesEnCurso === 1 && get().ruta === ruta) {
          poner({ personal: limpiarOcurrencias(escrito, new Date()) });
          get().revisar();
        }
      })
      .catch((e) => {
        console.error("[Mycelium] recordatorios · no se pudieron guardar los personales", e);
        avisar(
          e instanceof PersonalesDanados
            ? "Los recordatorios personales no se guardan: su archivo está dañado."
            : "No se pudo guardar un recordatorio personal. El último cambio puede perderse al cerrar.",
        );
      })
      .finally(() => {
        personalesEnCurso--;
      });
  }

  /** Aplica un cambio en el archivo de ese alcance. */
  function modificar(alcance: Alcance, cambio: (a: ArchivoRecordatorios) => ArchivoRecordatorios) {
    if (alcance === "personal") aplicarPersonal(cambio);
    else aplicar(cambio(get().archivo));
  }

  /** Vuelve a leer los personales (otra ventana —o esta— los cambió). */
  async function recargarPersonales() {
    if (personalesEnCurso > 0) return; // lo pone la fila al terminar
    const ruta = get().ruta;
    if (ruta === null) return;
    const leido = await leerLosPersonales();
    if (get().ruta !== ruta || personalesEnCurso > 0) return;
    if (leido === null) {
      set({ personalBloqueado: true });
      return;
    }
    set({ personalBloqueado: false });
    poner({ personal: limpiarOcurrencias(leido, new Date()) });
    get().revisar();
  }

  /** Publica los avisos: los del vault y los personales que son de ESTA ventana. */
  function publicar() {
    const { archivo, personal } = get();
    const ahora = new Date();
    const avisos = [
      ...avisosPendientes(archivo, ahora),
      ...avisosPendientes(personal, ahora).filter((a) => reclamados.has(llaveAviso(a))),
    ].sort((a, b) => a.momento.getTime() - b.momento.getTime());
    set({ avisos });
    notificarNuevos(avisos);
  }

  const alcanceDeClave = (clave: string): Alcance => get().alcanceDe(idDeClave(clave)) ?? "vault";

  const filtro = filtroGuardado();
  return {
    ruta: null,
    archivo: archivoVacio(),
    bloqueado: false,
    personal: archivoVacio(),
    personalBloqueado: false,
    filtro,
    ...derivar(archivoVacio(), archivoVacio(), filtro),
    avisos: [],
    foco: null,

    async cargar(ruta) {
      if (get().ruta === ruta) return;
      const carga = ++cargaVigente;
      detenerProgramador();
      olvidarNotificados();
      dejarDeEscuchar?.();
      dejarDeEscuchar = null;
      reclamados = new Set();
      avisadoBloqueo = false;
      avisadoBloqueoPersonal = false;
      set({ ruta: null, bloqueado: false, personalBloqueado: false, avisos: [], foco: null });
      poner({ archivo: archivoVacio(), personal: archivoVacio() });
      if (ruta === null) return;

      const [delVault, personal] = await Promise.all([leerDelVault(ruta), leerLosPersonales()]);
      // Otro `cargar` pudo empezar mientras se leía (cambio rápido de vault, o
      // salir antes de que termine de abrir): manda el último.
      if (carga !== cargaVigente) return;
      const ahora = new Date();
      set({ ruta, bloqueado: delVault === null, personalBloqueado: personal === null });
      poner({
        archivo: limpiarOcurrencias(delVault ?? archivoVacio(), ahora),
        personal: limpiarOcurrencias(personal ?? archivoVacio(), ahora),
      });
      get().revisar();
      iniciarProgramador(() => get().revisar());
      try {
        const dejar = await escucharPersonales(() => void recargarPersonales());
        if (carga === cargaVigente) dejarDeEscuchar = dejar;
        else dejar();
      } catch {
        // Fuera de Tauri no hay otras ventanas que escuchar.
      }
    },

    guardar(r, alcance) {
      const { vista, ruta } = get();
      const actual = get().alcanceDe(r.id);
      const destino = alcance ?? actual ?? "vault";
      const previo = vista.recordatorios.find((x) => x.id === r.id);
      // `vigenteDesde` se renueva si cambia CUÁNDO ocurre: editar un diario de
      // las 9 a las 8, a las 8:30, no debe avisar en el acto por las 8 de hoy.
      const cambiaCuando =
        !previo ||
        previo.fecha !== r.fecha ||
        previo.hora !== r.hora ||
        previo.repeticion !== r.repeticion;
      const nuevo = conAlcance(
        { ...r, vigenteDesde: cambiaCuando ? momentoLocal(new Date()) : previo?.vigenteDesde },
        destino,
        ruta,
      );
      if (nuevo.vigenteDesde === undefined) delete nuevo.vigenteDesde;
      if (actual === null || actual === destino) {
        modificar(destino, (a) => ponerRecordatorio(a, nuevo));
        return;
      }
      // Cambia de alcance: se pone en el nuevo con el estado de sus ocurrencias
      // y después se saca del viejo. En ese orden: si algo falla en el medio,
      // queda repetido y no perdido.
      const ocurrencias = ocurrenciasDe(actual === "personal" ? get().personal : get().archivo, r.id);
      modificar(destino, (a) => restaurarRecordatorio(a, nuevo, ocurrencias));
      modificar(actual, (a) => quitarRecordatorio(a, r.id));
    },

    eliminar(id) {
      // Se va la serie entera (§ 4.3), y con ella el estado de sus ocurrencias.
      const alcance = get().alcanceDe(id);
      if (alcance !== null) modificar(alcance, (a) => quitarRecordatorio(a, id));
    },

    listo(clave) {
      modificar(alcanceDeClave(clave), (a) => descartar(a, clave));
    },

    posponer(clave, hasta) {
      modificar(alcanceDeClave(clave), (a) => posponer(a, clave, hasta));
    },

    alternarCompletada(clave) {
      // Al disco va el valor que se pidió viendo la pantalla, no «alternar»: si
      // otra ventana lo cambió en el medio, alternar otra vez lo desharía.
      const completada = get().vista.ocurrencias[clave]?.completada !== true;
      modificar(alcanceDeClave(clave), (a) => fijarCompletada(a, clave, completada));
    },

    fijarCompletada(clave, completada) {
      modificar(alcanceDeClave(clave), (a) => fijarCompletada(a, clave, completada));
    },

    restaurar(r, ocurrencias, alcance = "vault") {
      const nuevo = conAlcance({ ...r, vigenteDesde: momentoLocal(new Date()) }, alcance, get().ruta);
      modificar(alcance, (a) => restaurarRecordatorio(a, nuevo, ocurrencias));
    },

    alcanceDe(id) {
      const { archivo, personal } = get();
      if (personal.recordatorios.some((r) => r.id === id)) return "personal";
      if (archivo.recordatorios.some((r) => r.id === id)) return "vault";
      return null;
    },

    setFiltro(f) {
      try {
        localStorage.setItem(CLAVE_FILTRO, f);
      } catch {
        // sin almacenamiento, el filtro dura lo que la ventana
      }
      poner({ filtro: f });
    },

    revisar() {
      const ruta = get().ruta;
      if (ruta === null) {
        set({ avisos: [] });
        return;
      }
      publicar();
      // Los personales los avisa una sola ventana: se pregunta cuáles son de
      // esta. Lo ya reclamado se muestra sin esperar la respuesta.
      const llaves = avisosPendientes(get().personal, new Date()).map(llaveAviso);
      if (llaves.length === 0) {
        reclamados = new Set();
        return;
      }
      void reclamarAvisos(llaves).then((mias) => {
        if (get().ruta !== ruta) return;
        const nuevos = new Set(mias);
        const igual = nuevos.size === reclamados.size && [...nuevos].every((k) => reclamados.has(k));
        reclamados = nuevos;
        if (!igual) publicar();
      });
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
 * montado en el workspace: lo abren la pestaña, el panel y las tarjetas. El
 * alcance de uno existente lo sabe el store; uno nuevo arranca en el vault.
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
