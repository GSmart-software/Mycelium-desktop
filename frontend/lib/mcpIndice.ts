/**
 * Las consultas al índice del MCP de control (`FUN-M-45`): `mycelium_buscar`,
 * `mycelium_enlaces` y `mycelium_base`. Solo desktop, y de **solo lectura**.
 *
 * Corren en la ventana del vault porque es ahí donde vive el índice (el
 * SQLite de `lib/db/*`): el servidor MCP no indexa nada (spec `mcp-control`
 * § «Sin búsqueda»), solo pregunta. Cada consulta usa lo que ya usa la app:
 * la búsqueda del panel, las filas de enlaces del indexador y el motor de las
 * bases. La lógica pura —validar, armar, recortar— está en
 * `lib/mcpIndiceLogica.ts`.
 *
 * No se registran en la actividad de la IA cuando salen bien (no cambian
 * nada, como leer el calendario); sus fallos sí (`seRegistra`).
 */
import type { Atendido } from "@/lib/actividadIa";
import { parsearBase, ErrorBase } from "@/lib/bases";
import { buscar as buscarEnIndice } from "@/lib/db/buscar";
import { getContenido } from "@/lib/db/contenido";
import { contenidosDe, filasDelIndice, filasHacia } from "@/lib/db/indiceIa";
import { notasParaTabla } from "@/lib/db/tabla";
import { lineasPorEnlace } from "@/lib/enlacesNota";
import { resolverObjetivo } from "@/lib/mcpControlLogica";
import {
  elegirVista,
  enlacesParaIa,
  indexarOtros,
  paginaDeBusqueda,
  tablaParaIa,
  validarBase,
  validarBuscar,
  validarEnlaces,
  type Validado,
} from "@/lib/mcpIndiceLogica";
import { useVaultStore, type TreeNota } from "@/stores/vaultStore";

/** Un error del contrato, para que `mcpControl.ts` lo convierta en respuesta. */
export class FalloIndice extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly datos: unknown = null,
  ) {
    super(mensaje);
  }
}

function exigir<T>(v: Validado<T>): T {
  if (!v.ok) throw new FalloIndice(v.error.codigo, v.error.mensaje, v.error.datos);
  return v.valor;
}

function vaultId(): string {
  const id = useVaultStore.getState().vaultId;
  if (id === null) throw new FalloIndice("OCUPADA", "La ventana de Mycelium todavía está cargando el vault.", { reintentar_en_ms: 1000 });
  return id;
}

/**
 * Una nota del índice por ruta o título, con las reglas de `mycelium_abrir`
 * (`AMBIGUO` con las rutas, `NO_ENCONTRADO` con las parecidas). El grafo, el
 * calendario y los archivos que no son notas no tienen enlaces en el índice.
 */
export function notaDelIndice(objetivo: string): TreeNota {
  const { notas, carpetas, otros } = useVaultStore.getState();
  const r = resolverObjetivo(objetivo, notas, carpetas, otros);
  switch (r.tipo) {
    case "nota":
      return r.nota;
    case "ambiguo":
      throw new FalloIndice("AMBIGUO", `Hay ${r.rutas.length} notas que responden a «${objetivo}».`, { rutas: r.rutas });
    case "no-encontrado":
      throw new FalloIndice("NO_ENCONTRADO", `No hay ninguna nota «${objetivo}» en el índice del vault.`, { candidatas: r.candidatas });
    case "archivo":
      throw new FalloIndice(
        "INVALIDO",
        `«${r.ruta}» es un archivo que no es nota: Mycelium no lo indexa, así que no tiene enlaces ni aparece en la búsqueda.`,
      );
    default:
      throw new FalloIndice("INVALIDO", `«${objetivo}» no es una nota: es una vista de la app.`);
  }
}

// ── mycelium_buscar ─────────────────────────────────────────────────────────

