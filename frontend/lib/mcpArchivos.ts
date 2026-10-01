/**
 * Las herramientas de archivos del MCP de control (`FUN-L-09`, Parte 3):
 * renombrar y mover **reparando los enlaces entrantes**, mandar a la papelera
 * de Mycelium y restaurar de ella.
 *
 * Usan **lo mismo que la UI**: `vaultStore.renameNota` / `renameCarpeta` /
 * `moveNota` / `moveCarpeta` (que reparan los enlaces con
 * `lib/repararEnlaces.ts`), `deleteNota` / `deleteCarpeta` / `restoreNota`
 * (la papelera de `lib/db/papelera.ts`). Así una nota renombrada por la IA
 * queda exactamente igual que una renombrada desde el explorador.
 *
 * Lo que agregan es lo que la IA necesita y el usuario no: resolver el
 * objetivo por ruta o título, negarse si toca una pestaña con cambios sin
 * guardar, medir **el alcance** antes de hacerlo (cuántas notas reescribiría)
 * y, si es grande, pedirle permiso al usuario (`mcpControl.ts` lo pregunta y
 * espera). La lógica pura —validar, decidir, redactar— está en
 * `lib/mcpArchivosLogica.ts`.
 */
import type { Atendido, Objetivo } from "@/lib/actividadIa";
import {
  aRestaurar,
  carpetasQueFaltan,
  dondeQueda,
  efectoEnlaces,
  enumerar,
  mensajeRechazo,
  nombreSinExtension,
  pidePermiso,
  preguntaConfirmacion,
  puedeDeshacerArchivos,
  resolverAfectado,
  resolverDestino,
  rutaOcupada,
  tituloVisible,
  TOPE_LISTA,
  validarBorrar,
  validarMover,
  validarPapelera,
  validarRenombrar,
  type DeshacerArchivos,
  type ErrorArchivos,
  type Validado,
} from "@/lib/mcpArchivosLogica";
import {
  cambioRenombrar,
  carpetaDeRuta,
  entrantesDe,
  extensionDeRuta,
  movidosPorCarpeta,
  repararEntrantes,
  tituloDeRuta,
  type Movido,
  type Reparacion,
} from "@/lib/repararEnlaces";
import { motivoNombreInvalido } from "@/lib/tituloEditable";
import { useAuthStore } from "@/stores/authStore";
import { avisar } from "@/stores/avisosStore";
import { useSyncStore } from "@/stores/syncStore";
import { allLeaves, useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Un error del contrato, para que `mcpControl.ts` lo convierta en respuesta. */
export class FalloArchivos extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly datos: unknown = null,
  ) {
    super(mensaje);
  }
}

/**
 * Una operación que necesita el permiso del usuario antes de hacerse:
 * `mcpControl.ts` le muestra `mensaje`, y si acepta corre `ejecutar`.
 * `pedido` es cómo se nombra lo pedido en un `RECHAZADO`.
 */
export type Confirmable = {
  confirmar: { mensaje: string; boton: string; pedido: string; ejecutar: () => Promise<Atendido> };
};

export type Atendible = Atendido | Confirmable;

function exigir<T>(v: Validado<T>): T {
  if (!v.ok) throw new FalloArchivos(v.error.codigo, v.error.mensaje, v.error.datos);
  return v.valor;
}

const fallo = (e: ErrorArchivos["codigo"], mensaje: string, datos: unknown = null) => new FalloArchivos(e, mensaje, datos);

const token = () => useAuthStore.getState().accessToken;

/** `a/b` + `c` → `a/b/c`; en la raíz, `c`. */
const unir = (carpeta: string | null, nombre: string) => (carpeta ? `${carpeta}/${nombre}` : nombre);

/** Todo lo que ocupa una ruta en el vault: notas, carpetas y archivos no indexados. */
function ocupadas(): string[] {
  const { notas, carpetas, otros } = useVaultStore.getState();
  return [...notas.map((n) => n.id), ...carpetas.map((c) => c.id), ...otros.map((o) => o.ruta)];
}

/** Los ids de las notas de una carpeta (todo su subárbol). */
function notasDeCarpeta(carpeta: string): string[] {
  return useVaultStore
    .getState()
    .notas.filter((n) => n.id.startsWith(`${carpeta}/`))
    .map((n) => n.id);
}

