/**
 * Las herramientas del calendario del MCP de control (`FUN-L-09`, Parte 2),
 * atendidas sobre `recordatoriosStore`: **lo mismo que hace la UI** al crear,
 * editar, completar o borrar desde el formulario —fijar `vigenteDesde`,
 * guardar en `.mycelium/recordatorios.json`, recalcular los avisos—, así que
 * lo que crea el agente se ve y avisa igual que lo que crea el usuario.
 *
 * La validación, los textos y el deshacer son puros y están en
 * `lib/mcpCalendarioLogica.ts`. Lo llama `lib/mcpControl.ts`.
 */
import {
  buscarRecordatorio,
  comprobarOcurrencia,
  efectoBorrar,
  efectoCompletar,
  efectoCrear,
  efectoEditar,
  nombreDeColor,
  ocurrenciasParaIa,
  proximaOcurrencia,
  puedeDeshacer,
  validarBorrar,
  validarCompletar,
  validarCrear,
  validarEditar,
  validarRango,
  type DeshacerCalendario,
  type Validado,
} from "@/lib/mcpCalendarioLogica";
import type { Entrada, Objetivo } from "@/lib/actividadIa";
import {
  claveOcurrencia,
  estaCompletada,
  ocurrenciasDe,
  type Recordatorio,
} from "@/lib/recordatorios";
import { useActividadIaStore } from "@/stores/actividadIaStore";
import { idRecordatorio, useRecordatoriosStore } from "@/stores/recordatoriosStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";

/** Un error del contrato, para que `mcpControl.ts` lo convierta en respuesta. */
export class FalloCalendario extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly datos: unknown = null,
  ) {
    super(mensaje);
  }
}

/** Lo que vuelve de una operación: el resultado para el agente y lo que va al registro. */
export type Atendido = {
  resultado: unknown;
  actividad?: { efecto: string; objetivo?: Objetivo; deshacer?: DeshacerCalendario };
};

function exigir<T>(v: Validado<T>): T {
  if (!v.ok) throw new FalloCalendario(v.error.codigo, v.error.mensaje, v.error.datos);
  return v.valor;
}

/**
 * El calendario de ESTE vault, cargado. Se carga al abrir el vault y sin
 * esperar; un pedido en ese instante recibe `OCUPADA` en vez de un calendario
 * vacío que no es el real.
 */
function calendario(escribe: boolean) {
  const s = useRecordatoriosStore.getState();
  const vault = useVaultSessionStore.getState().rutaActual;
  if (s.ruta === null || s.ruta !== vault) {
    throw new FalloCalendario("OCUPADA", "Mycelium todavía está cargando el calendario del vault.", {
      etapa: "cargando el calendario",
      reintentar_en_ms: 1000,
    });
  }
  if (escribe && s.bloqueado) {
    throw new FalloCalendario(
      "INVALIDO",
      "El calendario no se puede modificar: .mycelium/recordatorios.json está dañado y Mycelium no lo sobrescribe " +
        "para no perder lo que se pueda recuperar. Decíselo al usuario: tiene que arreglarlo o borrarlo.",
      { campo: "recordatorios.json" },
    );
  }
  return s;
}

/** El recordatorio como lo ve el agente. */
function paraIa(r: Recordatorio) {
  return {
    id: r.id,
    titulo: r.titulo,
    fecha: r.fecha,
    hora: r.hora,
    repeticion: r.repeticion,
    color: nombreDeColor(r.color),
  };
}

function proximaParaIa(r: Recordatorio, ahora: Date) {
  const { proxima, avisa } = proximaOcurrencia(r, ahora);
  return { proxima: proxima === null ? null : { fecha: proxima, hora: r.hora }, avisa: avisa !== null };
}

// ── Las operaciones ─────────────────────────────────────────────────────────

export function recordatorios(args: Record<string, unknown>): Atendido {
  const { desde, hasta } = exigir(validarRango(args));
  const { archivo } = calendario(false);
  return { resultado: { desde, hasta, ocurrencias: ocurrenciasParaIa(archivo, desde, hasta) } };
}

export function crear(args: Record<string, unknown>): Atendido {
  const campos = exigir(validarCrear(args));
  const store = calendario(true);
  const id = idRecordatorio();
  store.guardar({ id, ...campos });
  // `guardar` fija `vigenteDesde`: se lee de vuelta lo que quedó guardado.
  const r = useRecordatoriosStore.getState().archivo.recordatorios.find((x) => x.id === id)!;
  const ahora = new Date();
  const efecto = efectoCrear(r, ahora);
  return {
    resultado: { efecto, recordatorio: paraIa(r), ...proximaParaIa(r, ahora) },
    actividad: { efecto, objetivo: objetivoDe(r, ahora), deshacer: { tipo: "borrar", id } },
  };
}

