/**
 * Escritura de las tablas `enlaces` y `etiquetas` del índice (`FUN-L-25`,
 * Parte A · `DEF-109`). La extracción —qué enlaces y etiquetas salen del texto—
 * es pura y vive en `lib/enlacesNota.ts`; acá están las sentencias y la
 * **resolución**: a qué nota apunta cada fila (`destino_id`).
 *
 * > [!important] La resolución depende solo de lo escrito
 * > `resolveWikilinkEnIndice` no mira desde qué nota sale el enlace: el mismo
 * > `destino_texto` resuelve igual desde cualquier nota. Por eso re-resolver es
 * > barato y dirigido, como en Obsidian: cuando aparece, desaparece o se mueve
 * > una nota, solo pueden cambiar las filas cuya `clave` (el último segmento de
 * > la referencia, en minúsculas) o cuya `clave_ancla` (lo mismo sin el
 * > `#ancla`) es su título, con o sin extensión. Esas se buscan por índice y se
 * > actualizan en una sentencia; el resto ni se lee.
 *
 * Sin `BEGIN`/`COMMIT`, como el resto del indexador: el pool de
 * `tauri-plugin-sql` no garantiza la misma conexión, así que cada sentencia es
 * correcta por sí sola.
 */
import {
  claveDeEnlace,
  claveSinAncla,
  clavesDeTitulo,
  resolverEnlace,
  type EnlaceDerivado,
} from "@/lib/enlacesNota";
import { indexarPorTitulo, type CarpetaEnlazable, type NotaEnlazable } from "@/lib/wikilinks";
import { execute, select } from "./client";
import { plegarEtiqueta } from "./fts";
import { enTandas, marcadores } from "./ftsIndice";
import { huellaDe } from "./util";

/** Lo que el índice guarda de los enlaces y etiquetas de una nota. */
export type EntradaEnlaces = { id: string; enlaces: EnlaceDerivado[]; etiquetas: string[] };

/**
 * Huella de los enlaces y las etiquetas de una nota (`notas.hash_enlaces`). Es
 * propia y no la de `hash_indexable`: casi todo guardado cambia el texto
 * indexable, y casi ninguno cambia los enlaces. Con su propia huella, escribir
 * una frase no reescribe las filas de `enlaces` ni re-resuelve nada.
 */
export function huellaEnlaces(enlaces: EnlaceDerivado[], etiquetas: string[]): string {
  return huellaDe(JSON.stringify([enlaces, etiquetas]));
}

/** Resuelve referencias contra las notas del índice que no están en la papelera. */
export type Resolutor = (enlace: { tipo: string; texto: string }) => string | null;

/**
 * Arma el resolutor sobre el estado actual del índice: el índice por título de
 * las notas que no están en la papelera y las carpetas (la pista de ruta y el
 * desempate por profundidad las necesitan). Dos consultas, sin contenido.
 *
 * Se leen TODAS las notas y no solo las del título buscado porque el `lower()`
 * de SQLite solo entiende ASCII (ver `claveDeEnlace`): filtrar en SQL perdería
 * los títulos con tildes. Son `id`, `titulo`, `carpeta_id` y `tipo` (`DEF-120`): en la Tesina
 * (1.306 notas) unos 150 KB.
 */
export async function crearResolutor(): Promise<Resolutor> {
  const notas = await select<{ id: string; titulo: string; carpeta_id: string | null; tipo: string }>(
    "SELECT id, titulo, carpeta_id, tipo FROM notas WHERE id NOT IN (SELECT nota_id FROM papelera)",
  );
  const carpetas: CarpetaEnlazable[] = (
    await select<{ id: string; nombre: string; padre_id: string | null }>(
      "SELECT id, nombre, padre_id FROM carpetas",
    )
  ).map((c) => ({ id: c.id, nombre: c.nombre, padreId: c.padre_id }));
  const porTitulo = indexarPorTitulo<NotaEnlazable>(
    notas.map((n) => ({ id: n.id, titulo: n.titulo, carpetaId: n.carpeta_id, tipo: n.tipo })),
  );
  const ids = new Set(notas.map((n) => n.id));
  return (enlace) => resolverEnlace(enlace, porTitulo, carpetas, ids);
}

/**
 * Reescribe los enlaces y las etiquetas de VARIAS notas con cuatro sentencias
 * en total (`DELETE … IN` + `INSERT … SELECT FROM json_each(?)` por tabla),
 * como `reindexarPropiedadesTanda`. Con `resolver`, cada fila entra ya
 * resuelta; sin él, entra con `destino_id` NULL y quien llama re-resuelve
 * después (el indexador: una nota de la tanda 1 puede enlazar a una que todavía
 * no se leyó).
 */
export async function escribirEnlacesTanda(
  entradas: EntradaEnlaces[],
  resolver?: Resolutor,
): Promise<void> {
  if (entradas.length === 0) return;
  const ids = JSON.stringify(entradas.map((e) => e.id));
  await execute("DELETE FROM enlaces WHERE desde_id IN (SELECT value FROM json_each(?))", [ids]);
  await execute("DELETE FROM etiquetas WHERE nota_id IN (SELECT value FROM json_each(?))", [ids]);

  const filas = entradas.flatMap(({ id, enlaces }) =>
    enlaces.map((e) => ({
      s: id,
      x: e.texto,
      k: claveDeEnlace(e.texto),
      ka: e.tipo === "archivo" ? null : claveSinAncla(e.texto),
      d: resolver ? resolver(e) : null,
      t: e.tipo,
      n: e.n,
    })),
  );
  if (filas.length > 0) {
    await execute(
      `INSERT INTO enlaces (desde_id, destino_texto, clave, clave_ancla, destino_id, tipo, n)
       SELECT json_extract(value, '$.s'), json_extract(value, '$.x'), json_extract(value, '$.k'),
              json_extract(value, '$.ka'), json_extract(value, '$.d'), json_extract(value, '$.t'),
              json_extract(value, '$.n')
       FROM json_each(?)`,
      [JSON.stringify(filas)],
    );
  }
  // `tag_plegado` (`DEF-152`): por donde filtra `tag:x` en la búsqueda.
  const tags = entradas.flatMap(({ id, etiquetas }) =>
    etiquetas.map((g) => ({ n: id, g, p: plegarEtiqueta(g) })),
  );
  if (tags.length > 0) {
    await execute(
      `INSERT INTO etiquetas (nota_id, tag, tag_plegado)
       SELECT json_extract(value, '$.n'), json_extract(value, '$.g'), json_extract(value, '$.p')
         FROM json_each(?)`,
      [JSON.stringify(tags)],
    );
  }
}

