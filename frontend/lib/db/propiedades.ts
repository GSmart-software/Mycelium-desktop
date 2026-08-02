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
import { cuerpoDe, separarFrontmatter, type Propiedad } from "@/lib/frontmatter";
import { execute, select } from "./client";

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
 * Texto que va al índice FTS: el CUERPO más los VALORES de las propiedades, sin
 * las claves ni la sintaxis YAML. Con esto buscar «activo» sigue encontrando la
 * nota, pero buscar «tags» deja de devolver todas las notas que tienen esa
 * clave — y los `snippet()` dejan de mostrar YAML.
 */
export function textoIndexable(texto: string): string {
  const fm = separarFrontmatter(texto);
  const cuerpo = cuerpoDe(texto, fm);
  if (!fm.hay || !fm.soportado || fm.props.length === 0) return cuerpo;
  const valores = fm.props.flatMap(valoresDe).filter((v) => v.length > 0);
  return valores.length === 0 ? cuerpo : `${valores.join(" ")}\n${cuerpo}`;
}

/**
 * Reescribe las propiedades de una nota en el índice (delete + insert, como el
 * reindex de FTS). Se llama desde los DOS caminos que reindexan: `putContenido`
 * y el indexado del vault.
 */
export async function reindexarPropiedades(notaId: string, texto: string): Promise<void> {
  await execute("DELETE FROM propiedades WHERE nota_id = ?", [notaId]);
  const fm = separarFrontmatter(texto);
  if (!fm.hay || !fm.soportado) return;
  for (const p of fm.props) {
    const valores = valoresDe(p);
    for (let i = 0; i < valores.length; i++) {
      await execute(
        "INSERT INTO propiedades (nota_id, clave, valor, tipo, orden) VALUES (?, ?, ?, ?, ?)",
        [notaId, p.clave, valores[i], p.tipo, i],
      );
    }
  }
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