export async function buscar(args: Record<string, unknown>): Promise<Atendido> {
  const pedido = exigir(validarBuscar(args));
  const { resultados } = await buscarEnIndice(vaultId(), pedido.consulta, pedido.exacto, pedido.campo, {
    limite: pedido.limite + 1,
    desde: pedido.desde,
  });
  const tipos = new Map(useVaultStore.getState().notas.map((n) => [n.id, n.tipo]));
  return { resultado: paginaDeBusqueda(pedido, resultados, (id) => tipos.get(id)), sinRegistro: true };
}

// ── mycelium_enlaces ────────────────────────────────────────────────────────

export async function enlaces(args: Record<string, unknown>): Promise<Atendido> {
  const { nota: objetivo } = exigir(validarEnlaces(args));
  const nota = notaDelIndice(objetivo);
  const [salientes, entrantes] = await Promise.all([filasDelIndice(nota.id), filasHacia(nota.id)]);
  const { notas, otros } = useVaultStore.getState();
  const porId = new Map(notas.map((n) => [n.id, n]));
  // Las líneas salen del texto: el de la nota y el de quienes la citan.
  const contenidos = await contenidosDe([nota.id, ...entrantes.map((f) => f.desde)]);
  const cache = new Map<string, Map<string, number[]>>();
  const lineas = (id: string) => {
    if (!cache.has(id)) {
      const c = contenidos.get(id);
      cache.set(id, c === undefined ? new Map() : lineasPorEnlace(c, porId.get(id)?.tipo ?? "markdown"));
    }
    return cache.get(id);
  };
  const resultado = enlacesParaIa(nota, salientes, entrantes, porId, indexarOtros(otros.map((o) => o.ruta)), lineas);
  return { resultado, sinRegistro: true };
}

// ── mycelium_base ───────────────────────────────────────────────────────────

/** La `.base` que nombra `ruta`: por ruta o por título, con o sin la extensión. */
function baseDe(ruta: string): TreeNota {
  const { notas } = useVaultStore.getState();
  const intentos = /\.base$/i.test(ruta) ? [ruta] : [`${ruta}.base`, ruta];
  let primerFallo: unknown = null;
  for (const intento of intentos) {
    try {
      const n = notaDelIndice(intento);
      if (n.tipo === "base") return n;
      primerFallo ??= new FalloIndice("INVALIDO", `«${n.id}» no es una base (.base): es ${n.tipo}.`);
    } catch (e) {
      // `AMBIGUO` entre bases es la respuesta; lo demás se intenta de otra forma.
      if (e instanceof FalloIndice && e.codigo === "AMBIGUO") throw e;
      primerFallo ??= e;
    }
  }
  const bases = notas.filter((n) => n.tipo === "base").map((n) => ({ titulo: n.titulo, ruta: n.id }));
  if (primerFallo instanceof FalloIndice && primerFallo.codigo === "INVALIDO") throw primerFallo;
  throw new FalloIndice("NO_ENCONTRADO", `No hay ninguna base «${ruta}» en el vault.`, { candidatas: bases.slice(0, 10) });
}

export async function base(args: Record<string, unknown>): Promise<Atendido> {
  const pedido = exigir(validarBase(args));
  const nota = baseDe(pedido.ruta);
  const [{ contenido }, { notas }] = await Promise.all([getContenido(nota.id), notasParaTabla(vaultId())]);
  let definicion;
  try {
    definicion = parsearBase(contenido ?? "");
  } catch (e) {
    const motivo = e instanceof ErrorBase || e instanceof Error ? e.message : String(e);
    throw new FalloIndice("INVALIDO", `«${nota.id}» no se puede leer como base: ${motivo}`);
  }
  const elegida = exigir(elegirVista(definicion, pedido.vista));
  const tabla = exigir(tablaParaIa(definicion, elegida, notas));
  return { resultado: { base: { ruta: nota.id, titulo: nota.titulo }, ...tabla }, sinRegistro: true };
}
