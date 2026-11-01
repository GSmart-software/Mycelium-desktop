/**
 * Las operaciones de coordinación entre sesiones del MCP de control
 * (`FUN-L-31`): `sesion` (declarar la tarea), `reservar` (reservar o liberar
 * una nota o carpeta) y lo que `estado` agrega sobre las otras sesiones. La
 * lógica pura está en `lib/sesionesIa.ts`; el estado, en
 * `stores/sesionesIaStore.ts` (en memoria).
 */
import { NOMBRE_OP, type Atendido } from "@/lib/actividadIa";
import { resolverAfectado } from "@/lib/mcpArchivosLogica";
import {
  coordinacion as armarCoordinacion,
  efectoLiberar,
  efectoReserva,
  liberar,
  normalizarRuta,
  objetivoDeReserva,
  reservar as concederReserva,
  validarReservar,
  validarSesion,
  type Coordinacion,
  type ErrorSesiones,
  type Validado,
} from "@/lib/sesionesIa";
import { useActividadIaStore } from "@/stores/actividadIaStore";
import { useSesionesIaStore } from "@/stores/sesionesIaStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Un error tipificado de estas operaciones (`mcpControl.ts` lo pasa tal cual). */
export class FalloSesiones extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly datos: unknown = null,
  ) {
    super(mensaje);
  }
}

function exigir<T>(v: Validado<T>): T {
  if (v.ok) return v.valor;
  const e: ErrorSesiones = v.error;
  throw new FalloSesiones(e.codigo, e.mensaje, e.datos);
}

/** Lo que se le cuenta a la sesión `propia` de las demás. */
export function coordinacionPara(propia: string | null): Coordinacion {
  const s = useSesionesIaStore.getState();
  s.podar();
  const { sesiones, reservas, externos } = useSesionesIaStore.getState();
  return armarCoordinacion({
    propia,
    sesiones,
    reservas,
    externos,
    entradas: useActividadIaStore.getState().entradas,
    ahora: Date.now(),
    nombreOp: NOMBRE_OP,
  });
}

function sinSesion(): never {
  throw new FalloSesiones(
    "INVALIDO",
    "El pedido no dice de qué sesión viene: el servidor MCP es de una versión que no conoce las sesiones. " +
      "Cierra y vuelve a abrir la sesión de Claude Code para que tome el de esta Mycelium.",
  );
}

/** `mycelium_sesion({tarea})`. */
export function sesion(args: Record<string, unknown>, propia: string | null): Atendido {
  const { tarea } = exigir(validarSesion(args));
  if (propia === null) sinSesion();
  const previa = useSesionesIaStore.getState().sesiones[propia]?.tarea ?? null;
  useSesionesIaStore.getState().fijarTarea(propia, tarea);
  const efecto = previa === null || previa === tarea ? `Tarea declarada: «${tarea}».` : `Tarea cambiada: «${previa}» → «${tarea}».`;
  return { resultado: { efecto, coordinacion: coordinacionPara(propia) }, actividad: { efecto } };
}

/** `mycelium_reservar({objetivo, motivo, minutos?, liberar?})`. */
export function reservar(args: Record<string, unknown>, propia: string | null): Atendido {
  const pedido = exigir(validarReservar(args));
  if (propia === null) sinSesion();
  const ahora = Date.now();
  const store = useSesionesIaStore.getState();

  if (pedido.liberar) {
    // Se suelta por la ruta escrita o por lo que resuelva (un título).
    let ruta: string | null = null;
    if (pedido.objetivo !== null) {
      const { notas, carpetas, otros } = useVaultStore.getState();
      const r = objetivoDeReserva(pedido.objetivo, resolverAfectado(pedido.objetivo, notas, carpetas, otros));
      ruta = r.ok ? r.valor.ruta : normalizarRuta(pedido.objetivo);
    }
    const { reservas, liberadas } = liberar(store.reservas, propia, ruta, ahora);
    store.fijarReservas(reservas);
    const efecto = efectoLiberar(liberadas, ruta);
    return {
      resultado: { efecto, liberadas: liberadas.length, coordinacion: coordinacionPara(propia) },
      // Liberar sin nada que liberar no ensucia el registro.
      ...(liberadas.length > 0 ? { actividad: { efecto } } : { sinRegistro: true }),
    };
  }

  const { notas, carpetas, otros } = useVaultStore.getState();
  const objetivo = exigir(objetivoDeReserva(pedido.objetivo, resolverAfectado(pedido.objetivo, notas, carpetas, otros)));
  const nueva = { sesion: propia, objetivo, motivo: pedido.motivo, desde: ahora, vence: ahora + pedido.minutos * 60_000 };
  const { reservas, conflictos, renovada } = concederReserva(store.reservas, nueva, ahora);
  store.fijarReservas(reservas);
  const efecto = efectoReserva(nueva, conflictos, renovada, store.sesiones, ahora);
  return {
    resultado: {
      efecto,
      reserva: { ruta: objetivo.ruta, clase: objetivo.clase, existe: objetivo.existe, vence_min: pedido.minutos },
      conflictos: conflictos.length,
      coordinacion: coordinacionPara(propia),
    },
    actividad: {
      efecto,
      ...(objetivo.existe ? { objetivo: objetivo.clase === "nota" ? { tipo: "nota", ruta: objetivo.ruta } : { tipo: "carpeta", ruta: objetivo.ruta } } : {}),
    },
  };
}
