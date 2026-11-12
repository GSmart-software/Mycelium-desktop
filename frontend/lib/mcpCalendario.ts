/**
 * Las herramientas del calendario del MCP de control (`FUN-L-09`, Parte 2),
 * atendidas sobre `recordatoriosStore`: **lo mismo que hace la UI** al crear,
 * editar, completar o borrar desde el formulario —fijar `vigenteDesde`,
 * guardar en `.mycelium/recordatorios.json` (o en los personales, con
 * `alcance: "personal"`, `FUN-M-60`), recalcular los avisos—, así que lo que
 * crea el agente se ve y avisa igual que lo que crea el usuario.
 *
 * `alcance`: al crear, dónde va (el vault por defecto); al leer, cuál traer
 * (los dos por defecto); al editar, a dónde pasarlo (sin él, queda donde
 * está); al completar o borrar, dónde se espera que esté (sin él, se busca en
 * los dos: los ids no se repiten).
 *
 * La validación, los textos y el deshacer son puros y están en
 * `lib/mcpCalendarioLogica.ts`. Lo llama `lib/mcpControl.ts`.
 */
import {
  alcanceLegible,
  buscarRecordatorio,
  comprobarAlcance,
  comprobarOcurrencia,
  efectoBorrar,
  efectoCompletar,
  efectoCrear,
  efectoEditar,
  nombreDeColor,
  ocurrenciasParaIa,
  proximaOcurrencia,
  puedeDeshacer,
  separarAlcance,
  validarBorrar,
  validarCompletar,
  validarCrear,
  validarEditar,
  validarRango,
  type DeshacerCalendario,
  type Validado,
} from "@/lib/mcpCalendarioLogica";
import type { Atendido, Objetivo } from "@/lib/actividadIa";
import {
  claveOcurrencia,
  estaCompletada,
  filtrarPorAlcance,
  ocurrenciasDe,
  type Alcance,
  type Recordatorio,
} from "@/lib/recordatorios";
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

export type { Atendido };

function exigir<T>(v: Validado<T>): T {
  if (!v.ok) throw new FalloCalendario(v.error.codigo, v.error.mensaje, v.error.datos);
  return v.valor;
}

/**
 * El calendario de ESTE vault, cargado (con los personales). Se carga al abrir
 * el vault y sin esperar; un pedido en ese instante recibe `OCUPADA` en vez de
 * un calendario vacío que no es el real. `escribe`: en qué alcance se va a
 * escribir, para negarse si ese archivo está dañado.
 */
function calendario(escribe: Alcance | null) {
  const s = useRecordatoriosStore.getState();
  const vault = useVaultSessionStore.getState().rutaActual;
  if (s.ruta === null || s.ruta !== vault) {
    throw new FalloCalendario("OCUPADA", "Mycelium todavía está cargando el calendario del vault.", {
      etapa: "cargando el calendario",
      reintentar_en_ms: 1000,
    });
  }
  if (escribe === "vault" && s.bloqueado) {
    throw new FalloCalendario(
      "INVALIDO",
      "El calendario no se puede modificar: .mycelium/recordatorios.json está dañado y Mycelium no lo sobrescribe " +
        "para no perder lo que se pueda recuperar. Díselo al usuario: tiene que arreglarlo o borrarlo.",
      { campo: "recordatorios.json" },
    );
  }
  if (escribe === "personal" && s.personalBloqueado) {
    throw new FalloCalendario(
      "INVALIDO",
      "Los recordatorios personales no se pueden modificar: su archivo (Recordatorios personales.json, en la carpeta " +
        "de datos de Mycelium) está dañado y Mycelium no lo sobrescribe. Díselo al usuario: tiene que arreglarlo o borrarlo.",
      { campo: "Recordatorios personales.json" },
    );
  }
  return s;
}