/** Estados del editor que significan «hay algo que no está en disco» (los de `mcpControl.ts`). */
const SIN_GUARDAR = new Set(["local", "syncing", "error"]);

/**
 * `CAMBIOS_SIN_GUARDAR` si alguna de `ids` tiene un borrador en su pestaña: lo
 * que la operación escribiera lo pisaría el guardado siguiente, o al revés.
 */
function exigirGuardado(ids: readonly string[]): void {
  const sync = useSyncStore.getState().byNota;
  const sucias = ids.filter((id) => SIN_GUARDAR.has(sync[id] ?? ""));
  if (sucias.length === 0) return;
  throw fallo(
    "CAMBIOS_SIN_GUARDAR",
    `${sucias.length === 1 ? `«${tituloVisible(sucias[0])}» tiene` : `${sucias.length} notas tienen`} cambios sin guardar en su ` +
      `pestaña (${enumerar(sucias)}), y esta operación la${sucias.length === 1 ? "" : "s"} tocaría. Mycelium guarda solo en ` +
      "unos segundos: esperá y repetí, o pedile al usuario que la guarde.",
    { pestanas: sucias.map((ruta) => ({ titulo: tituloVisible(ruta), ruta })) },
  );
}

/** Las pestañas abiertas de `ids`, por título (para decir cuáles se cerraron). */
function pestanasDe(ids: ReadonlySet<string>): string[] {
  const titulos: string[] = [];
  for (const hoja of allLeaves(useTabsStore.getState().root)) {
    for (const t of hoja.tabs) if (ids.has(t.notaId)) titulos.push(tituloVisible(t.notaId));
  }
  return [...new Set(titulos)];
}

/** Un error del repo (nombre ocupado, permiso del disco…) como `INVALIDO` con su mensaje. */
function comoFallo(e: unknown): FalloArchivos {
  if (e instanceof FalloArchivos) return e;
  return fallo("INVALIDO", e instanceof Error && e.message ? e.message : String(e));
}

/** Lo que va en la respuesta sobre los enlaces: el total, hasta 10 notas y las que fallaron. */
function enlacesParaIa(r: Reparacion) {
  return { reescritas: { total: r.reescritas.length, notas: r.reescritas.slice(0, TOPE_LISTA) }, sin_reparar: r.fallidas };
}

// ── Plan: qué cambia, antes de cambiarlo ────────────────────────────────────

type Plan = {
  clase: "nota" | "carpeta";
  id: string;
  idNuevo: string;
  /** Las notas que cambian de ruta (la nota, o las de la carpeta). */
  afectadas: string[];
  movidos: Movido[];
};

/**
 * El alcance: qué notas habría que reescribir para reparar los enlaces. Se
 * simula (se lee, no se escribe) con el mismo código que después repara.
 */
async function alcance(plan: Plan): Promise<string[]> {
  const vaultId = useVaultStore.getState().vaultId;
  if (vaultId === null) return [];
  const entrantes = await entrantesDe(plan.afectadas, vaultId, token());
  return (await repararEntrantes(entrantes, plan.movidos, token(), true)).reescritas;
}

/**
 * Lo común a renombrar y mover: el borrador, el alcance y, si es grande, el
 * permiso. `hacer` es la operación de verdad.
 */
async function conAlcance(
  op: "renombrar" | "mover",
  plan: Plan,
  confirmado: boolean,
  pregunta: (reescribe: string[]) => { mensaje: string; boton: string; pedido: string },
  reintentar: () => Promise<Atendible>,
  hacer: () => Promise<Atendido>,
): Promise<Atendible> {
  exigirGuardado(plan.afectadas);
  const reescribe = await alcance(plan);
  exigirGuardado(reescribe);
  if (!confirmado && pidePermiso(op, plan.clase, reescribe.length)) {
    return {
      confirmar: {
        ...pregunta(reescribe),
        ejecutar: async () => {
          const r = await reintentar();
          if ("confirmar" in r) throw fallo("INVALIDO", "La operación volvió a pedir permiso después de tenerlo.");
          return r;
        },
      },
    };
  }
  return hacer();
}

// ── renombrar ───────────────────────────────────────────────────────────────