/**
 * Completa `etiquetas.tag_plegado` de las filas que no lo tienen (`DEF-152`):
 * las de un índice creado antes de esa columna, que el `ALTER TABLE` deja en
 * NULL. Sin esto, `tag:x` no encontraría nada en un vault ya indexado hasta
 * que cada nota se volviera a guardar.
 *
 * Como `plegarPropiedadesPendientes`: migra los datos que YA están en el índice
 * sin releer archivos, plegando en JS (el `lower()` de SQLite solo entiende
 * ASCII) y escribiendo con un `UPDATE … FROM json_each(?)` por tanda.
 * Idempotente: en un índice al día, el `SELECT` no devuelve nada.
 */
export async function plegarEtiquetasPendientes(): Promise<void> {
  const pendientes = await select<{ id: number; tag: string }>(
    "SELECT rowid AS id, tag FROM etiquetas WHERE tag_plegado IS NULL",
  );
  const TANDA = 2000;
  for (let i = 0; i < pendientes.length; i += TANDA) {
    const tanda = pendientes.slice(i, i + TANDA).map((f) => ({ r: f.id, p: plegarEtiqueta(f.tag) }));
    await execute(
      `UPDATE etiquetas SET tag_plegado = json_extract(j.value, '$.p')
         FROM json_each(?) AS j
        WHERE etiquetas.rowid = json_extract(j.value, '$.r')`,
      [JSON.stringify(tanda)],
    );
  }
}

/**
 * Re-resolución dirigida (`FUN-L-25`, A2): vuelve a calcular `destino_id` de
 * las filas cuya clave está en `claves` —o de todas, con `null`— y escribe solo
 * las que cambian, en una sentencia por tanda.
 *
 * Una fila por referencia distinta (`destino_texto`, y si es ruta o título):
 * resolver depende solo de eso, así que diez notas que enlazan a `[[Plan]]` son
 * una entrada, no diez.
 */
export async function reResolverClaves(claves: Iterable<string> | null): Promise<void> {
  let refs: { archivo: number; texto: string }[];
  if (claves === null) {
    refs = await select<{ archivo: number; texto: string }>(
      "SELECT DISTINCT tipo = 'archivo' AS archivo, destino_texto AS texto FROM enlaces",
    );
  } else {
    const lista = [...new Set(claves)].filter((c) => c !== "");
    if (lista.length === 0) return;
    refs = [];
    // Por las dos claves: una fila `[[Plan#Objetivos]]` depende de la nota
    // «Plan#Objetivos» (su `clave`) y, si esa no existe, de «Plan» (`clave_ancla`).
    for (const tanda of enTandas(lista)) {
      const q = marcadores(tanda.length);
      refs.push(
        ...(await select<{ archivo: number; texto: string }>(
          `SELECT DISTINCT tipo = 'archivo' AS archivo, destino_texto AS texto
           FROM enlaces WHERE clave IN (${q}) OR clave_ancla IN (${q})`,
          [...tanda, ...tanda],
        )),
      );
    }
  }
  if (refs.length === 0) return;

  const resolver = await crearResolutor();
  const cambios = refs.map((r) => {
    const archivo = Number(r.archivo) === 1;
    return {
      a: archivo ? 1 : 0,
      x: r.texto,
      k: claveDeEnlace(r.texto),
      d: resolver({ tipo: archivo ? "archivo" : "enlace", texto: r.texto }),
    };
  });
  // `UPDATE … FROM` (SQLite ≥ 3.33; el plugin trae la 3.46): cada referencia
  // busca sus filas por `clave` (indexada) y solo toca las que cambian.
  for (const tanda of enTandas(cambios)) {
    await execute(
      `UPDATE enlaces SET destino_id = j.d
       FROM (SELECT json_extract(value, '$.k') AS k, json_extract(value, '$.x') AS x,
                    json_extract(value, '$.a') AS a, json_extract(value, '$.d') AS d
             FROM json_each(?)) AS j
       WHERE enlaces.clave = j.k AND enlaces.destino_texto = j.x
         AND (enlaces.tipo = 'archivo') = j.a
         AND enlaces.destino_id IS NOT j.d`,
      [JSON.stringify(tanda)],
    );
  }
}

/**
 * Re-resuelve lo que puede haber cambiado porque aparecieron, desaparecieron o
 * se movieron notas con estos títulos: crear, renombrar, mover, mandar a la
 * papelera o recuperar. Un enlace roto a `[[Idea]]` pasa a resolver cuando
 * aparece `Idea.md`, y uno a una nota que se fue pasa a su homónima o a NULL.
 */
export async function reResolverTitulos(titulos: Iterable<string>): Promise<void> {
  const claves = new Set<string>();
  for (const t of titulos) for (const c of clavesDeTitulo(t)) claves.add(c);
  await reResolverClaves(claves);
}
