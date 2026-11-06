/**
 * La salud del vault (`FUN-L-30`, propuesta 2 de `ia-vaults-intensivos`): qué
 * enlaces están rotos, qué notas nadie enlaza, qué títulos se repiten y qué
 * notas no enlazan a nada. Módulo **puro**: lo usan el panel de salud de la app
 * y las herramientas `mycelium_salud` y `mycelium_validar_nota` del MCP, y
 * `scripts/test-salud.mjs` lo transpila e importa sin build.
 *
 * > [!important] El criterio es el del índice, no uno propio
 * > No se busca nada en el texto con una expresión regular: se parte de las
 * > filas de la tabla `enlaces` **ya resueltas por el indexador** (qué cuenta
 * > como enlace: `derivarEnlaces`, sin el código, con alias y anclas; a qué
 * > nota apunta: `resolverEnlace`). Así un `[[x]]` dentro de un bloque de
 * > código no es un enlace roto, `[[X|alias]]` y `[[X#Encabezado]]` cuentan
 * > como enlaces a `X`, y lo que cambie en el resolutor llega solo.
 * > La línea de cada problema sale de `lineasPorEnlace`, la misma regla.
 *
 * Qué se considera (spec: `docs/features/ia-vaults-intensivos.md` § 2):
 *
 * - **Enlace roto**: una fila sin destino. Un `[[foto.png]]` o un `![[doc.pdf]]`
 *   a un archivo que existe pero no es nota **no** está roto (el índice no los
 *   resuelve porque no son notas, pero están).
 * - **Embed roto**: lo mismo con `![[…]]`.
 * - **Huérfana**: una nota markdown a la que no llega ninguna arista (desde otra
 *   nota, sin la papelera). Un lienzo que la tiene como tarjeta o la nombra en
 *   una tarjeta de texto **la enlaza**. Los dibujos, diagramas, lienzos y tablas
 *   no se reportan como huérfanos: suelen embeberse o ser ellos el índice.
 * - **Sin enlaces salientes**: una nota markdown sin ninguna arista hacia otra.
 * - **Título duplicado**: dos o más notas del mismo tipo con el mismo título
 *   (sin distinguir mayúsculas). Con tipos distintos no hay ambigüedad: un
 *   `[[Plan]]` prefiere la nota y `[[Plan.canvas]]` nombra el lienzo. Cada grupo
 *   trae los **enlaces ambiguos**: los que tienen más de un candidato.
 * - **Fuera de los chequeos**: la **Bandeja** del vault (`FUN-L-33`: material sin
 *   procesar, que no se enlaza ni es huérfana por diseño), las **Esporas** (moldes, no memoria: sus
 *   `[[{{titulo}}]]` no son enlaces rotos ni ellas huérfanas) y los archivos de
 *   **instrucciones para agentes** en la raíz (`CLAUDE.md`, `AGENTS.md`), que
 *   no son conocimiento del vault. Las Esporas sí cuentan para los títulos
 *   duplicados: una Espora «Reunión» y una nota «Reunión» hacen ambiguo a
 *   `[[Reunión]]`.
 */
import { cortesDeAncla, derivarEnlaces, lineasPorEnlace, resolverEnlace } from "@/lib/enlacesNota";
import { indexarOtros, resolverArchivo } from "@/lib/mcpIndiceLogica";
import {
  candidatosWikilinkEnIndice,
  indexarPorTitulo,
  notasPorTitulo,
  type CarpetaEnlazable,
  type NotaEnlazable,
} from "@/lib/wikilinks";

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Una fila de `enlaces`, como la lee `lib/db/indiceIa.ts`. */
export type FilaEnlace = { desde: string; texto: string; tipo: string; destino: string | null; n: number };

/** Sobre qué se mide la salud. */
export type Alcance = { tipo: "vault" } | { tipo: "carpeta"; ruta: string } | { tipo: "nota"; ruta: string };

/** Un enlace con problema: en qué nota está, qué dice y en qué líneas. */
export type Problema = {
  desde: string;
  texto: string;
  /** `enlace`, `embed`, `canvas` (tarjeta de texto) o `archivo` (tarjeta de nota). */
  tipo: string;
  /** Cuántas veces aparece así en la nota. */
  n: number;
  /** Las líneas (desde 1); vacía hasta `ponerLineas`, o si no es prosa. */
  lineas: number[];
};

