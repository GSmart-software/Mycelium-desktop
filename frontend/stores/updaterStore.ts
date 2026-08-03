import { create } from "zustand";
import { vaciarGuardadosPendientes } from "@/lib/guardadoPendiente";
import {
  buscarActualizacion,
  compararVersiones,
  descargarActualizacion,
  descartarDescarga,
  estadoUpdater,
  fechaLocalHoy,
  fijarVersion,
  instalarActualizacion,
  marcarComprobacion,
  omitirVersion,
  setComprobacionAutomatica,
  setEndpoint,
  setModoAvanzado,
  type EstadoUpdater,
  type InfoActualizacion,
  type ProgresoDescarga,
} from "@/lib/updater";

/**
 * Fase del flujo de actualización. Es un estado y no varios booleanos porque
 * son excluyentes y porque el diálogo se dibuja entero a partir de esto.
 */
export type FaseUpdater =
  | "inactivo"
  | "buscando"
  | "ofreciendo"
  | "descargando"
  | "descargado"
  | "instalando"
  | "error";

type UpdaterState = {
  /** `null` hasta que se lee de Rust por primera vez. */
  estado: EstadoUpdater | null;
  fase: FaseUpdater;
  /** La actualización que se está ofreciendo/instalando. */
  oferta: InfoActualizacion | null;
  progreso: ProgresoDescarga | null;
  error: string | null;
  /** Respuesta del botón manual cuando NO hay nada nuevo (criterio 12). */
  aviso: string | null;
  /** `true` cuando la versión ofrecida es ANTERIOR a la instalada. */
  esBajada: boolean;

  cargarEstado: () => Promise<EstadoUpdater | null>;
  comprobarAlArrancar: () => Promise<void>;
  comprobarManual: () => Promise<void>;
  ofrecerVersion: (version: string, manifiesto: string, notas: string | null) => void;
  descargar: () => Promise<void>;
  instalar: () => Promise<void>;
  masTarde: () => Promise<void>;
  omitir: () => Promise<void>;
  setProgreso: (p: ProgresoDescarga) => void;
  setAuto: (valor: boolean) => Promise<void>;
  setAvanzado: (valor: boolean) => Promise<void>;
  guardarEndpoint: (valor: string | null) => Promise<void>;
  soltarFijacion: () => Promise<void>;
  limpiarAviso: () => void;
};

/** Mensaje de un error que llega de `invoke` (Rust devuelve strings). */
const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Manifiesto de la versión elegida a mano en el modo avanzado.
 *
 * Vive fuera del store a propósito: no lo pinta nada, solo lo consumen
 * `descargar` e `instalar`, y meterlo en el estado obligaría a limpiarlo en
 * cada transición para que no se filtre a una actualización normal. `null`
 * significa "actualización normal a la última publicada".
 */