export async function renombrar(args: Record<string, unknown>, confirmado = false): Promise<Atendible> {
  const { objetivo, nombre } = exigir(validarRenombrar(args));
  const { notas, carpetas, otros } = useVaultStore.getState();
  const a = exigir(resolverAfectado(objetivo, notas, carpetas, otros));

  let plan: Plan;
  let nombreNuevo: string;
  let nombreAntes: string;
  if (a.clase === "nota") {
    const id = a.nota.id;
    const ext = extensionDeRuta(id);
    nombreNuevo = nombreSinExtension(nombre, ext);
    const motivo = motivoNombreInvalido(nombreNuevo);
    if (motivo !== null) throw fallo("INVALIDO", `\`nombre\`: ${motivo}`, { campo: "nombre" });
    nombreAntes = a.nota.titulo;
    const idNuevo = unir(a.nota.carpetaId, nombreNuevo + ext);
    if (nombreNuevo === nombreAntes) throw fallo("INVALIDO", `«${nombreAntes}» ya se llama así: no hay nada que renombrar.`, { campo: "nombre" });
    if (rutaOcupada(idNuevo, ocupadas(), id)) {
      throw fallo("INVALIDO", `Ya existe «${idNuevo}»: elegí otro nombre (renombrar no pisa ni numera).`, { campo: "nombre" });
    }
    plan = {
      clase: "nota",
      id,
      idNuevo,
      afectadas: [id],
      movidos: [{ id, idNuevo, cambio: { ...cambioRenombrar(id, nombreNuevo), tituloViejo: nombreAntes } }],
    };
  } else {
    const id = a.carpeta.id;
    nombreNuevo = nombre;
    nombreAntes = a.carpeta.nombre;
    const idNuevo = unir(carpetaDeRuta(id) || null, nombreNuevo);
    if (nombreNuevo === nombreAntes) throw fallo("INVALIDO", `La carpeta ya se llama «${nombreAntes}».`, { campo: "nombre" });
    if (rutaOcupada(idNuevo, ocupadas(), id)) {
      throw fallo("INVALIDO", `Ya existe «${idNuevo}»: elegí otro nombre.`, { campo: "nombre" });
    }
    plan = { clase: "carpeta", id, idNuevo, afectadas: notasDeCarpeta(id), movidos: movidosPorCarpeta(notas, id, idNuevo) };
  }

  const que = plan.clase === "nota" ? `«${nombreAntes}»` : `la carpeta «${plan.id}»`;
  return conAlcance(
    "renombrar",
    plan,
    confirmado,
    (reescribe) => ({
      ...preguntaConfirmacion("renombrar", plan.clase, { ruta: plan.id, nombreNuevo, reescribe }),
      pedido: `renombrar ${que} a «${nombreNuevo}»`,
    }),
    () => renombrar(args, true),
    async () => {
      const vs = useVaultStore.getState();
      let r: Reparacion & { id: string };
      try {
        r = plan.clase === "nota" ? await vs.renameNota(plan.id, nombreNuevo) : await vs.renameCarpeta(plan.id, nombreNuevo);
      } catch (e) {
        throw comoFallo(e);
      }
      const extra = plan.clase === "carpeta" && plan.afectadas.length > 0 ? ` Sus ${plan.afectadas.length} notas cambiaron de ruta.` : "";
      const efecto = `Renombré ${que} a «${nombreNuevo}» (${r.id}).${extra} ${efectoEnlaces(r.reescritas, r.fallidas)}`;
      const deshacer: DeshacerArchivos = { tipo: "archivo_renombrar", clase: plan.clase, ruta: r.id, rutaAntes: plan.id, nombre: nombreAntes };
      return {
        resultado: { efecto, clase: plan.clase, ruta_anterior: plan.id, ruta: r.id, ...enlacesParaIa(r) },
        actividad: { efecto, objetivo: objetivoDe(plan.clase, r.id), deshacer },
      };
    },
  );
}

function objetivoDe(clase: "nota" | "carpeta", ruta: string): Objetivo {
  return clase === "nota" ? { tipo: "nota", ruta } : { tipo: "carpeta", ruta };
}

// ── mover ───────────────────────────────────────────────────────────────────

