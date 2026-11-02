/**
 * La lógica **pura** de las consultas al índice del MCP de control
 * (`FUN-M-45`, propuesta 4 de `ia-vaults-intensivos`): `mycelium_buscar`,
 * `mycelium_enlaces` y `mycelium_base`. Validar los argumentos, armar la
 * respuesta a partir de lo que ya calculó la app y recortar con tope. Sin
 * stores ni Tauri, para `scripts/test-mcp-indice.mjs`; el cableado está en
 * `lib/mcpIndice.ts`.
 *
 * > [!important] Nada de esto busca por su cuenta
 * > Buscar es la búsqueda de la app (`lib/db/buscar.ts`); los enlaces son las
 * > filas del índice (`lib/db/indiceIa.ts`), resueltas por el indexador; una
 * > base se evalúa con el motor de `lib/bases.ts`, el de la pestaña y el del
 * > embed (`FUN-S-29`). Lo que el agente ve es lo que ve el usuario.
 */
import { construirTabla, textoPlanoDeCelda, tituloColumna, type Base, type NotaTabla, type Vista } from "@/lib/bases";
import { sinAncla } from "@/lib/enlacesNota";

// ── Errores y validación (como `lib/mcpArchivosLogica.ts`) ───────────────────

export type ErrorIndice = { codigo: string; mensaje: string; datos: unknown };
export type Validado<T> = { ok: true; valor: T } | { ok: false; error: ErrorIndice };

const error = <T>(codigo: string, mensaje: string, datos: unknown = null): Validado<T> => ({
  ok: false,
  error: { codigo, mensaje, datos },
});
const invalido = <T>(campo: string, porque: string): Validado<T> =>
  error("INVALIDO", `\`${campo}\`: ${porque}`, { campo });

/** Un campo desconocido es `INVALIDO`: un typo no pasa en silencio. */
function clavesConocidas(args: Record<string, unknown>, conocidas: string[]): Validado<null> {
  for (const k of Object.keys(args)) {
    if (!conocidas.includes(k)) return invalido(k, `no es un campo de esta herramienta (son: ${conocidas.join(", ")}).`);
  }
  return { ok: true, valor: null };
}

function textoObligatorio(args: Record<string, unknown>, campo: string): Validado<string> {
  const v = args[campo];
  if (typeof v !== "string" || v.trim() === "") return invalido(campo, "es un texto no vacío.");
  return { ok: true, valor: v.trim() };
}

function textoOpcional(args: Record<string, unknown>, campo: string): Validado<string | null> {
  const v = args[campo];
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== "string") return invalido(campo, "es un texto.");
  return { ok: true, valor: v.trim() === "" ? null : v.trim() };
}

function entero(args: Record<string, unknown>, campo: string, min: number, max: number, defecto: number): Validado<number> {
  const v = args[campo];
  if (v === undefined || v === null) return { ok: true, valor: defecto };
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    return invalido(campo, `es un entero entre ${min} y ${max}.`);
  }
  return { ok: true, valor: v };
}

// ── mycelium_buscar ──────────────────────────────────────────────────────────

/** Cuántos resultados devuelve por defecto, y como mucho por página. */
export const LIMITE_BUSCAR = 20;
export const LIMITE_BUSCAR_MAX = 50;
/** Hasta dónde se puede paginar (la búsqueda de la app ordena por título y relevancia). */
export const DESDE_MAX = 1000;

/**
 * Con menos caracteres la consulta no se hace (`FUN-M-58`): el mismo mínimo
 * que el panel de búsqueda (`MINIMO_CARACTERES` en `SearchPanel.tsx`,
 * `FUN-M-38`). Una letra sola coincide con casi todas las notas y FTS5 arma el
 * `snippet()` de todas antes del `LIMIT`: medido en un vault de 1.500 notas,
 * `"e"*` tardaba 4,1 s por página y retenía el canal del MCP (las demás
 * herramientas esperaban hasta responder `OCUPADA`). No se importa del panel:
 * es un componente, y se comparte con web, que no tiene este módulo.
 */
export const MINIMO_CARACTERES_BUSCAR = 2;

export type ArgsBuscar = {
  consulta: string;
  campo: "nombre" | "contenido" | "ambos";
  exacto: boolean;
  limite: number;
  desde: number;
};