let manifiestoElegido: string | null = null;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  estado: null,
  fase: "inactivo",
  oferta: null,
  progreso: null,
  error: null,
  aviso: null,
  esBajada: false,

  async cargarEstado() {
    try {
      const estado = await estadoUpdater();
      set({ estado });
      return estado;
    } catch {
      // Sin estado no se ofrece nada; Configuración lo mostrará al reintentar.
      return null;
    }
  },

  /**
   * Comprobación del primer arranque de la jornada. **Silencio absoluto** si
   * algo falla: que el wifi esté caído no es un error del usuario, y un aviso
   * ahí convierte una cortesía en una molestia diaria (criterio 3).
   */
  async comprobarAlArrancar() {
    const estado = await get().cargarEstado();
    if (!estado || !estado.habilitado) return;
    // Con una versión fijada a mano, la app deja de empujar a actualizar: si
    // bajaste para investigar algo, el aviso diario es justo lo contrario de
    // lo que necesitás (`FUN-M-16`, criterio 17).
    if (estado.versionFijada) return;
    if (!estado.auto) return;
    const hoy = fechaLocalHoy();
    if (estado.ultimaComprobacion === hoy) return;

    try {
      const info = await buscarActualizacion();
      await marcarComprobacion(hoy);
      await get().cargarEstado();
      if (!info) return;
      if (info.version === estado.versionOmitida) return; // criterio 5
      manifiestoElegido = null; // actualización normal, no elección a mano
      set({ fase: "ofreciendo", oferta: info, esBajada: false, error: null });
    } catch {
      // Sin conexión / manifiesto caído: no se avisa de nada y se reintenta
      // mañana. La fecha NO se marca, así que el próximo arranque lo reintenta.
    }
  },

  /**
   * Botón "Buscar actualizaciones". A diferencia del arranque, informa **en los
   * dos sentidos**: si no hay nada nuevo lo dice, y si falla la red también.
   * Es lo que tapa el agujero de la cadencia diaria cuando se publican dos
   * versiones el mismo día (criterios 12 y 13).
   */
  async comprobarManual() {
    const estado = get().estado ?? (await get().cargarEstado());
    if (!estado?.habilitado) {
      set({ aviso: estado?.motivo ?? "El updater no está configurado." });
      return;
    }
    set({ fase: "buscando", error: null, aviso: null });
    try {
      const info = await buscarActualizacion();
      await marcarComprobacion(fechaLocalHoy());
      await get().cargarEstado();
      if (!info) {
        set({
          fase: "inactivo",
          aviso: `Ya estás en la última versión (${estado.versionActual}).`,
        });
        return;
      }
      // Buscar a mano vuelve a ofrecer incluso una versión omitida: pedirlo
      // explícitamente es cambiar de opinión, así que se olvida la omisión.
      if (info.version === estado.versionOmitida) await omitirVersion(null);
      manifiestoElegido = null;
      set({ fase: "ofreciendo", oferta: info, esBajada: false });
    } catch (e) {
      set({ fase: "inactivo", aviso: `No se pudo comprobar: ${texto(e)}` });
    }
  },

  /** Modo avanzado: ofrecer una versión elegida a mano de la lista. */
  ofrecerVersion(version, manifiesto, notas) {
    const actual = get().estado?.versionActual ?? "0.0.0";
    set({
      fase: "ofreciendo",
      oferta: { version, versionActual: actual, notas, fecha: null },
      esBajada: compararVersiones(version, actual) < 0,
      error: null,
      aviso: null,
      progreso: null,
    });
    manifiestoElegido = manifiesto;
  },

  async descargar() {
    const oferta = get().oferta;
    if (!oferta) return;
    // La versión solo se manda cuando se eligió a mano: sin ella, Rust usa el
    // manifiesto raíz y la comparación por defecto (solo hacia arriba).
    const elegida = manifiestoElegido === null ? null : oferta.version;
    set({ fase: "descargando", progreso: { descargado: 0, total: null }, error: null });
    try {
      await descargarActualizacion(elegida, manifiestoElegido);
      set({ fase: "descargado" });
    } catch (e) {
      set({ fase: "error", error: texto(e) });
    }
  },

  /**
   * Instala lo descargado. Antes vacía los guardados pendientes de todos los
   * editores: el instalador cierra la app y el debounce del editor no tiene por
   * qué haber corrido todavía (criterio 7).
   */
  async instalar() {
    set({ fase: "instalando", error: null });
    try {
      await vaciarGuardadosPendientes();
      const oferta = get().oferta;
      // Instalar una versión elegida a mano la deja FIJADA (criterio 17). Se
      // anota ANTES de instalar porque instalar no vuelve: el proceso termina.
      if (oferta && manifiestoElegido !== null) await fijarVersion(oferta.version);
      await instalarActualizacion();
    } catch (e) {
      set({ fase: "error", error: texto(e) });
    }
  },

  /** "Más tarde": se cierra y mañana se vuelve a ofrecer (criterio 4). */
  async masTarde() {
    manifiestoElegido = null;
    set({ fase: "inactivo", oferta: null, progreso: null, error: null, esBajada: false });
    try {
      await descartarDescarga();
    } catch {
      // si no había nada descargado, da igual
    }
  },

  /** "Omitir esta versión": no se vuelve a mencionar ESA versión (criterio 5). */
  async omitir() {
    const version = get().oferta?.version ?? null;
    if (version) await omitirVersion(version);
    await get().masTarde();
    await get().cargarEstado();
  },

  setProgreso(progreso) {
    if (get().fase === "descargando") set({ progreso });
  },

  async setAuto(valor) {
    await setComprobacionAutomatica(valor);
    await get().cargarEstado();
  },

  async setAvanzado(valor) {
    await setModoAvanzado(valor);
    await get().cargarEstado();
  },

  async guardarEndpoint(valor) {
    await setEndpoint(valor);
    await get().cargarEstado();
  },

  /** Quita la fijación: vuelve el comportamiento normal (criterio 18). */
  async soltarFijacion() {
    await fijarVersion(null);
    await get().cargarEstado();
  },

  limpiarAviso() {
    set({ aviso: null });
  },
}));