/** Una nota en un listado. */
export type NotaRef = { ruta: string; titulo: string };

/** Notas homónimas y los enlaces que no saben a cuál ir. */
export type Duplicado = { titulo: string; tipo: string; rutas: string[]; ambiguos: Problema[] };

/** Un aviso de propiedades de una nota (`FUN-M-46`): ver `lib/esquemas.ts`. */
export type AvisoDeNota = { clase: string; clave: string | null; linea: number; mensaje: string };

/** Una nota cuyas propiedades no cumplen sus esquemas (o tienen un `#` sin comillas). */
export type NotaConAvisos = NotaRef & { avisos: AvisoDeNota[] };

export type InformeSalud = {
  alcance: Alcance;
  /** Notas consideradas (sin Esporas ni instrucciones). */
  notas: number;
  rotos: Problema[];
  embedsRotos: Problema[];
  duplicados: Duplicado[];
  huerfanas: NotaRef[];
  sinSalientes: NotaRef[];
  /**
   * Notas con propiedades que no cumplen (`FUN-M-46`). `calcularSalud` la deja
   * vacía: la llena `lib/saludVault.ts`, que es quien lee los contenidos.
   */
  propiedades: NotaConAvisos[];
  /** Problemas del propio `esquemas.yml` (vacía si no hay o está bien). */
  avisosEsquemas: { mensaje: string; linea?: number }[];
};

export type EntradaSalud = {
  notas: readonly NotaEnlazable[];
  carpetas: readonly CarpetaEnlazable[];
  filas: readonly FilaEnlace[];
  /** Rutas de los archivos del vault que no son notas (imágenes, PDF…). */
  otros: readonly string[];
  /** Carpeta de Esporas (normalizada), o `null` si no hay. */
  carpetaEsporas: string | null;
  /** Ruta de la Bandeja del vault (`FUN-L-33`), o `null`/ausente si no se excluye. */
  rutaBandeja?: string | null;
  alcance?: Alcance;
};

/** Archivos de instrucciones para agentes, en la raíz: no son conocimiento del vault. */
export const INSTRUCCIONES_DE_AGENTES: ReadonlySet<string> = new Set(["claude.md", "agents.md"]);

// ── Qué entra ────────────────────────────────────────────────────────────────

/** ¿Está la nota en la carpeta de Esporas (o debajo)? */
export function esEspora(nota: { carpetaId: string | null }, carpetaEsporas: string | null): boolean {
  if (!carpetaEsporas || nota.carpetaId === null) return false;
  return nota.carpetaId === carpetaEsporas || nota.carpetaId.startsWith(`${carpetaEsporas}/`);
}

/** ¿Es la Bandeja del vault (`FUN-L-33`)? Sin distinguir mayúsculas, como `esRutaBandeja`. */
export function esLaBandeja(nota: { id: string }, rutaBandeja: string | null | undefined): boolean {
  return !!rutaBandeja && nota.id.toLowerCase() === rutaBandeja.toLowerCase();
}

/** ¿Queda fuera de los chequeos (Bandeja, Espora o instrucciones de agentes)? */
export function excluida(
  nota: { id: string; carpetaId: string | null },
  carpetaEsporas: string | null,
  rutaBandeja: string | null = null,
): boolean {
  return (
    esLaBandeja(nota, rutaBandeja) ||
    esEspora(nota, carpetaEsporas) ||
    (nota.carpetaId === null && INSTRUCCIONES_DE_AGENTES.has(nota.id.toLowerCase()))
  );
}

/** ¿Cae `ruta` dentro del alcance? */
export function enAlcance(ruta: string, alcance: Alcance): boolean {
  if (alcance.tipo === "vault") return true;
  if (alcance.tipo === "nota") return ruta === alcance.ruta;
  return alcance.ruta === "" || ruta.startsWith(`${alcance.ruta}/`);
}

// ── Ambigüedad ───────────────────────────────────────────────────────────────