export function validarBuscar(args: Record<string, unknown>): Validado<ArgsBuscar> {
  const k = clavesConocidas(args, ["consulta", "campo", "exacto", "limite", "desde"]);
  if (!k.ok) return k;
  const consulta = textoObligatorio(args, "consulta");
  if (!consulta.ok) return consulta;
  if (consulta.valor.length < MINIMO_CARACTERES_BUSCAR) {
    return invalido(
      "consulta",
      `tiene al menos ${MINIMO_CARACTERES_BUSCAR} caracteres: uno solo coincide con casi todas las notas y la búsqueda tardaría segundos.`,
    );
  }
  const campo = args.campo ?? "ambos";
  if (campo !== "nombre" && campo !== "contenido" && campo !== "ambos") {
    return invalido("campo", "es `nombre`, `contenido` o `ambos`.");
  }
  if (args.exacto !== undefined && args.exacto !== null && typeof args.exacto !== "boolean") {
    return invalido("exacto", "es true o false.");
  }
  const limite = entero(args, "limite", 1, LIMITE_BUSCAR_MAX, LIMITE_BUSCAR);
  if (!limite.ok) return limite;
  const desde = entero(args, "desde", 0, DESDE_MAX, 0);
  if (!desde.ok) return desde;
  return {
    ok: true,
    valor: { consulta: consulta.valor, campo, exacto: args.exacto === true, limite: limite.valor, desde: desde.valor },
  };
}

/** Un resultado de la búsqueda, como lo devuelve `lib/db/buscar.ts`. */
export type ResultadoBusqueda = { nota_id: string; titulo: string; fragmento: string };

/**
 * La página de resultados para el agente. `filas` trae uno de más (se pidió
 * `limite + 1`) para saber si hay otra página sin contar todo.
 */
export function paginaDeBusqueda(
  pedido: ArgsBuscar,
  filas: readonly ResultadoBusqueda[],
  tipoDe: (id: string) => string | undefined,
): {
  consulta: string;
  campo: string;
  desde: number;
  resultados: { ruta: string; titulo: string; tipo: string; fragmento: string }[];
  hay_mas: boolean;
  siguiente: number | null;
} {
  const pagina = filas.slice(0, pedido.limite);
  const hayMas = filas.length > pedido.limite;
  return {
    consulta: pedido.consulta,
    campo: pedido.campo,
    desde: pedido.desde,
    resultados: pagina.map((r) => ({
      ruta: r.nota_id,
      titulo: r.titulo,
      tipo: tipoDe(r.nota_id) ?? "markdown",
      // Una línea: el fragmento del FTS ya trae «» alrededor de la coincidencia.
      fragmento: (r.fragmento ?? "").replace(/\s+/g, " ").trim(),
    })),
    hay_mas: hayMas,
    siguiente: hayMas ? pedido.desde + pagina.length : null,
  };
}

// ── Archivos que no son notas ────────────────────────────────────────────────

/** Índice de los archivos que no son notas, por ruta y por nombre en minúsculas. */
export type IndiceOtros = { porRuta: Set<string>; porNombre: Map<string, string[]> };

export function indexarOtros(rutas: readonly string[]): IndiceOtros {
  const porRuta = new Set<string>();
  const porNombre = new Map<string, string[]>();
  for (const r of rutas) {
    porRuta.add(r.toLowerCase());
    const nombre = r.slice(r.lastIndexOf("/") + 1).toLowerCase();
    const lista = porNombre.get(nombre);
    if (lista) lista.push(r);
    else porNombre.set(nombre, [r]);
  }
  return { porRuta, porNombre };
}

/**
 * La ruta del archivo (que no es nota) al que apunta una referencia sin
 * destino en el índice, o `null`. Por nombre con extensión y con la pista de
 * carpeta, como los embeds de imágenes (`resolverEmbedImagen`); una tarjeta de
 * lienzo, por su ruta. `[[doc.pdf#page=3]]` también vale: el ancla no cuenta.
 *
 * El índice no resuelve estos enlaces porque no son notas, pero el archivo está:
 * no es un enlace roto.
 */
