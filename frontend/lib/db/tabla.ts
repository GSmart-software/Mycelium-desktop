/**
 * Datos que consume una base (`FUN-L-03`): una fila por nota del vault con todo
 * lo que el evaluador de `lib/bases.ts` necesita para decidir si entra y qué
 * mostrar. Portado a `GET /vaults/{id}/tabla`.
 *
 * Es la **única** pieza de las bases que se implementa dos veces (acá contra
 * SQLite local, y en web contra D1 + blobs). El parser y el evaluador viven en
 * `lib/bases.ts`, que es puro y compartido: duplicar un intérprete entre TS y C#
 * y mantenerlos sincronizados es exactamente lo que se quiso evitar — ya costó
 * caro con el frontmatter (ver `docs/estado/Version 1.1.0 de web.md`).
 */
import { etiquetasDe } from "@/lib/frontmatter";
import type { NotaTabla, PropiedadFila } from "@/lib/bases";
import { select } from "./client";
import { extDe } from "./vaultFs";

type RowNota = {
  id: string;
  titulo: string;
  carpeta_id: string | null;
  tamano_bytes: number;
  creado_en: string;
  actualizado_en: string;
  contenido: string | null;
};

type RowProp = { nota_id: string; clave: string; valor: string; tipo: string };

/**
 * Todas las notas markdown del vault, con sus propiedades y etiquetas.
 *
 * Se excluye lo que está en la papelera (una nota borrada no debe seguir
 * apareciendo en una tabla) y lo que no es markdown: una base que se agregara a
 * sí misma sería, además de inútil, confusa.
 */
export async function notasParaTabla(vaultId: string): Promise<{ notas: NotaTabla[] }> {
  const filas = await select<RowNota>(
    `SELECT n.id, n.titulo, n.carpeta_id, n.tamano_bytes, n.creado_en, n.actualizado_en,
            c.contenido AS contenido
       FROM notas n
       LEFT JOIN contenidos c ON c.nota_id = n.id
      WHERE n.vault_id = ?
        AND n.tipo = 'markdown'
        AND n.id NOT IN (SELECT nota_id FROM papelera)`,
    [vaultId],
  );

  const props = await select<RowProp>(
    `SELECT p.nota_id, p.clave, p.valor, p.tipo
       FROM propiedades p JOIN notas n ON n.id = p.nota_id
      WHERE n.vault_id = ?
      ORDER BY p.rowid`,
    [vaultId],
  );

  const porNota = new Map<string, PropiedadFila[]>();
  for (const p of props) {
    const lista = porNota.get(p.nota_id);
    const fila = { clave: p.clave, valor: p.valor, tipo: p.tipo };
    if (lista) lista.push(fila);
    else porNota.set(p.nota_id, [fila]);
  }

  const notas = filas.map<NotaTabla>((f) => ({
    id: f.id,
    nombre: f.titulo,
    // En modo carpeta el id ES la ruta relativa; en modo SQLite clásico no hay
    // ruta, así que se compone una equivalente para que `file.path` diga algo.
    ruta: f.carpeta_id ? `${f.carpeta_id}/${f.titulo}` : f.titulo,
    carpeta: f.carpeta_id ?? "",
    ext: (extDe(f.id) || ".md").slice(1),
    ctime: f.creado_en,
    mtime: f.actualizado_en,
    size: f.tamano_bytes,
    // Las mismas etiquetas que ve el grafo: las de `tags:` del frontmatter más
    // los `#tag` del cuerpo, sin distinguir de dónde salieron.
    tags: f.contenido ? etiquetasDe(f.contenido) : [],
    props: porNota.get(f.id) ?? [],
  }));

  return { notas };
}