export function editar(args: Record<string, unknown>): Atendido {
  const { id, cambios } = exigir(validarEditar(args));
  const store = calendario(true);
  const antes = exigir(buscarRecordatorio(store.archivo, id));
  const pedido: Recordatorio = { ...antes, ...cambios };
  store.guardar(pedido);
  const despues = useRecordatoriosStore.getState().archivo.recordatorios.find((x) => x.id === id)!;
  const ahora = new Date();
  const efecto = efectoEditar(antes, despues, ahora);
  return {
    resultado: { efecto, recordatorio: paraIa(despues), ...proximaParaIa(despues, ahora) },
    actividad: { efecto, objetivo: objetivoDe(despues, ahora), deshacer: { tipo: "reponer", recordatorio: antes } },
  };
}

export function completar(args: Record<string, unknown>): Atendido {
  const { id, fecha, completado } = exigir(validarCompletar(args));
  const store = calendario(true);
  const r = exigir(buscarRecordatorio(store.archivo, id));
  exigir(comprobarOcurrencia(r, fecha));
  const clave = claveOcurrencia(id, fecha);
  const previo = estaCompletada(store.archivo, clave);
  store.fijarCompletada(clave, completado);
  const efecto = efectoCompletar(r, fecha, completado, previo, new Date());
  return {
    resultado: { efecto, id, fecha, completado },
    actividad: {
      efecto,
      objetivo: { tipo: "recordatorio", id, fecha },
      // Si no cambió nada, no hay nada que deshacer.
      deshacer: previo === completado ? undefined : { tipo: "completar", id, fecha, completado: previo },
    },
  };
}

export function borrar(args: Record<string, unknown>): Atendido {
  const { id } = exigir(validarBorrar(args));
  const store = calendario(true);
  const r = exigir(buscarRecordatorio(store.archivo, id));
  const ocurrencias = ocurrenciasDe(store.archivo, id);
  const efecto = efectoBorrar(r, new Date());
  store.eliminar(id);
  return {
    resultado: { efecto, id },
    actividad: { efecto, deshacer: { tipo: "restaurar", recordatorio: r, ocurrencias } },
  };
}

/** A dónde lleva «Ir» en el registro: la próxima ocurrencia, o su fecha si ya pasó. */
function objetivoDe(r: Recordatorio, ahora: Date): Objetivo {
  const { proxima } = proximaOcurrencia(r, ahora);
  return { tipo: "recordatorio", id: r.id, fecha: proxima ?? r.fecha };
}

// ── Deshacer, desde el registro ─────────────────────────────────────────────

/**
 * Deshace una operación del calendario. Devuelve el texto de lo que pasó, o
 * lanza `FalloCalendario` si ya no se puede (lo creado ya no existe, lo
 * borrado ya volvió).
 */
export function deshacer(d: DeshacerCalendario): string {
  const store = calendario(true);
  const posible = puedeDeshacer(store.archivo, d);
  if (!posible.ok) throw new FalloCalendario("NO_ENCONTRADO", `No se puede deshacer: ${posible.porque}.`);
  switch (d.tipo) {
    case "borrar": {
      const r = exigir(buscarRecordatorio(store.archivo, d.id));
      store.eliminar(d.id);
      return `Se borró «${r.titulo}».`;
    }
    case "restaurar":
      store.restaurar(d.recordatorio, d.ocurrencias);
      return `Volvió «${d.recordatorio.titulo}» al calendario.`;
    case "reponer":
      store.guardar(d.recordatorio);
      return `«${d.recordatorio.titulo}» quedó como estaba.`;
    case "completar": {
      const r = exigir(buscarRecordatorio(store.archivo, d.id));
      store.fijarCompletada(claveOcurrencia(d.id, d.fecha), d.completado);
      return `«${r.titulo}» del ${d.fecha} quedó ${d.completado ? "completado" : "pendiente"} otra vez.`;
    }
  }
}

/**
 * El «Deshacer» de una entrada del registro de actividad: deshace y deja
 * constancia (una entrada `deshacer` que apunta a la original; el registro es
 * *append-only*). Devuelve el texto para el aviso.
 */
export function deshacerEntrada(e: Entrada): { ok: boolean; texto: string } {
  if (!e.deshacer) return { ok: false, texto: "Esto no se puede deshacer." };
  try {
    const texto = deshacer(e.deshacer);
    useActividadIaStore.getState().registrar({ op: "deshacer", ref: e.id, resultado: "hecho", efecto: texto });
    return { ok: true, texto };
  } catch (err) {
    return { ok: false, texto: err instanceof Error ? err.message : String(err) };
  }
}
