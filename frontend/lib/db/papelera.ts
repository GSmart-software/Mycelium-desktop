/**
 * Papelera (HU-23 CA6–10). Portado de `VaultRepository` + `VaultEndpoints`:
 * enviar a papelera con ruta original, listar (con purga de expiradas), recuperar
 * (al directorio original o a la raíz si ya no existe) y borrar permanentemente.
 */
import { execute, select } from "./client";
import { DbError } from "./errors";
import type { PapeleraResponse } from "./types";
import { ahoraIso, buildRutaLookup, nuevoId, rutaDe } from "./util";

/** Días que una nota permanece en la papelera antes de purgarse (HU-23 CA7). */
const RETENCION_DIAS = 30;

/** `DELETE /notas/{id}` → papelera. */
export async function borrarNota(id: string): Promise<void> {
  const notas = await select<{ vault_id: string; carpeta_id: string | null }>(
    "SELECT vault_id, carpeta_id FROM notas WHERE id = ?",
    [id],
  );
  if (notas.length === 0) throw new DbError(404, "La nota no existe.");

  const yaEn = await select<{ nota_id: string }>(
    "SELECT nota_id FROM papelera WHERE nota_id = ?",
    [id],
  );
  if (yaEn.length > 0) throw new DbError(400, "La nota ya está en la papelera.");

  const { vault_id, carpeta_id } = notas[0];
  const carpetas = await select<{ id: string; padre_id: string | null; nombre: string }>(
    "SELECT id, padre_id, nombre FROM carpetas WHERE vault_id = ?",
    [vault_id],
  );
  const rutas = buildRutaLookup(carpetas);
  await execute(
    "INSERT INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en) VALUES (?, ?, ?, ?, ?)",
    [nuevoId(), id, rutaDe(rutas, carpeta_id), carpeta_id, ahoraIso()],
  );
}

/** `GET /vaults/{id}/papelera` (purga expiradas primero). */
export async function listarPapelera(vaultId: string): Promise<PapeleraResponse> {
  await purgarExpiradas(vaultId);
  const items = await select<{
    nota_id: string;
    titulo: string;
    ruta_original: string;
    eliminado_en: string;
  }>(
    `SELECT p.nota_id, n.titulo, p.ruta_original, p.eliminado_en
     FROM papelera p JOIN notas n ON n.id = p.nota_id
     WHERE n.vault_id = ?
     ORDER BY p.eliminado_en DESC`,
    [vaultId],
  );
  return { items };
}

/** `POST /notas/{id}/recuperar`. Restaura al directorio original o a la raíz (CA8). */
export async function recuperarNota(id: string): Promise<void> {
  const entry = await select<{ carpeta_original_id: string | null }>(
    "SELECT carpeta_original_id FROM papelera WHERE nota_id = ?",
    [id],
  );
  if (entry.length === 0) throw new DbError(404, "La nota no está en la papelera.");

  let carpetaOriginal = entry[0].carpeta_original_id;
  if (carpetaOriginal !== null) {
    const existe = await select<{ id: string }>("SELECT id FROM carpetas WHERE id = ?", [
      carpetaOriginal,
    ]);
    if (existe.length === 0) carpetaOriginal = null;
  }

  await execute("UPDATE notas SET carpeta_id = ?, actualizado_en = ? WHERE id = ?", [
    carpetaOriginal,
    ahoraIso(),
    id,
  ]);
  await execute("DELETE FROM papelera WHERE nota_id = ?", [id]);
}

/** `DELETE /notas/{id}/permanente`. */
export async function borrarPermanente(id: string): Promise<void> {
  const entry = await select<{ nota_id: string }>(
    "SELECT nota_id FROM papelera WHERE nota_id = ?",
    [id],
  );
  if (entry.length === 0) {
    throw new DbError(400, "Solo se pueden eliminar permanentemente notas en la papelera.");
  }
  await execute("DELETE FROM papelera WHERE nota_id = ?", [id]);
  await execute("DELETE FROM notas_fts WHERE nota_id = ?", [id]);
  // contenidos y diagramas se borran en cascada (FK ON DELETE CASCADE).
  await execute("DELETE FROM notas WHERE id = ?", [id]);
}

/** Purga permanente de notas con más de 30 días en la papelera (HU-23 CA7). */
export async function purgarExpiradas(vaultId: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - RETENCION_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const expiradas = await select<{ nota_id: string }>(
    `SELECT p.nota_id FROM papelera p JOIN notas n ON n.id = p.nota_id
     WHERE n.vault_id = ? AND p.eliminado_en < ?`,
    [vaultId, cutoff],
  );
  for (const { nota_id } of expiradas) {
    await borrarPermanente(nota_id);
  }
  return expiradas.map((e) => e.nota_id);
}