/**
 * Los candidatos de una referencia con las reglas del resolutor: entera y, si
 * no tiene ninguno, cada corte sin el ancla (`DEF-141`). Más de uno = ambiguo:
 * el enlace va al más cercano a la raíz sin que nadie lo haya elegido.
 */
export function candidatosDeReferencia<N extends NotaEnlazable>(
  texto: string,
  porTitulo: Map<string, N[]>,
  carpetas: readonly CarpetaEnlazable[],
): N[] {
  const enteros = candidatosWikilinkEnIndice(texto, porTitulo, carpetas);
  if (enteros.length > 0) return enteros;
  for (const corte of cortesDeAncla(texto)) {
    if (corte === "") continue;
    const c = candidatosWikilinkEnIndice(corte, porTitulo, carpetas);
    if (c.length > 0) return c;
  }
  return [];
}

// ── El informe ───────────────────────────────────────────────────────────────

const problema = (f: FilaEnlace): Problema => ({ desde: f.desde, texto: f.texto, tipo: f.tipo, n: f.n, lineas: [] });

const porRuta = <T extends { ruta?: string; desde?: string }>(a: T, b: T) => {
  const x = a.ruta ?? a.desde ?? "";
  const y = b.ruta ?? b.desde ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Calcula el informe. Sin contenido: las líneas las pone `ponerLineas` después,
 * leyendo solo las notas que tienen problemas (`notasConProblemas`).
 */
export function calcularSalud(entrada: EntradaSalud): InformeSalud {
  const alcance = entrada.alcance ?? { tipo: "vault" };
  const { notas, carpetas, filas, carpetaEsporas } = entrada;
  const rutaBandeja = entrada.rutaBandeja ?? null;
  const porId = new Map(notas.map((n) => [n.id, n]));
  const otros = indexarOtros(entrada.otros);
  const fuera = (id: string) => {
    const n = porId.get(id);
    return n === undefined || excluida(n, carpetaEsporas, rutaBandeja);
  };

  const rotos: Problema[] = [];
  const embedsRotos: Problema[] = [];
  const entrantes = new Set<string>();
  const salientes = new Set<string>();
  for (const f of filas) {
    if (!porId.has(f.desde)) continue;
    if (f.destino !== null) {
      if (f.destino !== f.desde && porId.has(f.destino)) {
        entrantes.add(f.destino);
        salientes.add(f.desde);
      }
      continue;
    }
    if (fuera(f.desde) || !enAlcance(f.desde, alcance)) continue;
    if (resolverArchivo(f, otros) !== null) continue;
    (f.tipo === "embed" ? embedsRotos : rotos).push(problema(f));
  }

  // Títulos repetidos dentro del mismo tipo, y los enlaces que dudan entre ellos.
  const grupos = new Map<string, NotaEnlazable[]>();
  for (const n of notas) {
    const k = `${n.tipo}\u0000${n.titulo.toLowerCase()}`;
    const g = grupos.get(k);
    if (g) g.push(n);
    else grupos.set(k, [n]);
  }
  const porTitulo = indexarPorTitulo(notas);
  const duplicados: Duplicado[] = [];
  const ambiguosDe = new Map<string, Duplicado>();
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const rutas = g.map((n) => n.id).sort();
    const d: Duplicado = { titulo: g[0].titulo, tipo: g[0].tipo, rutas, ambiguos: [] };
    duplicados.push(d);
    for (const r of rutas) ambiguosDe.set(r, d);
  }
  if (duplicados.length > 0) {
    // Solo las filas cuyo destino es una homónima pueden ser ambiguas.
    const vistas = new Map<string, NotaEnlazable[]>();
    for (const f of filas) {
      if (f.destino === null || f.tipo === "archivo" || !ambiguosDe.has(f.destino)) continue;
      if (!porId.has(f.desde) || fuera(f.desde)) continue;
      let cands = vistas.get(f.texto);
      if (cands === undefined) {
        cands = candidatosDeReferencia(f.texto, porTitulo, carpetas);
        vistas.set(f.texto, cands);
      }
      if (cands.length > 1) ambiguosDe.get(f.destino)!.ambiguos.push(problema(f));
    }
  }
  const duplicadosEnAlcance = duplicados
    .filter((d) => d.rutas.some((r) => enAlcance(r, alcance)) || d.ambiguos.some((a) => enAlcance(a.desde, alcance)))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "es") || a.tipo.localeCompare(b.tipo));

  const consideradas = notas.filter((n) => !excluida(n, carpetaEsporas, rutaBandeja) && enAlcance(n.id, alcance));
  const ref = (n: NotaEnlazable): NotaRef => ({ ruta: n.id, titulo: n.titulo });
  const markdown = consideradas.filter((n) => n.tipo === "markdown");

  return {
    alcance,
    notas: consideradas.length,
    rotos: rotos.sort(porRuta),
    embedsRotos: embedsRotos.sort(porRuta),
    duplicados: duplicadosEnAlcance,
    huerfanas: markdown.filter((n) => !entrantes.has(n.id)).map(ref).sort(porRuta),
    sinSalientes: markdown.filter((n) => !salientes.has(n.id)).map(ref).sort(porRuta),
    propiedades: [],
    avisosEsquemas: [],
  };
}