export function resolverArchivo(fila: { tipo: string; texto: string }, indice: IndiceOtros): string | null {
  if (fila.tipo === "archivo") {
    return indice.porRuta.has(fila.texto.toLowerCase()) ? fila.texto : null;
  }
  const partes = sinAncla(fila.texto)
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (partes.length === 0) return null;
  const nombre = partes[partes.length - 1].toLowerCase();
  if (!nombre.includes(".")) return null;
  let candidatos = indice.porNombre.get(nombre) ?? [];
  if (partes.length > 1) {
    const pista = partes.slice(0, -1).join("/").toLowerCase();
    candidatos = candidatos.filter((r) => {
      const carpeta = r.slice(0, Math.max(r.lastIndexOf("/"), 0)).toLowerCase();
      return carpeta === pista || carpeta.endsWith(`/${pista}`);
    });
  }
  return candidatos.length === 0 ? null : [...candidatos].sort()[0];
}

// ── mycelium_enlaces ─────────────────────────────────────────────────────────

/** Cuántos salientes y backlinks devuelve como mucho cada lista. */
export const TOPE_ENLACES = 200;

export function validarEnlaces(args: Record<string, unknown>): Validado<{ nota: string }> {
  const k = clavesConocidas(args, ["nota"]);
  if (!k.ok) return k;
  const nota = textoObligatorio(args, "nota");
  return nota.ok ? { ok: true, valor: { nota: nota.valor } } : nota;
}

/** Una fila de `enlaces` (`lib/db/indiceIa.ts`). */
export type FilaParaIa = { desde: string; texto: string; tipo: string; destino: string | null; n: number };
type NotaMin = { id: string; titulo: string; tipo: string };

export type Saliente = {
  texto: string;
  /** `enlace`, `embed`, `canvas` (tarjeta de texto) o `archivo` (tarjeta de nota). */
  tipo: string;
  n: number;
  lineas: number[];
  /** `nota`: resuelve a una nota; `archivo`: a un archivo que no es nota; `propia`: a sí misma; `roto`. */
  estado: "nota" | "archivo" | "propia" | "roto";
  destino: { ruta: string; titulo: string } | null;
};

export type Backlink = { ruta: string; titulo: string; tipo: string; textos: string[]; lineas: number[] };

/**
 * Los enlaces de una nota, para el agente: los salientes —todos, rotos
 * incluidos, en el orden del texto— y los backlinks con el criterio del panel
 * de conexiones (una arista desde otra nota, sin la papelera). `lineas` es
 * `(tipo, texto) → líneas` de cada nota, de `lineasPorEnlace`.
 */
export function enlacesParaIa(
  nota: NotaMin,
  salientes: readonly FilaParaIa[],
  entrantes: readonly FilaParaIa[],
  notas: ReadonlyMap<string, NotaMin>,
  otros: IndiceOtros,
  lineas: (notaId: string) => Map<string, number[]> | undefined,
): {
  nota: { ruta: string; titulo: string; tipo: string };
  salientes: Saliente[];
  total_salientes: number;
  rotos: number;
  backlinks: Backlink[];
  total_backlinks: number;
} {
  const linea = (id: string, tipo: string, texto: string) => lineas(id)?.get(`${tipo}\u0000${texto}`) ?? [];
  const sal: Saliente[] = salientes.map((f) => {
    const destino = f.destino !== null ? notas.get(f.destino) : undefined;
    const archivo = destino === undefined ? resolverArchivo(f, otros) : null;
    const estado: Saliente["estado"] =
      destino !== undefined ? (destino.id === nota.id ? "propia" : "nota") : archivo !== null ? "archivo" : "roto";
    return {
      texto: f.texto,
      tipo: f.tipo,
      n: f.n,
      lineas: linea(nota.id, f.tipo, f.texto),
      estado,
      destino: destino ? { ruta: destino.id, titulo: destino.titulo } : archivo ? { ruta: archivo, titulo: archivo.slice(archivo.lastIndexOf("/") + 1) } : null,
    };
  });

  // Una entrada por nota que cita, en el orden en que aparecen las filas.
  const porCitante = new Map<string, Backlink>();
  for (const f of entrantes) {
    if (f.desde === nota.id) continue;
    const citante = notas.get(f.desde);
    if (!citante) continue;
    let b = porCitante.get(f.desde);
    if (!b) {
      b = { ruta: citante.id, titulo: citante.titulo, tipo: citante.tipo, textos: [], lineas: [] };
      porCitante.set(f.desde, b);
    }
    if (!b.textos.includes(f.texto)) b.textos.push(f.texto);
    for (const l of linea(f.desde, f.tipo, f.texto)) if (!b.lineas.includes(l)) b.lineas.push(l);
  }
  for (const b of porCitante.values()) b.lineas.sort((a, c) => a - c);
  const back = [...porCitante.values()];

  return {
    nota: { ruta: nota.id, titulo: nota.titulo, tipo: nota.tipo },
    salientes: sal.slice(0, TOPE_ENLACES),
    total_salientes: sal.length,
    rotos: sal.filter((s) => s.estado === "roto").length,
    backlinks: back.slice(0, TOPE_ENLACES),
    total_backlinks: back.length,
  };
}