/** El recordatorio como lo ve el agente. */
function paraIa(r: Recordatorio, alcance: Alcance) {
  return {
    id: r.id,
    titulo: r.titulo,
    fecha: r.fecha,
    hora: r.hora,
    repeticion: r.repeticion,
    color: nombreDeColor(r.color),
    alcance,
  };
}

function proximaParaIa(r: Recordatorio, ahora: Date) {
  const { proxima, avisa } = proximaOcurrencia(r, ahora);
  return { proxima: proxima === null ? null : { fecha: proxima, hora: r.hora }, avisa: avisa !== null };
}

/**
 * Busca un recordatorio en los dos alcances —los ids no se repiten— y, si se
 * pidió uno, comprueba que esté ahí. Devuelve el recordatorio y dónde está.
 */
function encontrar(id: string, pedido: Alcance | null): { r: Recordatorio; alcance: Alcance } {
  const s = useRecordatoriosStore.getState();
  const r = exigir(buscarRecordatorio(s.vista, id));
  const alcance = s.alcanceDe(id) ?? "vault";
  exigir(comprobarAlcance(id, pedido, alcance));
  return { r, alcance };
}

/** Lo que quedó guardado (con `vigenteDesde` y `vaultOrigen` ya fijados). */
const guardado = (id: string) => useRecordatoriosStore.getState().vista.recordatorios.find((x) => x.id === id)!;

// ── Las operaciones ─────────────────────────────────────────────────────────

export function recordatorios(args: Record<string, unknown>): Atendido {
  const { alcance, resto } = exigir(separarAlcance(args, true));
  const { desde, hasta } = exigir(validarRango(resto));
  const { vista, personales } = calendario(null);
  const archivo =
    alcance === null ? vista : { ...vista, recordatorios: filtrarPorAlcance(vista.recordatorios, personales, alcance) };
  return {
    resultado: {
      desde,
      hasta,
      alcance: alcance ?? "todos",
      ocurrencias: ocurrenciasParaIa(archivo, desde, hasta, personales),
    },
  };
}

export function crear(args: Record<string, unknown>): Atendido {
  const { alcance: pedido, resto } = exigir(separarAlcance(args));
  const alcance = pedido ?? "vault";
  const campos = exigir(validarCrear(resto));
  const store = calendario(alcance);
  const id = idRecordatorio();
  store.guardar({ id, ...campos }, alcance);
  // `guardar` fija `vigenteDesde`: se lee de vuelta lo que quedó guardado.
  const r = guardado(id);
  const ahora = new Date();
  const efecto = efectoCrear(r, ahora, alcance);
  return {
    resultado: { efecto, recordatorio: paraIa(r, alcance), ...proximaParaIa(r, ahora) },
    actividad: { efecto, objetivo: objetivoDe(r, ahora), deshacer: { tipo: "borrar", id, despues: r } },
  };
}

/**
 * `validarEditar` exige al menos un campo; con `alcance` solo (pasarlo de un
 * lado al otro sin cambiar nada más) también vale.
 */
function exigirEdicion(resto: Record<string, unknown>, alcance: Alcance | null) {
  const v = validarEditar(resto);
  if (!v.ok && alcance !== null && v.error.mensaje.includes("no hay nada que cambiar")) {
    const id = typeof resto.id === "string" ? resto.id.trim() : "";
    if (id !== "") return { id, cambios: {} };
  }
  return exigir(v);
}

