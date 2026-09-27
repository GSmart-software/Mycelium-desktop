/**
 * Grafo de wikilinks del vault (HU-30): grafo global y conexiones de una nota.
 * Portado de `SearchEndpoints.BuildVaultGraphAsync/ContarConexiones/FragmentAround`.
 *
 * Lee las tablas `enlaces` y `etiquetas` del índice (`FUN-L-25`, `DEF-109`), que
 * el indexador y el guardado llenan con lo que sale del texto
 * (`lib/enlacesNota.ts`) ya resuelto (`lib/db/enlacesIndice.ts`). Hasta
 * entonces, cada consulta leía el contenido de TODO el vault y lo escaneaba:
 * ≈300 ms en la Tesina (1.306 notas) por cada apertura del grafo, cada guardado
 * que refrescaba la barra de estado y cada panel de conexiones. Ahora el grafo
 * no lee contenido, y las conexiones leen solo el de las notas que citan a la
 * nota (para el fragmento de contexto).
 *
 * > [!info] Qué es una arista
 * > Un par `(desde, destino)` distinto, con el destino resuelto, sin lazos (una
 * > nota que se enlaza a sí misma) y sin notas de la papelera en ninguna punta.
 * > Es exactamente lo que armaba el escaneo. El filtro de la papelera se aplica
 * > al leer además de al resolver, para que una fila vieja no dibuje una arista
 * > hacia una nota borrada.
 */
import { select } from "./client";
import { DbError } from "./errors";

export type GraphNodeDto = {
  id: string;
  titulo: string;
  conexiones: number;
  tags?: string[];
  creadoEn?: string;
};
export type GraphEdgeDto = { source: string; target: string };
export type GraphDataDto = { nodos: GraphNodeDto[]; aristas: GraphEdgeDto[] };

/** Las filas de `enlaces` que son aristas (ver la cabecera), sobre el alias `e`. */
const ES_ARISTA = `e.destino_id IS NOT NULL AND e.desde_id <> e.destino_id
  AND e.desde_id NOT IN (SELECT nota_id FROM papelera)
  AND e.destino_id NOT IN (SELECT nota_id FROM papelera)`;

/** Tipos que no tienen prosa de la que sacar un fragmento (`lib/enlacesNota.ts`). */
const NO_ES_PROSA = new Set(["base", "canvas", "drawio"]);

/** Grado total (entrante + saliente) por nodo (HU-30 CA3). */
function contarConexiones(aristas: GraphEdgeDto[]): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const { source, target } of aristas) {
    conteo.set(source, (conteo.get(source) ?? 0) + 1);
    conteo.set(target, (conteo.get(target) ?? 0) + 1);
  }
  return conteo;
}

/** Fragmento de contexto alrededor del [[enlace]] (HU-30 CA7). */
function fragmentAround(contenido: string, titulo: string): string {
  const index = contenido.toLowerCase().indexOf(`[[${titulo.toLowerCase()}`);
  if (index < 0) return "";
  const start = Math.max(0, index - 40);
  const end = Math.min(contenido.length, index + titulo.length + 44);
  const fragment = contenido.slice(start, end).replace(/\n/g, " ").trim();
  return (start > 0 ? "…" : "") + fragment + (end < contenido.length ? "…" : "");
}

/** `GET /vaults/{id}/grafo`: tres `SELECT`, ninguno de contenido. */
export async function grafo(vaultId: string): Promise<GraphDataDto> {
  const notas = await select<{ id: string; titulo: string; creado_en: string }>(
    `SELECT id, titulo, creado_en FROM notas
     WHERE vault_id = ? AND id NOT IN (SELECT nota_id FROM papelera)`,
    [vaultId],
  );
  const aristas = await select<GraphEdgeDto>(
    `SELECT DISTINCT e.desde_id AS source, e.destino_id AS target FROM enlaces e WHERE ${ES_ARISTA}`,
  );
  // Etiquetas = las de `tags:` del frontmatter MÁS los `#tag` del cuerpo
  // (FUN-M-04): los grupos de color por etiqueta ven las dos fuentes. En el
  // orden en que salen del texto, que es el de inserción.
  const tagsPorNota = new Map<string, string[]>();
  const filasTags = await select<{ nota_id: string; tag: string }>(
    "SELECT nota_id, tag FROM etiquetas ORDER BY rowid",
  );
  for (const { nota_id, tag } of filasTags) {
    const lista = tagsPorNota.get(nota_id);
    if (lista) lista.push(tag);
    else tagsPorNota.set(nota_id, [tag]);
  }

  const conexionesTotales = contarConexiones(aristas);
  const nodos: GraphNodeDto[] = notas.map((n) => ({
    id: n.id,
    titulo: n.titulo,
    conexiones: conexionesTotales.get(n.id) ?? 0,
    tags: tagsPorNota.get(n.id) ?? [],
    creadoEn: n.creado_en,
  }));
  return { nodos, aristas };
}

