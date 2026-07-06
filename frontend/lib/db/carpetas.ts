/**
 * CRUD de carpetas (HU-22/24). Portado de `VaultRepository` + la orquestación de
 * `VaultEndpoints` (anti-ciclo al mover, borrado recursivo con notas a papelera).
 */
import { execute, select } from "./client";
import { DbError } from "./errors";
import type { CreatedResponse } from "./types";
import { ahoraIso, buildRutaLookup, nuevoId, rutaDe } from "./util";

/** Ids de la carpeta y todas sus descendientes (CTE recursiva). */
async function subtreeIds(carpetaId: string): Promise<string[]> {
  const rows = await select<{ id: string }>(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM carpetas WHERE id = ?
       UNION ALL
       SELECT c.id FROM carpetas c JOIN sub s ON c.padre_id = s.id
     )
     SELECT id FROM sub`,
    [carpetaId],
  );
  return rows.map((r) => r.id);
}

async function vaultIdOfCarpeta(carpetaId: string): Promise<string | null> {
  const rows = await select<{ vault_id: string }>(
    "SELECT vault_id FROM carpetas WHERE id = ?",
    [carpetaId],
  );
  return rows.length > 0 ? rows[0].vault_id : null;
}

/** `POST /vaults/{id}/carpetas`. Sin sufijo único (paridad con el backend). */
export async function crearCarpeta(
  vaultId: string,
  padreId: string | null,
  nombre: string,
): Promise<CreatedResponse> {
  const limpio = nombre.trim();
  if (limpio.length === 0) throw new DbError(400, "El nombre no puede estar vacío.");
  const id = nuevoId();
  const now = ahoraIso();
  await execute(
    "INSERT INTO carpetas (id, vault_id, padre_id, nombre, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?)",
    [id, vaultId, padreId, limpio, now, now],
  );
  return { id };
}

/** `PATCH /carpetas/{id}` (renombrar). */
export async function renombrarCarpeta(id: string, nombre: string): Promise<void> {
  const limpio = nombre.trim();
  if (limpio.length === 0) throw new DbError(400, "El nombre no puede estar vacío.");
  await execute("UPDATE carpetas SET nombre = ?, actualizado_en = ? WHERE id = ?", [
    limpio,
    ahoraIso(),
    id,
  ]);
}

/** `POST /carpetas/{id}/mover`. Valida anti-ciclo y mismo vault. */
export async function moverCarpeta(id: string, destinoId: string | null): Promise<void> {
  if (destinoId !== null) {
    const subtree = await subtreeIds(id);
    if (subtree.includes(destinoId)) {
      throw new DbError(400, "No se puede mover una carpeta dentro de sí misma ni de sus hijos.");
    }
    const [vaultDestino, vaultOrigen] = await Promise.all([
      vaultIdOfCarpeta(destinoId),
      vaultIdOfCarpeta(id),
    ]);
    if (vaultDestino !== vaultOrigen) {
      throw new DbError(400, "El destino no pertenece al mismo vault.");
    }
  }
  await execute("UPDATE carpetas SET padre_id = ?, actualizado_en = ? WHERE id = ?", [
    destinoId,
    ahoraIso(),
    id,
  ]);
}

/**
 * `DELETE /carpetas/{id}`: las notas del subárbol (no ya en papelera) van a la
 * papelera con su ruta original; el subárbol de carpetas se borra en cascada.
 */
export async function borrarCarpeta(id: string): Promise<void> {
  const vaultId = await vaultIdOfCarpeta(id);
  if (vaultId === null) throw new DbError(404, "La carpeta no existe.");

  const subtree = await subtreeIds(id);
  const placeholders = subtree.map(() => "?").join(", ");
  const notas =
    subtree.length === 0
      ? []
      : await select<{ id: string; carpeta_id: string | null }>(
          `SELECT id, carpeta_id FROM notas
           WHERE carpeta_id IN (${placeholders}) AND id NOT IN (SELECT nota_id FROM papelera)`,
          subtree,
        );

  const todas = await select<{ id: string; padre_id: string | null; nombre: string }>(
    "SELECT id, padre_id, nombre FROM carpetas WHERE vault_id = ?",
    [vaultId],
  );
  const rutas = buildRutaLookup(todas);

  const now = ahoraIso();
  for (const n of notas) {
    await execute(
      "INSERT OR IGNORE INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en) VALUES (?, ?, ?, ?, ?)",
      [nuevoId(), n.id, rutaDe(rutas, n.carpeta_id), n.carpeta_id, now],
    );
  }
  // ON DELETE CASCADE borra las carpetas hijas; las notas quedan (carpeta_id → NULL)
  // pero ya están en papelera, así que el árbol no las muestra.
  await execute("DELETE FROM carpetas WHERE id = ?", [id]);
}