export async function mover(args: Record<string, unknown>, confirmado = false): Promise<Atendible> {
  const { objetivo, carpeta } = exigir(validarMover(args));
  const { notas, carpetas, otros } = useVaultStore.getState();
  const a = exigir(resolverAfectado(objetivo, notas, carpetas, otros));
  const destino = exigir(resolverDestino(carpeta, carpetas));
  const destinoId = destino?.id ?? null;

  const id = a.clase === "nota" ? a.nota.id : a.carpeta.id;
  const nombre = id.slice(id.lastIndexOf("/") + 1);
  const padre = carpetaDeRuta(id) || null;
  if (a.clase === "carpeta" && destinoId !== null && (destinoId === id || destinoId.startsWith(`${id}/`))) {
    throw fallo("INVALIDO", "No se puede mover una carpeta dentro de sí misma ni de sus subcarpetas.", { campo: "carpeta" });
  }
  if ((padre ?? "").toLowerCase() === (destinoId ?? "").toLowerCase()) {
    throw fallo("INVALIDO", `«${id}» ya está ${dondeQueda(destinoId)}: no hay nada que mover.`, { campo: "carpeta" });
  }
  const idNuevo = unir(destinoId, nombre);
  if (rutaOcupada(idNuevo, ocupadas(), id)) {
    throw fallo("INVALIDO", `Ya existe «${idNuevo}» en el destino: mover no pisa ni numera.`, { campo: "carpeta" });
  }
  const plan: Plan =
    a.clase === "nota"
      ? {
          clase: "nota",
          id,
          idNuevo,
          afectadas: [id],
          movidos: [
            {
              id,
              idNuevo,
              cambio: {
                tituloViejo: tituloDeRuta(id),
                tituloNuevo: tituloDeRuta(id),
                carpetaVieja: padre ?? "",
                carpetaNueva: destinoId ?? "",
                extension: extensionDeRuta(id),
              },
            },
          ],
        }
      : { clase: "carpeta", id, idNuevo, afectadas: notasDeCarpeta(id), movidos: movidosPorCarpeta(notas, id, idNuevo) };

  const que = plan.clase === "nota" ? `«${tituloVisible(id)}»` : `la carpeta «${id}»`;
  return conAlcance(
    "mover",
    plan,
    confirmado,
    (reescribe) => ({
      ...preguntaConfirmacion("mover", plan.clase, { ruta: id, carpetaNueva: destinoId, reescribe }),
      pedido: `mover ${que} ${dondeQueda(destinoId)}`,
    }),
    () => mover(args, true),
    async () => {
      const vs = useVaultStore.getState();
      const r = plan.clase === "nota" ? await vs.moveNota(id, destinoId) : await vs.moveCarpeta(id, destinoId);
      if (!r.ok) throw fallo("INVALIDO", r.error);
      const extra = plan.clase === "carpeta" && plan.afectadas.length > 0 ? ` Sus ${plan.afectadas.length} notas cambiaron de ruta.` : "";
      const efecto = `Moví ${que} ${dondeQueda(destinoId)} (${r.id}).${extra} ${efectoEnlaces(r.reescritas, r.fallidas)}`;
      const deshacer: DeshacerArchivos = { tipo: "archivo_mover", clase: plan.clase, ruta: r.id, rutaAntes: id, carpeta: padre };
      return {
        resultado: { efecto, clase: plan.clase, ruta_anterior: id, ruta: r.id, ...enlacesParaIa(r) },
        actividad: { efecto, objetivo: objetivoDe(plan.clase, r.id), deshacer },
      };
    },
  );
}

// ── borrar ──────────────────────────────────────────────────────────────────

/** Cierra las pestañas de `ids` (y las saca del historial, como el explorador). */
function cerrarPestanas(ids: readonly string[]): string[] {
  const cerradas = pestanasDe(new Set(ids));
  const tabs = useTabsStore.getState();
  for (const id of ids) tabs.closeNotaEverywhere(id);
  return cerradas;
}