export function editar(args: Record<string, unknown>): Atendido {
  const { alcance: pedido, resto } = exigir(separarAlcance(args));
  // En editar, `alcance` no busca: lo pasa de un lado al otro, como el formulario.
  const { id, cambios } = exigirEdicion(resto, pedido);
  calendario(null);
  const { r: antes, alcance: alcanceAntes } = encontrar(id, null);
  const alcance = pedido ?? alcanceAntes;
  // Si se mueve, se escribe en los dos archivos: ninguno puede estar dañado.
  const store = calendario(alcance);
  if (alcance !== alcanceAntes) calendario(alcanceAntes);
  store.guardar({ ...antes, ...cambios }, alcance);
  const despues = guardado(id);
  const ahora = new Date();
  const efecto = efectoEditar(antes, despues, ahora, { antes: alcanceAntes, despues: alcance });
  return {
    resultado: { efecto, recordatorio: paraIa(despues, alcance), ...proximaParaIa(despues, ahora) },
    actividad: {
      efecto,
      objetivo: objetivoDe(despues, ahora),
      deshacer: { tipo: "reponer", recordatorio: antes, despues, alcance: alcanceAntes },
    },
  };
}

export function completar(args: Record<string, unknown>): Atendido {
  const { alcance: pedido, resto } = exigir(separarAlcance(args));
  const { id, fecha, completado } = exigir(validarCompletar(resto));
  calendario(null);
  const { r, alcance } = encontrar(id, pedido);
  const store = calendario(alcance);
  exigir(comprobarOcurrencia(r, fecha));
  const clave = claveOcurrencia(id, fecha);
  const previo = estaCompletada(store.vista, clave);
  store.fijarCompletada(clave, completado);
  const efecto = efectoCompletar(r, fecha, completado, previo, new Date());
  return {
    resultado: { efecto, id, fecha, completado, alcance },
    actividad: {
      efecto,
      objetivo: { tipo: "recordatorio", id, fecha },
      // Si no cambió nada, no hay nada que deshacer.
      deshacer: previo === completado ? undefined : { tipo: "completar", id, fecha, completado: previo },
    },
  };
}

export function borrar(args: Record<string, unknown>): Atendido {
  const { alcance: pedido, resto } = exigir(separarAlcance(args));
  const { id } = exigir(validarBorrar(resto));
  calendario(null);
  const { r, alcance } = encontrar(id, pedido);
  const store = calendario(alcance);
  const ocurrencias = ocurrenciasDe(store.vista, id);
  const base = efectoBorrar(r, new Date());
  const efecto = alcance === "personal" ? `${base} Era personal: ya no está en ningún vault.` : base;
  store.eliminar(id);
  return {
    resultado: { efecto, id, alcance },
    actividad: { efecto, deshacer: { tipo: "restaurar", recordatorio: r, ocurrencias, alcance } },
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
  // Los dos alcances juntos: los ids no se repiten. Cada caso escribe donde
  // está (o estaba) el recordatorio; sin `alcance` guardado, en el vault.
  const store = calendario(null);
  const posible = puedeDeshacer(store.vista, d);
  if (!posible.ok) throw new FalloCalendario("NO_ENCONTRADO", `No se puede deshacer: ${posible.porque}.`);
  switch (d.tipo) {
    case "borrar": {
      const r = exigir(buscarRecordatorio(store.vista, d.id));
      calendario(store.alcanceDe(d.id) ?? "vault");
      store.eliminar(d.id);
      return `Se borró «${r.titulo}».`;
    }
    case "restaurar": {
      const alcance = d.alcance ?? "vault";
      calendario(alcance);
      store.restaurar(d.recordatorio, d.ocurrencias, alcance);
      const donde = alcance === "personal" ? `, ${alcanceLegible("personal")}` : "";
      return `Volvió «${d.recordatorio.titulo}» al calendario${donde}.`;
    }
    case "reponer":
      calendario(d.alcance ?? "vault");
      store.guardar(d.recordatorio, d.alcance ?? "vault");
      return `«${d.recordatorio.titulo}» quedó como estaba.`;
    case "completar": {
      const r = exigir(buscarRecordatorio(store.vista, d.id));
      calendario(store.alcanceDe(d.id) ?? "vault");
      store.fijarCompletada(claveOcurrencia(d.id, d.fecha), d.completado);
      return `«${r.titulo}» del ${d.fecha} quedó ${d.completado ? "completado" : "pendiente"} otra vez.`;
    }
  }
}
