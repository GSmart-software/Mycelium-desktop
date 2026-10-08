/**
 * Propiedades del frontmatter en el índice del vault (`FUN-M-04`). El índice NO
 * es la fuente de verdad —lo son los archivos— pero es lo que hace las
 * propiedades CONSULTABLES: sin una tabla que se pueda filtrar, los metadatos
 * quedarían guardados y no servirían para nada (y `FUN-L-03`, los archivos
 * tabla, no tendría de dónde leer).
 *
 * La tabla guarda **una fila por elemento** de lista, así
 * `WHERE clave='tags' AND valor='activo'` funciona sin `LIKE`.
 * Ver `docs/features/metadata-yaml.md` § 4.
 */
import { cuerpoDe, separarFrontmatter, type Frontmatter, type Propiedad } from "@/lib/frontmatter";
import { textoBuscable } from "@/lib/textoBuscable";
import { execute, select } from "./client";
import { plegar } from "./fts";
import { huellaDe } from "./util";

export type PropiedadDto = { clave: string; valor: string; tipo: string; orden: number };

/** Un escalar del frontmatter normalizado a texto (así se guarda en el índice). */
function escalarATexto(valor: string | number | boolean): string {
  return typeof valor === "boolean" ? (valor ? "true" : "false") : String(valor);
}

/** Valores indexables de una propiedad: una entrada por elemento de la lista. */
function valoresDe(p: Propiedad): string[] {
  return Array.isArray(p.valor) ? p.valor.map((v) => String(v)) : [escalarATexto(p.valor)];
}

/**
 * Lo que va al índice FTS (`DEF-148`): el CUERPO como se lee (`textoBuscable`:
 * los enlaces por su texto visible, sin marcas de markdown; de un canvas, sus
 * tarjetas y no su JSON) en `contenido`, y en `extra` lo que tiene que
 * encontrarse sin verse en el fragmento: los VALORES de las propiedades y los
 * destinos ocultos de los enlaces.
 *
 * Las claves y la sintaxis YAML no entran (`FUN-M-04`): buscar «activo» sigue
 * encontrando la nota, pero buscar «tags» no devuelve todas las que tienen esa
 * clave. Y los valores ya no van pegados delante del cuerpo: antes el
 * fragmento de una coincidencia en una propiedad era el frontmatter aplastado
 * en una línea («cultivo cucurbitáceas Bancal 3 planificado…»).
 */
function textoIndexableDe(texto: string, fm: Frontmatter, tipo: string): { contenido: string; extra: string } {
  const { visible, oculto } = textoBuscable(cuerpoDe(texto, fm), tipo);
  const valores = !fm.hay || !fm.soportado ? [] : fm.props.flatMap(valoresDe).filter((v) => v.length > 0);
  return { contenido: visible, extra: [...valores, ...oculto].join("\n") };
}

/** Una fila de `propiedades` de una nota: clave, valor, tipo y orden en su lista. */
export type FilaPropiedad = { c: string; v: string; t: string; o: number };

/** Las filas de `propiedades` que salen del frontmatter (una por elemento de lista). */
function filasDe(fm: Frontmatter): FilaPropiedad[] {
  if (!fm.hay || !fm.soportado) return [];
  const filas: FilaPropiedad[] = [];
  for (const p of fm.props) {
    const valores = valoresDe(p);
    for (let i = 0; i < valores.length; i++) {
      filas.push({ c: p.clave, v: valores[i], t: p.tipo, o: i });
    }
  }
  return filas;
}

/** Lo que el índice deriva del texto de una nota (ver `derivarIndice`). */
export type DerivadoIndice = {
  /** Columna `contenido` de `notas_fts`: el texto legible, de donde sale el fragmento. */
  contenido: string;
  /** Columna `extra`: valores de propiedades y destinos ocultos (ver `textoIndexableDe`). */
  extra: string;
  propiedades: FilaPropiedad[];
  huella: string;
};

/**
 * Todo lo que el índice deriva del texto de una nota, parseando el frontmatter
 * UNA vez: `contenido` y `extra` van a `notas_fts`, `propiedades` a la tabla del mismo
 * nombre y `huella` resume las dos (`FUN-M-38`, hallazgo H10). La huella se
 * guarda en `notas.hash_indexable`: si al guardar coincide con la anterior, ni
 * la tabla de búsqueda ni la de propiedades cambiarían, así que no se
 * reescriben —en una nota de 500 KB eso son cientos de ms de FTS5 por
 * guardado—. Se calcula sobre las FILAS y no sobre el frontmatter crudo: mover
 * una propiedad de línea o cambiarle un comentario no obliga a reindexar.
 */
export function derivarIndice(texto: string, tipo = "markdown"): DerivadoIndice {
  const fm = separarFrontmatter(texto);
  const { contenido, extra } = textoIndexableDe(texto, fm, tipo);
  const propiedades = filasDe(fm);
  const huella = huellaDe(`${JSON.stringify(propiedades)}\u0000${contenido}\u0000${extra}`);
  return { contenido, extra, propiedades, huella };
}