export async function borrar(args: Record<string, unknown>, confirmado = false): Promise<Atendible> {
  const { objetivo } = exigir(validarBorrar(args));
  const { notas, carpetas, otros } = useVaultStore.getState();
  const a = exigir(resolverAfectado(objetivo, notas, carpetas, otros));

  if (a.clase === "nota") {
    const id = a.nota.id;
    exigirGuardado([id]);
    const cerradas = cerrarPestanas([id]);
    try {
      await useVaultStore.getState().deleteNota(id);
    } catch (e) {
      throw comoFallo(e);
    }
    await useVaultStore.getState().loadPapelera().catch(() => {});
    // El mismo aviso que el explorador: el usuario ve qué pasó y lo puede deshacer ahí.
    avisar(`Claude Code mandó «${a.nota.titulo}» a la papelera`, {
      etiqueta: "Deshacer",
      hacer: () => void restaurarNotas([id]).catch((e) => avisar(`No se pudo restaurar: ${comoFallo(e).message}`)),
    });
    const efecto =
      `Mandé «${a.nota.titulo}» a la papelera de Mycelium; se restaura con mycelium_papelera ` +
      `(accion «restaurar», id «${id}») o con Deshacer.` +
      (cerradas.length > 0 ? ` Cerré su pestaña.` : "");
    return {
      resultado: { efecto, clase: "nota", entrada: id, pestanas_cerradas: cerradas },
      actividad: { efecto, objetivo: { tipo: "papelera" }, deshacer: { tipo: "archivo_restaurar", clase: "nota", ruta: id, notas: [id] } },
    };
  }

  const id = a.carpeta.id;
  const contenidas = notasDeCarpeta(id);
  exigirGuardado(contenidas);
  if (!confirmado && pidePermiso("borrar", "carpeta", 0)) {
    return {
      confirmar: {
        ...preguntaConfirmacion("borrar", "carpeta", { ruta: id, reescribe: [], notasCarpeta: contenidas.length }),
        pedido: `eliminar la carpeta «${id}»`,
        ejecutar: async () => {
          const r = await borrar(args, true);
          if ("confirmar" in r) throw fallo("INVALIDO", "La operación volvió a pedir permiso después de tenerlo.");
          return r;
        },
      },
    };
  }
  const cerradas = cerrarPestanas(contenidas);
  try {
    await useVaultStore.getState().deleteCarpeta(id);
  } catch (e) {
    throw comoFallo(e);
  }
  await useVaultStore.getState().loadPapelera().catch(() => {});
  const n = contenidas.length;
  const efecto =
    `Eliminé la carpeta «${id}»: ${n === 0 ? "estaba vacía" : `${n} ${n === 1 ? "nota fue" : "notas fueron"} a la papelera de Mycelium`}. ` +
    `Se restaura con mycelium_papelera (accion «restaurar», id «${id}») o con Deshacer.` +
    (cerradas.length > 0 ? ` Cerré ${cerradas.length === 1 ? "1 pestaña" : `${cerradas.length} pestañas`}: ${enumerar(cerradas)}.` : "");
  return {
    resultado: { efecto, clase: "carpeta", entrada: id, notas: contenidas.slice(0, TOPE_LISTA), total: n, pestanas_cerradas: cerradas },
    actividad: { efecto, objetivo: { tipo: "papelera" }, deshacer: { tipo: "archivo_restaurar", clase: "carpeta", ruta: id, notas: contenidas } },
  };
}

// ── papelera ────────────────────────────────────────────────────────────────

/**
 * Restaura de la papelera, **en su lugar**: si la carpeta de una nota ya no
 * existe (se borró la carpeta entera), se recrea primero —sin esto
 * `recuperarNota` la deja en la raíz—. Devuelve las rutas restauradas.
 */
export async function restaurarNotas(ids: readonly string[]): Promise<string[]> {
  const vs = useVaultStore.getState();
  const existentes = new Set(vs.carpetas.map((c) => c.id));
  for (const ruta of carpetasQueFaltan(ids, existentes)) {
    const barra = ruta.lastIndexOf("/");
    await useVaultStore.getState().createCarpeta(ruta.slice(barra + 1), barra < 0 ? null : ruta.slice(0, barra));
  }
  const hechas: string[] = [];
  for (const id of ids) {
    await useVaultStore.getState().restoreNota(id);
    hechas.push(id);
  }
  return hechas;
}