// ── Los problemas de UNA nota (diagnósticos del editor) ──────────────────────

/**
 * Lo que los diagnósticos de una nota (`FUN-M-44`) leen del informe: sus
 * enlaces y embeds rotos, y los grupos de homónimas en los que participa —por
 * ser una de ellas o por tener un enlace ambiguo—. Sin líneas (el diagnóstico
 * las busca en el texto del editor), sin huérfanas ni propiedades.
 */
export type ProblemasDeNota = Pick<InformeSalud, "rotos" | "embedsRotos" | "duplicados">;

export type EntradaProblemasDeNota = {
  notaId: string;
  /** Todas las notas del vault (las del árbol: `useVaultStore().notas`). */
  notas: readonly NotaEnlazable[];
  carpetas: readonly CarpetaEnlazable[];
  /** **Solo** las filas de `enlaces` de la nota (`filasDelIndice(notaId)`). */
  filas: readonly FilaEnlace[];
  otros: readonly string[];
  carpetaEsporas: string | null;
  rutaBandeja?: string | null;
};

/**
 * El orden de `ORDER BY id` de SQLite (BINARY sobre UTF-8 = por punto de
 * código). El de `<` en JS es por unidad UTF-16 y difiere solo entre un par
 * sustituto (≥ U+10000) y un carácter U+E000–U+FFFF; se respeta igual para que
 * el título que nombra un grupo de homónimas («Plan» o «plan») sea el mismo que
 * elegía `calcularSalud` sobre las notas del índice.
 */
function comoOrdenSqlite(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    const sx = x >= 0xd800 && x <= 0xdfff;
    const sy = y >= 0xd800 && y <= 0xdfff;
    if (sx !== sy) return sx ? 1 : -1;
    return x - y;
  }
  return a.length - b.length;
}

type GrupoTitulo = { titulo: string; tipo: string; rutas: string[]; orden: number };
type GruposDeNotas = { porId: Map<string, NotaEnlazable>; grupoDe: Map<string, GrupoTitulo> };

/**
 * Las notas por id y los grupos de títulos repetidos, calculados **una vez por
 * lista de notas**: la del store no se muta (cada cambio del árbol es una lista
 * nueva), así que sirve de clave, como `notasPorTitulo`. Con varios editores
 * abiertos y un guardado cada pocos segundos, se arma una vez por cambio del
 * árbol y no por diagnóstico.
 */
const gruposPorLista = new WeakMap<readonly NotaEnlazable[], GruposDeNotas>();

function gruposDe(notas: readonly NotaEnlazable[]): GruposDeNotas {
  let g = gruposPorLista.get(notas);
  if (g) return g;
  // El mismo recorrido de `calcularSalud`, en el orden en que el índice le
  // daba las notas (por id): define el título del grupo y el orden de empate.
  const ordenadas = [...notas].sort((a, b) => comoOrdenSqlite(a.id, b.id));
  const porClave = new Map<string, NotaEnlazable[]>();
  for (const n of ordenadas) {
    const k = `${n.tipo}\u0000${n.titulo.toLowerCase()}`;
    const lista = porClave.get(k);
    if (lista) lista.push(n);
    else porClave.set(k, [n]);
  }
  const grupoDe = new Map<string, GrupoTitulo>();
  let orden = 0;
  for (const lista of porClave.values()) {
    if (lista.length < 2) continue;
    const grupo: GrupoTitulo = { titulo: lista[0].titulo, tipo: lista[0].tipo, rutas: lista.map((n) => n.id).sort(), orden: orden++ };
    for (const r of grupo.rutas) grupoDe.set(r, grupo);
  }
  g = { porId: new Map(notas.map((n) => [n.id, n])), grupoDe };
  gruposPorLista.set(notas, g);
  return g;
}

