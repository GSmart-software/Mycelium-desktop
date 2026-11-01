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

/** Una nota del índice, lo mínimo para resolver y agrupar. */
export type NotaIndice = { id: string; titulo: string; carpetaId: string | null; tipo: string };
/** Una carpeta, con la forma de `CarpetaEnlazable`. */
export type CarpetaIndice = { id: string; nombre: string; padreId: string | null };
/** Una fila de `enlaces`: qué se escribió, en qué nota, y a qué resolvió. */
export type FilaIndice = { desde: string; texto: string; tipo: string; destino: string | null; n: number };

/** Notas que no están en la papelera. Sin contenido. */
export async function notasDelIndice(): Promise<NotaIndice[]> {
  const filas = await select<{ id: string; titulo: string; carpeta_id: string | null; tipo: string }>(
    "SELECT id, titulo, carpeta_id, tipo FROM notas WHERE id NOT IN (SELECT nota_id FROM papelera) ORDER BY id",
  );
  return filas.map((n) => ({ id: n.id, titulo: n.titulo, carpetaId: n.carpeta_id, tipo: n.tipo }));
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