export async function papelera(args: Record<string, unknown>): Promise<Atendible> {
  const pedido = exigir(validarPapelera(args));
  await useVaultStore.getState().loadPapelera();
  const items = useVaultStore.getState().papelera;
  if (pedido.accion === "listar") {
    return {
      resultado: {
        entradas: items.map((i) => ({ id: i.notaId, titulo: i.titulo, carpeta: carpetaDeRuta(i.notaId), eliminada: i.eliminadoEn })),
      },
      sinRegistro: true,
    };
  }
  const { clase, ids } = exigir(aRestaurar(pedido.id, items));
  const libres = ocupadas();
  const tapadas = ids.filter((id) => rutaOcupada(id, libres));
  if (tapadas.length > 0) {
    throw fallo(
      "INVALIDO",
      `No se puede restaurar en su lugar: ya hay otro archivo en ${enumerar(tapadas.map((t) => `«${t}»`))}. ` +
        "Renombrá o mové ese archivo primero.",
      { campo: "id" },
    );
  }
  let hechas: string[];
  try {
    hechas = await restaurarNotas(ids);
  } catch (e) {
    throw comoFallo(e);
  }
  const efecto =
    clase === "nota"
      ? `Restauré «${tituloVisible(hechas[0])}» de la papelera, en ${hechas[0]}.`
      : `Restauré ${hechas.length} ${hechas.length === 1 ? "nota" : "notas"} de la carpeta «${pedido.id.replace(/\/+$/, "")}»: ${enumerar(
          hechas.map(tituloVisible),
        )}.`;
  return {
    resultado: { efecto, rutas: hechas },
    actividad: {
      efecto,
      objetivo: clase === "nota" ? { tipo: "nota", ruta: hechas[0] } : { tipo: "carpeta", ruta: carpetaDeRuta(hechas[0]) },
      ...(clase === "nota" ? { deshacer: { tipo: "archivo_borrar" as const, ruta: hechas[0] } } : {}),
    },
  };
}

// ── Deshacer, desde el registro ─────────────────────────────────────────────

/** Lo que hay hoy, para `puedeDeshacerArchivos`. */
export function estadoParaDeshacer() {
  const { notas, carpetas, papelera: items } = useVaultStore.getState();
  return {
    notas: new Set(notas.map((n) => n.id)),
    carpetas: new Set(carpetas.map((c) => c.id)),
    papelera: new Set(items.map((i) => i.notaId)),
  };
}

/**
 * Deshace una operación de archivos: renombrar o mover de vuelta (reparando los
 * enlaces otra vez), restaurar de la papelera, o mandar a ella lo restaurado.
 * Lanza si ya no se puede —incluido «cambió después»—.
 */
export async function deshacerArchivos(d: DeshacerArchivos): Promise<string> {
  await useVaultStore.getState().loadPapelera().catch(() => {});
  const posible = puedeDeshacerArchivos(estadoParaDeshacer(), d);
  if (!posible.ok) throw fallo("INVALIDO", `No se puede deshacer: ${posible.porque}.`);
  const vs = useVaultStore.getState();
  switch (d.tipo) {
    case "archivo_renombrar": {
      const r = d.clase === "nota" ? await vs.renameNota(d.ruta, d.nombre) : await vs.renameCarpeta(d.ruta, d.nombre);
      return `Volvió a llamarse «${d.nombre}» (${r.id}). ${efectoEnlaces(r.reescritas, r.fallidas)}`;
    }
    case "archivo_mover": {
      const r = d.clase === "nota" ? await vs.moveNota(d.ruta, d.carpeta) : await vs.moveCarpeta(d.ruta, d.carpeta);
      if (!r.ok) throw fallo("INVALIDO", r.error);
      return `Volvió ${dondeQueda(d.carpeta)} (${r.id}). ${efectoEnlaces(r.reescritas, r.fallidas)}`;
    }
    case "archivo_restaurar": {
      const hechas = await restaurarNotas(d.notas);
      return d.clase === "nota" ? `«${tituloVisible(d.ruta)}» volvió de la papelera.` : `La carpeta «${d.ruta}» volvió con ${hechas.length} notas.`;
    }
    case "archivo_borrar": {
      cerrarPestanas([d.ruta]);
      await vs.deleteNota(d.ruta);
      await useVaultStore.getState().loadPapelera().catch(() => {});
      return `«${tituloVisible(d.ruta)}» volvió a la papelera.`;
    }
  }
}

export { mensajeRechazo };