/**
 * Los problemas de una nota, con **sus** filas y no las del vault entero
 * (`FUN-M-58`). Da lo mismo que `calcularSalud` con alcance `nota` en las tres
 * listas que leen los diagnósticos —mismos rotos, mismos grupos, mismo orden;
 * en `ambiguos`, solo los de esta nota, que son los únicos que el diagnóstico
 * mira—, pero sin traer del índice todas las notas, los alias, las carpetas y
 * todas las filas de `enlaces` en cada guardado de cada editor abierto: en un
 * vault de 1.525 notas eran 5–7 viajes y ~1,35 MB por disparo.
 *
 * > [!warning] Las notas vienen del árbol, no del índice
 * > En el hueco de los pendientes (`FUN-M-42`) el árbol va **adelante** del
 * > índice. Lo único que puede adelantarse así es un **título duplicado** (una
 * > homónima recién creada por fuera se ve antes de indexarse); los destinos de
 * > los enlaces no, porque vienen resueltos en las filas del índice. Y el editor
 * > recalcula al cambiar el árbol, de modo que el aviso se adelanta, no se pierde.
 */
export function problemasDeNota(entrada: EntradaProblemasDeNota): ProblemasDeNota {
  const { notaId, notas, carpetas, filas, carpetaEsporas } = entrada;
  const { porId, grupoDe } = gruposDe(notas);
  const nota = porId.get(notaId);
  // Una nota que no está (en el índice, antes; en el árbol, ahora) no tiene problemas.
  if (nota === undefined) return { rotos: [], embedsRotos: [], duplicados: [] };
  const fuera = excluida(nota, carpetaEsporas, entrada.rutaBandeja ?? null);

  const rotos: Problema[] = [];
  const embedsRotos: Problema[] = [];
  const ambiguosDe = new Map<GrupoTitulo, Problema[]>();
  let otros: ReturnType<typeof indexarOtros> | null = null;
  const vistas = new Map<string, number>();
  for (const f of filas) {
    if (f.desde !== notaId || fuera) continue;
    if (f.destino === null) {
      otros ??= indexarOtros(entrada.otros);
      if (resolverArchivo(f, otros) !== null) continue;
      (f.tipo === "embed" ? embedsRotos : rotos).push(problema(f));
      continue;
    }
    const grupo = f.tipo === "archivo" ? undefined : grupoDe.get(f.destino);
    if (grupo === undefined) continue;
    let n = vistas.get(f.texto);
    if (n === undefined) {
      n = candidatosDeReferencia(f.texto, notasPorTitulo(notas), carpetas).length;
      vistas.set(f.texto, n);
    }
    if (n < 2) continue;
    const lista = ambiguosDe.get(grupo);
    if (lista) lista.push(problema(f));
    else ambiguosDe.set(grupo, [problema(f)]);
  }

  const propio = grupoDe.get(notaId);
  const grupos = new Set(ambiguosDe.keys());
  if (propio) grupos.add(propio);
  const duplicados: Duplicado[] = [...grupos]
    .sort((a, b) => a.orden - b.orden)
    .map((g) => ({ titulo: g.titulo, tipo: g.tipo, rutas: [...g.rutas], ambiguos: ambiguosDe.get(g) ?? [] }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "es") || a.tipo.localeCompare(b.tipo));

  return { rotos: rotos.sort(porRuta), embedsRotos: embedsRotos.sort(porRuta), duplicados };
}

/** Las notas cuyo contenido hace falta para ponerle línea a los problemas. */
export function notasConProblemas(informe: InformeSalud): string[] {
  const ids = new Set<string>();
  for (const p of [...informe.rotos, ...informe.embedsRotos]) ids.add(p.desde);
  for (const d of informe.duplicados) for (const a of d.ambiguos) ids.add(a.desde);
  return [...ids];
}

