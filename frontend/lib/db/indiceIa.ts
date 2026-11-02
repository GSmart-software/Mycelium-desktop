/**
 * Lecturas del índice para la salud del vault (`FUN-L-30`) y para las
 * consultas del MCP (`FUN-M-45`): las notas, las carpetas y las filas de
 * `enlaces` **tal como las resolvió el indexador**. Solo desktop.
 *
 * > [!important] No se resuelve nada de nuevo acá
 * > `destino_id` lo calculó el indexador con el resolutor único
 * > (`lib/enlacesNota.ts` → `resolveWikilinkEnIndice`), y lo mantiene al día la
 * > re-resolución dirigida (`reResolverTitulos`). Leerlo en vez de recalcularlo
 * > es lo que garantiza «el mismo criterio que el índice»: lo que cambie en el
 * > resolutor (por ejemplo los alias de `FUN-M-15`) llega solo.
 *
 * Todo excluye la papelera, como el grafo (`lib/db/grafo.ts`).
 */
import { select } from "./client";
import { aliasesPorNota } from "./propiedades";

/** Una nota del índice, lo mínimo para resolver y agrupar. */
export type NotaIndice = {
  id: string;
  titulo: string;
  carpetaId: string | null;
  tipo: string;
  /** Sus otros nombres (`FUN-M-15`): con ellos la salud ve también los alias repetidos. */
  aliases?: string[];
};
/** Una carpeta, con la forma de `CarpetaEnlazable`. */
export type CarpetaIndice = { id: string; nombre: string; padreId: string | null };
/** Una fila de `enlaces`: qué se escribió, en qué nota, y a qué resolvió. */
export type FilaIndice = { desde: string; texto: string; tipo: string; destino: string | null; n: number };

/** Notas que no están en la papelera. Sin contenido. */
export async function notasDelIndice(): Promise<NotaIndice[]> {
  const filas = await select<{ id: string; titulo: string; carpeta_id: string | null; tipo: string }>(
    "SELECT id, titulo, carpeta_id, tipo FROM notas WHERE id NOT IN (SELECT nota_id FROM papelera) ORDER BY id",
  );
  const aliases = await aliasesPorNota(null);
  return filas.map((n) => ({
    id: n.id,
    titulo: n.titulo,
    carpetaId: n.carpeta_id,
    tipo: n.tipo,
    aliases: aliases.get(n.id),
  }));
}

export async function carpetasDelIndice(): Promise<CarpetaIndice[]> {
  const filas = await select<{ id: string; nombre: string; padre_id: string | null }>(
    "SELECT id, nombre, padre_id FROM carpetas",
  );
  return filas.map((c) => ({ id: c.id, nombre: c.nombre, padreId: c.padre_id }));
}

/**
 * Filas de `enlaces` de las notas que no están en la papelera, en el orden en
 * que aparecen en cada nota (el de inserción). Un destino en la papelera cuenta
 * como sin destino: el resolutor ya no lo elige, pero una fila vieja podría
 * tenerlo todavía.
 */
export async function filasDelIndice(desde?: string): Promise<FilaIndice[]> {
  const filtro = desde === undefined ? "" : " AND e.desde_id = ?";
  const filas = await select<{ desde: string; texto: string; tipo: string; destino: string | null; n: number }>(
    `SELECT e.desde_id AS desde, e.destino_texto AS texto, e.tipo AS tipo,
            CASE WHEN e.destino_id IN (SELECT nota_id FROM papelera) THEN NULL ELSE e.destino_id END AS destino,
            e.n AS n
       FROM enlaces e
      WHERE e.desde_id NOT IN (SELECT nota_id FROM papelera)${filtro}
      ORDER BY e.rowid`,
    desde === undefined ? [] : [desde],
  );
  return filas.map((f) => ({ ...f, n: Number(f.n) || 1 }));
}

/** Filas que apuntan a `destino` desde otra nota (los backlinks), en orden de inserción. */
export async function filasHacia(destino: string): Promise<FilaIndice[]> {
  const filas = await select<{ desde: string; texto: string; tipo: string; destino: string; n: number }>(
    `SELECT e.desde_id AS desde, e.destino_texto AS texto, e.tipo AS tipo, e.destino_id AS destino, e.n AS n
       FROM enlaces e
      WHERE e.destino_id = ? AND e.desde_id <> e.destino_id
        AND e.desde_id NOT IN (SELECT nota_id FROM papelera)
      ORDER BY e.rowid`,
    [destino],
  );
  return filas.map((f) => ({ ...f, n: Number(f.n) || 1 }));
}