/**
 * Reescribe las propiedades de VARIAS notas en el índice con dos sentencias en
 * total —un `DELETE … IN` y un `INSERT … SELECT FROM json_each(?)`—, en vez de
 * una por fila (`FUN-M-38`, hallazgo H1: en un vault con 765 notas con
 * frontmatter eran 6.966 viajes por el puente IPC, a 4–5 ms cada uno). Las
 * filas llegan ya derivadas (`derivarIndice`). Sin `BEGIN`/`COMMIT`: el pool de
 * `tauri-plugin-sql` no garantiza la misma conexión, así que cada sentencia es
 * correcta por sí sola, igual que el `DELETE` + `INSERT`s de antes.
 */
export async function reindexarPropiedadesTanda(
  entradas: { id: string; propiedades: FilaPropiedad[] }[],
): Promise<void> {
  if (entradas.length === 0) return;
  await execute(
    "DELETE FROM propiedades WHERE nota_id IN (SELECT value FROM json_each(?))",
    [JSON.stringify(entradas.map((e) => e.id))],
  );
  // La clave y el valor van además plegados (`DEF-144`): es por donde filtra la
  // búsqueda `clave:valor`. Se calculan acá y no en `derivarIndice` para que la
  // huella de la nota no cambie por esto.
  const filas = entradas.flatMap(({ id, propiedades }) =>
    propiedades.map((f) => ({ n: id, ...f, cp: plegar(f.c), vp: plegar(f.v) })),
  );
  if (filas.length === 0) return;
  await execute(
    `INSERT INTO propiedades (nota_id, clave, valor, tipo, orden, clave_plegada, valor_plegado)
     SELECT json_extract(value, '$.n'), json_extract(value, '$.c'), json_extract(value, '$.v'),
            json_extract(value, '$.t'), json_extract(value, '$.o'),
            json_extract(value, '$.cp'), json_extract(value, '$.vp')
     FROM json_each(?)`,
    [JSON.stringify(filas)],
  );
}

/** `GET /notas/{id}/propiedades` — lo indexado para una nota. */
export async function propiedadesDeNota(notaId: string): Promise<PropiedadDto[]> {
  return select<PropiedadDto>(
    "SELECT clave, valor, tipo, orden FROM propiedades WHERE nota_id = ? ORDER BY rowid",
    [notaId],
  );
}

/**
 * Claves usadas en el vault, ordenadas por frecuencia. Alimenta el
 * autocompletado del panel: es lo que evita que el mismo atributo termine como
 * `estado`, `Estado` y `status`.
 */
export async function clavesDelVault(vaultId: string): Promise<{ claves: string[] }> {
  const filas = await select<{ clave: string }>(
    `SELECT p.clave AS clave, COUNT(*) AS usos
     FROM propiedades p JOIN notas n ON n.id = p.nota_id
     WHERE n.vault_id = ? AND n.id NOT IN (SELECT nota_id FROM papelera)
     GROUP BY p.clave
     ORDER BY usos DESC, p.clave ASC`,
    [vaultId],
  );
  return { claves: filas.map((f) => f.clave) };
}

/** Notas que tienen una propiedad (opcionalmente con un valor concreto). */
export async function notasConPropiedad(
  vaultId: string,
  clave: string,
  valor?: string | null,
): Promise<{ notas: { id: string; titulo: string; valor: string }[] }> {
  const filtroValor = valor ? " AND p.valor = ? COLLATE NOCASE" : "";
  const params: (string | null)[] = valor ? [vaultId, clave, valor] : [vaultId, clave];
  const notas = await select<{ id: string; titulo: string; valor: string }>(
    `SELECT DISTINCT n.id, n.titulo, p.valor
     FROM propiedades p JOIN notas n ON n.id = p.nota_id
     WHERE n.vault_id = ? AND p.clave = ? COLLATE NOCASE${filtroValor}
       AND n.id NOT IN (SELECT nota_id FROM papelera)
     ORDER BY n.titulo`,
    params,
  );
  return { notas };
}

/**
 * Completa `clave_plegada` y `valor_plegado` de las filas que no las tienen
 * (`DEF-144`): las de un índice creado antes de esas columnas, que el
 * `ALTER TABLE` deja en NULL. Sin esto, un filtro `clave:valor` no encontraría
 * nada en un vault ya indexado hasta que cada nota se volviera a guardar.
 *
 * Es una migración de los datos que YA están en el índice, no un reindexado:
 * no relee archivos. Se pliega en JS (ver `plegar`) y se escribe con un
 * `UPDATE … FROM json_each(?)` por tanda. Idempotente: en un índice al día, el
 * `SELECT` no devuelve nada y no se escribe.
 */
export async function plegarPropiedadesPendientes(): Promise<void> {
  const pendientes = await select<{ id: number; clave: string; valor: string }>(
    "SELECT rowid AS id, clave, valor FROM propiedades WHERE clave_plegada IS NULL OR valor_plegado IS NULL",
  );
  const TANDA = 2000;
  for (let i = 0; i < pendientes.length; i += TANDA) {
    const tanda = pendientes
      .slice(i, i + TANDA)
      .map((f) => ({ r: f.id, cp: plegar(f.clave), vp: plegar(f.valor) }));
    await execute(
      `UPDATE propiedades
          SET clave_plegada = json_extract(j.value, '$.cp'),
              valor_plegado = json_extract(j.value, '$.vp')
         FROM json_each(?) AS j
        WHERE propiedades.rowid = json_extract(j.value, '$.r')`,
      [JSON.stringify(tanda)],
    );
  }
}