/**
 * Pone las líneas a los problemas con el contenido de sus notas. `tipos` dice
 * el tipo de cada nota (un canvas no tiene líneas). Muta el informe.
 */
export function ponerLineas(
  informe: InformeSalud,
  contenidos: ReadonlyMap<string, string>,
  tipos: ReadonlyMap<string, string>,
): void {
  const cache = new Map<string, Map<string, number[]>>();
  const lineas = (p: Problema) => {
    const contenido = contenidos.get(p.desde);
    if (contenido === undefined) return;
    let mapa = cache.get(p.desde);
    if (!mapa) {
      mapa = lineasPorEnlace(contenido, tipos.get(p.desde) ?? "markdown");
      cache.set(p.desde, mapa);
    }
    p.lineas = mapa.get(`${p.tipo}\u0000${p.texto}`) ?? [];
  };
  for (const p of informe.rotos) lineas(p);
  for (const p of informe.embedsRotos) lineas(p);
  for (const d of informe.duplicados) for (const a of d.ambiguos) lineas(a);
}

/** Cuántos problemas hay de cada clase, y en total. */
export function conteos(informe: InformeSalud): {
  rotos: number;
  embedsRotos: number;
  duplicados: number;
  huerfanas: number;
  sinSalientes: number;
  propiedades: number;
  total: number;
} {
  const c = {
    rotos: informe.rotos.length,
    embedsRotos: informe.embedsRotos.length,
    duplicados: informe.duplicados.length,
    huerfanas: informe.huerfanas.length,
    sinSalientes: informe.sinSalientes.length,
    propiedades: informe.propiedades?.length ?? 0,
  };
  return { ...c, total: c.rotos + c.embedsRotos + c.duplicados + c.huerfanas + c.sinSalientes + c.propiedades };
}

// ── Validar una nota ─────────────────────────────────────────────────────────

/** Un chequeo de cierre sobre una nota: si pasó y qué hay que mirar. */
export type Chequeo = { id: string; ok: boolean; titulo: string; detalle: string[] };

/** Lo que recibe un validador de nota: la nota, su contenido y el informe de su alcance. */
export type ContextoValidacion = {
  nota: NotaEnlazable;
  contenido: string;
  informe: InformeSalud;
  /** Quién la enlaza (rutas), sin ella misma. */
  backlinks: string[];
};

/**
 * Un chequeo que se suma a `mycelium_validar_nota`. **Punto de extensión**: las
 * propiedades válidas según los esquemas de `FUN-M-46` se enchufan acá con
 * `registrarValidadorNota`, sin tocar la herramienta.
 */
export type ValidadorNota = (ctx: ContextoValidacion) => Chequeo[] | Promise<Chequeo[]>;

const validadoresExtra: ValidadorNota[] = [];

/** Agrega un validador a `mycelium_validar_nota` (una sola vez por función). */
export function registrarValidadorNota(v: ValidadorNota): void {
  if (!validadoresExtra.includes(v)) validadoresExtra.push(v);
}

/** Los validadores registrados, en orden. */
export function validadoresNota(): readonly ValidadorNota[] {
  return validadoresExtra;
}

const describir = (p: Problema) =>
  `${p.tipo === "embed" ? "![[" : "[["}${p.texto}]]` +
  (p.lineas.length > 0 ? ` (línea ${p.lineas.join(", ")})` : "");

/**
 * Los chequeos de siempre sobre una nota, con el informe de su alcance (`nota`):
 * título único, enlaces que resuelven, alguien la enlaza. Una Espora o un archivo
 * de instrucciones no se juzgan como memoria: lo dice y pasa.
 */