/** El contenido indexado de varias notas (las que no lo tienen, no vienen). */
export async function contenidosDe(ids: readonly string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;
  const filas = await select<{ nota_id: string; contenido: string | null }>(
    "SELECT nota_id, contenido FROM contenidos WHERE nota_id IN (SELECT value FROM json_each(?))",
    [JSON.stringify([...new Set(ids)])],
  );
  for (const f of filas) if (f.contenido !== null) mapa.set(f.nota_id, f.contenido);
  return mapa;
}

/**
 * Notas con alguna propiedad cuyo valor indexado empieza con `#` (fuera de
 * `tags`): las candidatas al aviso del `#` sin comillas (`FUN-M-46`). El índice
 * no distingue `"#24"` de `#24` —las comillas no se guardan—, así que esto solo
 * acota qué contenidos leer; el aviso lo decide el texto crudo.
 */
export async function notasConValorAlmohadilla(): Promise<string[]> {
  const filas = await select<{ nota_id: string }>(
    `SELECT DISTINCT nota_id FROM propiedades
     WHERE substr(valor, 1, 1) = '#' AND lower(clave) <> 'tags'
       AND nota_id NOT IN (SELECT nota_id FROM papelera)`,
  );
  return filas.map((f) => f.nota_id);
}

// ── Estadísticas del dashboard de salud (`FUN-L-32`) ────────────────────────

/**
 * `creado_en` de cada nota fuera de la papelera: el crecimiento por mes. Es la
 * fecha en que el índice vio la nota por primera vez, no la del archivo (ver
 * `Crecimiento.confiable` en `lib/estadisticas.ts`). Una sentencia, sin contenido.
 */
export async function fechasDeCreacion(): Promise<{ id: string; creadoEn: string }[]> {
  const filas = await select<{ id: string; creado_en: string }>(
    "SELECT id, creado_en FROM notas WHERE id NOT IN (SELECT nota_id FROM papelera)",
  );
  return filas.map((f) => ({ id: f.id, creadoEn: f.creado_en }));
}

/**
 * Las etiquetas, agregadas en SQLite en una sola sentencia: cuántas distintas
 * hay, cuántas notas tienen alguna y las `tope` más usadas. Distintas por
 * `tag_plegado` —sin mayúsculas ni tildes, el criterio de la búsqueda `tag:`
 * (`DEF-144`)—; se muestra la grafía más chica en orden binario de cada una.
 * Cada etiqueta cuenta notas distintas (una nota con `#x` en el cuerpo y en
 * `tags:` es una). `excluidas` son las notas fuera de la memoria (Esporas,
 * instrucciones de agentes): sus etiquetas no cuentan.
 *
 * En la Tesina (4.131 filas, 815 etiquetas) devuelve 8 filas en vez de 4.131.
 */
export async function etiquetasDelIndice(
  excluidas: readonly string[],
  tope: number,
): Promise<{ distintas: number; notasConEtiqueta: number; masUsadas: { etiqueta: string; notas: number }[] }> {
  const filtro = `nota_id NOT IN (SELECT nota_id FROM papelera) AND nota_id NOT IN (SELECT value FROM json_each(?))`;
  const filas = await select<{ etiqueta: string | null; notas: number | null; distintas: number; con_etiqueta: number }>(
    `SELECT t.etiqueta, t.notas, t.distintas,
            (SELECT COUNT(DISTINCT nota_id) FROM etiquetas WHERE ${filtro}) AS con_etiqueta
       FROM (SELECT 1) AS uno
       LEFT JOIN (
         SELECT MIN(tag) AS etiqueta, COUNT(DISTINCT nota_id) AS notas, COUNT(*) OVER () AS distintas
           FROM etiquetas WHERE ${filtro}
          GROUP BY tag_plegado
          ORDER BY notas DESC, etiqueta
          LIMIT ?
       ) AS t ON true`,
    // `?` posicionales (ver `client.ts`): el filtro aparece dos veces.
    [JSON.stringify(excluidas), JSON.stringify(excluidas), tope],
  );
  // El `LEFT JOIN` contra `(SELECT 1)` deja una fila aunque no haya etiquetas,
  // para que `con_etiqueta` llegue igual en la misma sentencia.
  const masUsadas = filas
    .filter((f) => f.etiqueta !== null)
    .map((f) => ({ etiqueta: f.etiqueta as string, notas: Number(f.notas) }));
  return {
    distintas: masUsadas.length > 0 ? Number(filas[0].distintas) : 0,
    notasConEtiqueta: Number(filas[0]?.con_etiqueta ?? 0),
    masUsadas,
  };
}