/**
 * `GET /notas/{id}/conexiones` — salientes, retroenlaces y mini-grafo de 1 salto.
 * Consultas sobre `enlaces`/`notas` por índice, y una de contenido: solo el de
 * las notas que citan a esta, para el fragmento de contexto de cada retroenlace.
 */
export async function conexiones(notaId: string): Promise<unknown> {
  const nota = await select<{
    id: string;
    vault_id: string;
    titulo: string;
    carpeta_id: string | null;
    creado_en: string;
    actualizado_en: string;
    tamano_bytes: number;
  }>(
    "SELECT id, vault_id, titulo, carpeta_id, creado_en, actualizado_en, tamano_bytes FROM notas WHERE id = ?",
    [notaId],
  );
  if (nota.length === 0) throw new DbError(404, "La nota no existe.");
  const n = nota[0];

  // En el orden en que aparecen en el texto (el de inserción de las filas).
  const salientes = await select<{ id: string; titulo: string }>(
    `SELECT e.destino_id AS id, d.titulo AS titulo
     FROM enlaces e JOIN notas d ON d.id = e.destino_id
     WHERE e.desde_id = ? AND ${ES_ARISTA}
     GROUP BY e.destino_id ORDER BY MIN(e.rowid)`,
    [notaId],
  );
  // En el orden que tenía el escaneo: primero los canvas, después el resto,
  // cada grupo en el orden de `notas`.
  const citantes = await select<{ id: string; titulo: string; tipo: string }>(
    `SELECT e.desde_id AS id, o.titulo AS titulo, o.tipo AS tipo
     FROM enlaces e JOIN notas o ON o.id = e.desde_id
     WHERE e.destino_id = ? AND ${ES_ARISTA}
     GROUP BY e.desde_id ORDER BY o.tipo = 'canvas' DESC, MIN(o.rowid)`,
    [notaId],
  );

  // El fragmento sale del texto de quien cita, así que solo se lee ESE
  // contenido. Un canvas, una base o un `.drawio` no tienen prosa: sin fragmento.
  const conProsa = citantes.filter((c) => !NO_ES_PROSA.has(c.tipo)).map((c) => c.id);
  const contenidos = new Map<string, string>();
  if (conProsa.length > 0) {
    const filas = await select<{ nota_id: string; contenido: string }>(
      "SELECT nota_id, contenido FROM contenidos WHERE nota_id IN (SELECT value FROM json_each(?))",
      [JSON.stringify(conProsa)],
    );
    for (const f of filas) contenidos.set(f.nota_id, f.contenido);
  }
  const retro = citantes.map((c) => ({
    id: c.id,
    titulo: c.titulo,
    fragmento: fragmentAround(contenidos.get(c.id) ?? "", n.titulo),
  }));

  // Mini-grafo: la nota y sus vecinos, cada uno con su grado en el grafo
  // entero (lo que dimensiona el nodo), y las aristas que tocan a la nota.
  const titulos = new Map<string, string>([[notaId, n.titulo]]);
  for (const s of salientes) titulos.set(s.id, s.titulo);
  for (const r of retro) titulos.set(r.id, r.titulo);
  const ids = [...titulos.keys()];
  // El grado de cada uno se cuenta en SQL —aristas salientes distintas más
  // entrantes distintas— y vuelve una fila por nodo: el vecindario de una nota
  // muy citada es buena parte del grafo, y traer sus pares (2.274 en la nota
  // más conectada de la Tesina) para contarlos en JS costaba más que contarlos.
  const idsJson = JSON.stringify(ids);
  const grados = await select<{ id: string; n: number }>(
    `SELECT id, COUNT(*) AS n FROM (
       SELECT DISTINCT e.desde_id AS id, e.destino_id AS otro FROM enlaces e
       WHERE e.desde_id IN (SELECT value FROM json_each(?)) AND ${ES_ARISTA}
       UNION ALL
       SELECT DISTINCT e.destino_id, e.desde_id FROM enlaces e
       WHERE e.destino_id IN (SELECT value FROM json_each(?)) AND ${ES_ARISTA}
     ) GROUP BY id`,
    [idsJson, idsJson],
  );
  const grado = new Map(grados.map((g) => [g.id, Number(g.n)]));
  const nodos = ids.map((id) => ({
    id,
    titulo: titulos.get(id) ?? "?",
    conexiones: grado.get(id) ?? 0,
  }));
  const aristasVecinas = [
    ...salientes.map((s) => ({ source: notaId, target: s.id })),
    ...retro.map((r) => ({ source: r.id, target: notaId })),
  ];

  return {
    nota: {
      id: n.id,
      titulo: n.titulo,
      carpetaId: n.carpeta_id,
      creadoEn: n.creado_en,
      actualizadoEn: n.actualizado_en,
      tamanoBytes: n.tamano_bytes,
    },
    salientes,
    retro,
    grafo: { nodos, aristas: aristasVecinas },
  };
}
