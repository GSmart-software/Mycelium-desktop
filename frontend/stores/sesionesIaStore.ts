import { create } from "zustand";
import {
  conActividad,
  conConectadas,
  leerDatosSesion,
  sinOlvidadas,
  sinReservasDe,
  vigentes,
  VENTANA_RECIENTES_MS,
  type CambioExterno,
  type DatosSesion,
  type Reserva,
  type SesionIa,
} from "@/lib/sesionesIa";

/**
 * Las sesiones de IA conectadas a esta ventana y sus reservas (`FUN-L-31`).
 * La lógica pura está en `lib/sesionesIa.ts`; quién está conectado lo dice Rust
 * (`control.rs`, evento `mcp-sesiones`), y la tarea, la última actividad y las
 * reservas las anota `lib/mcpControl.ts` con cada pedido.
 *
 * **En memoria**, a propósito: no se guarda nada. Si Mycelium se cierra (o se
 * apaga el control, o se cambia de vault), las sesiones y las reservas se
 * pierden; los servidores se vuelven a anunciar solos al reabrir, pero sin su
 * tarea ni sus reservas, que se declaran de nuevo.
 */
type Estado = {
  sesiones: Record<string, SesionIa>;
  reservas: Reserva[];
  /** Notas que cambiaron en disco sin pasar por Mycelium (watcher), recientes. */
  externos: CambioExterno[];

  /** Rust avisó cuáles están conectadas (la lista entera). */
  fijarConectadas: (lista: readonly unknown[]) => void;
  /** Llegó un pedido de esta sesión: la registra si hace falta. Devuelve su id. */
  alPedido: (datos: unknown) => string | null;
  fijarTarea: (id: string, tarea: string) => void;
  fijarReservas: (reservas: Reserva[]) => void;
  /** El watcher vio cambios que no escribió la app. */
  anotarExternos: (cambios: readonly CambioExterno[]) => void;
  /** Olvida lo vencido: reservas y sesiones que nunca se anunciaron. */
  podar: () => void;
  vaciar: () => void;
};

/** Tope de cambios externos recordados (se podan además por antigüedad). */
const TOPE_EXTERNOS = 300;

export const useSesionesIaStore = create<Estado>((set, get) => ({
  sesiones: {},
  reservas: [],
  externos: [],

  fijarConectadas(lista) {
    const conectadas = lista.map(leerDatosSesion).filter((d): d is DatosSesion => d !== null);
    const { sesiones, murieron } = conConectadas(get().sesiones, conectadas);
    set((s) => ({ sesiones, reservas: sinReservasDe(s.reservas, murieron) }));
  },

  alPedido(datos) {
    const d = leerDatosSesion(datos);
    if (d === null) return null;
    set((s) => ({ sesiones: conActividad(s.sesiones, d, Date.now()) }));
    return d.id;
  },

  fijarTarea(id, tarea) {
    const s = get().sesiones[id];
    if (!s) return;
    set((e) => ({ sesiones: { ...e.sesiones, [id]: { ...s, tarea } } }));
  },

  fijarReservas(reservas) {
    set({ reservas });
  },

  anotarExternos(cambios) {
    if (cambios.length === 0) return;
    const ahora = Date.now();
    const quedan = [...get().externos, ...cambios].filter((c) => ahora - c.momento <= VENTANA_RECIENTES_MS);
    set({ externos: quedan.slice(-TOPE_EXTERNOS) });
  },

  podar() {
    const ahora = Date.now();
    const { sesiones, olvidadas } = sinOlvidadas(get().sesiones, ahora);
    const reservas = sinReservasDe(vigentes(get().reservas, ahora), olvidadas);
    const externos = get().externos.filter((c) => ahora - c.momento <= VENTANA_RECIENTES_MS);
    if (olvidadas.length === 0 && reservas.length === get().reservas.length && externos.length === get().externos.length) return;
    set({ sesiones, reservas, externos });
  },

  vaciar() {
    set({ sesiones: {}, reservas: [], externos: [] });
  },
}));