export function chequeosBasicos(
  ctx: Omit<ContextoValidacion, "contenido">,
  carpetaEsporas: string | null,
  rutaBandeja: string | null = null,
): Chequeo[] {
  const { nota, informe, backlinks } = ctx;
  const dup = informe.duplicados.find((d) => d.rutas.includes(nota.id));
  const chequeos: Chequeo[] = [
    {
      id: "titulo_unico",
      ok: dup === undefined,
      titulo: "Título único",
      detalle: dup ? [`Hay ${dup.rutas.length} con el título «${dup.titulo}»: ${dup.rutas.join(", ")}.`] : [],
    },
  ];
  if (excluida(nota, carpetaEsporas, rutaBandeja)) {
    chequeos.push({
      id: "excluida",
      ok: true,
      titulo: esLaBandeja(nota, rutaBandeja)
        ? "Es la Bandeja del vault"
        : esEspora(nota, carpetaEsporas)
          ? "Es una Espora (plantilla)"
          : "Es un archivo de instrucciones",
      detalle: ["No es memoria: sus enlaces y sus backlinks no se juzgan."],
    });
    return chequeos;
  }
  const rotos = [...informe.rotos, ...informe.embedsRotos].filter((p) => p.desde === nota.id);
  const ambiguos = informe.duplicados.flatMap((d) => d.ambiguos).filter((p) => p.desde === nota.id);
  chequeos.push({
    id: "enlaces_resuelven",
    ok: rotos.length === 0 && ambiguos.length === 0,
    titulo: "Sus enlaces resuelven",
    detalle: [
      ...rotos.map((p) => `Roto: ${describir(p)}`),
      ...ambiguos.map((p) => `Ambiguo (hay homónimas): ${describir(p)}`),
    ],
  });
  if (nota.tipo === "markdown") {
    chequeos.push({
      id: "enlazada",
      ok: backlinks.length > 0,
      titulo: "Alguien la enlaza",
      detalle:
        backlinks.length > 0
          ? [`La enlazan ${backlinks.length}: ${backlinks.slice(0, 10).join(", ")}${backlinks.length > 10 ? "…" : ""}.`]
          : ["Ninguna nota la enlaza: está huérfana. Enlázala desde su mapa o nota madre."],
    });
  }
  return chequeos;
}

// ── Para los tests: las filas como las escribe el indexador ──────────────────

/**
 * Las filas de `enlaces` de un conjunto de notas con contenido, con las mismas
 * dos funciones que usa el indexador (`derivarEnlaces` + `resolverEnlace`). La
 * app no la usa —lee las filas del índice—; sirve para probar el informe sobre
 * texto real sin SQLite.
 */
export function filasComoElIndice<N extends NotaEnlazable>(
  notas: readonly (N & { contenido: string })[],
  carpetas: readonly CarpetaEnlazable[],
): FilaEnlace[] {
  const porTitulo = indexarPorTitulo(notas);
  const ids = new Set(notas.map((n) => n.id));
  return notas.flatMap((n) =>
    derivarEnlaces(n.contenido, n.tipo).map((e) => ({
      desde: n.id,
      texto: e.texto,
      tipo: e.tipo,
      n: e.n,
      destino: resolverEnlace(e, porTitulo, carpetas, ids),
    })),
  );
}

// ── Para el agente ───────────────────────────────────────────────────────────

/** Cuántos ítems de cada clase devuelve como mucho `mycelium_salud`. */
export const TOPE_SALUD = 100;

/**
 * El informe para `mycelium_salud`: cada lista recortada en `tope`, con los
 * conteos completos para que el agente sepa cuánto falta.
 */
export function informeParaIa(informe: InformeSalud, tope = TOPE_SALUD) {
  const c = conteos(informe);
  const corte = <T>(l: T[]) => l.slice(0, tope);
  return {
    alcance: informe.alcance,
    notas: informe.notas,
    conteos: c,
    tope,
    rotos: corte(informe.rotos),
    embeds_rotos: corte(informe.embedsRotos),
    duplicados: corte(informe.duplicados).map((d) => ({ ...d, ambiguos: corte(d.ambiguos) })),
    huerfanas: corte(informe.huerfanas),
    sin_salientes: corte(informe.sinSalientes),
    // `FUN-M-46`: notas con propiedades que no cumplen sus esquemas o con un `#` sin comillas.
    propiedades: corte(informe.propiedades ?? []).map((n) => ({ ...n, avisos: corte(n.avisos) })),
    ...((informe.avisosEsquemas?.length ?? 0) > 0 ? { esquemas_avisos: informe.avisosEsquemas } : {}),
  };
}