// ── mycelium_base ────────────────────────────────────────────────────────────

/** Cuántas filas devuelve como mucho una vista. */
export const TOPE_FILAS_BASE = 200;

export function validarBase(args: Record<string, unknown>): Validado<{ ruta: string; vista: string | null }> {
  const k = clavesConocidas(args, ["ruta", "vista"]);
  if (!k.ok) return k;
  const ruta = textoObligatorio(args, "ruta");
  if (!ruta.ok) return ruta;
  const vista = textoOpcional(args, "vista");
  if (!vista.ok) return vista;
  return { ok: true, valor: { ruta: ruta.valor, vista: vista.valor } };
}

/**
 * La vista pedida (por nombre, sin distinguir mayúsculas) o la primera. A
 * diferencia del embed, que muestra la primera con un aviso, acá una vista que
 * no existe es `NO_ENCONTRADO` con los nombres: el agente no debería leer otra
 * tabla creyendo que es la que pidió.
 */
export function elegirVista(base: Base, nombre: string | null): Validado<{ vista: Vista; indice: number }> {
  if (base.vistas.length === 0) return error("INVALIDO", "La base no tiene vistas: no hay tabla que evaluar.");
  if (nombre === null) return { ok: true, valor: { vista: base.vistas[0], indice: 0 } };
  const buscado = nombre.trim().toLowerCase();
  const i = base.vistas.findIndex((v) => v.nombre.trim().toLowerCase() === buscado);
  if (i < 0) {
    const nombres = base.vistas.map((v) => v.nombre);
    return error("NO_ENCONTRADO", `La base no tiene una vista «${nombre}». Sus vistas: ${nombres.map((n) => `«${n}»`).join(", ")}.`, {
      vistas: nombres,
    });
  }
  return { ok: true, valor: { vista: base.vistas[i], indice: i } };
}

/** Los valores de una celda como texto plano: enlaces por su alias o destino, listas con «, ». */
export function textoDeCelda(valores: readonly string[] | undefined): string {
  if (valores === undefined || valores.length === 0) return "";
  return valores.map(textoPlanoDeCelda).join(", ");
}

/**
 * Evalúa la vista con el motor de la app (`construirTabla`) y la deja en texto
 * plano: columnas con su título y una fila por nota, con su ruta. Si la vista
 * no se puede aplicar (un filtro fuera del subconjunto), `INVALIDO` con el
 * motivo, igual que la pestaña. Recorta en `tope` y lo dice.
 */
export function tablaParaIa(
  base: Base,
  elegida: { vista: Vista; indice: number },
  notas: NotaTabla[],
  tope = TOPE_FILAS_BASE,
): Validado<{
  vista: string;
  vistas: string[];
  columnas: string[];
  /** `ruta` es la del archivo (el id de la nota), no `file.path`. */
  filas: { ruta: string; celdas: string[] }[];
  total: number;
  recortadas_por_vista: number;
  recortadas_por_tope: number;
  avisos: string[];
}> {
  const tabla = construirTabla(base, elegida.vista, notas);
  if (!tabla.ok) {
    return error("INVALIDO", `La vista no se puede evaluar: ${tabla.motivo}`, tabla.expresion ? { expresion: tabla.expresion } : null);
  }
  const avisos: string[] = [];
  const ignoradas = [...base.ignoradas, ...elegida.vista.ignoradas];
  if (ignoradas.length > 0) avisos.push(`Mycelium ignora: ${[...new Set(ignoradas)].join(", ")}.`);
  const filas = tabla.filas.slice(0, tope).map((f) => ({ ruta: f.nota.id, celdas: f.celdas.map(textoDeCelda) }));
  return {
    ok: true,
    valor: {
      vista: elegida.vista.nombre,
      vistas: base.vistas.map((v) => v.nombre),
      columnas: tabla.columnas.map((c) => tituloColumna(base, c)),
      filas,
      total: tabla.total,
      recortadas_por_vista: tabla.recortadas,
      recortadas_por_tope: tabla.filas.length - filas.length,
      avisos,
    },
  };
}
