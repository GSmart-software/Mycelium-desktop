/**
 * Árbol del explorer (`GET /vaults/{id}/tree`) y carpetas compartidas.
 * Portado de `VaultRepository.GetTreeAsync`.
 */
import { select } from "./client";
import type { CarpetasCompartidasResponse, TreeResponse } from "./types";

/** Carpetas + notas (excluyendo papelera) de un vault, para el explorer. */
export async function tree(vaultId: string): Promise<TreeResponse> {
  const carpetas = await select<{ id: string; padre_id: string | null; nombre: string }>(
    "SELECT id, padre_id, nombre FROM carpetas WHERE vault_id = ? ORDER BY nombre COLLATE NOCASE",
    [vaultId],
  );
  const notas = await select<{
    id: string;
    carpeta_id: string | null;
    titulo: string;
    tipo: string;
    actualizado_en: string;
  }>(
    `SELECT id, carpeta_id, titulo, tipo, actualizado_en FROM notas
     WHERE vault_id = ? AND id NOT IN (SELECT nota_id FROM papelera)
     ORDER BY titulo COLLATE NOCASE`,
    [vaultId],
  );
  return { carpetas, notas };
}

/**
 * Ids de carpetas con membresías compartidas (para marcarlas en el árbol,
 * HU-35 CA5). En local el sharing está latente → siempre vacío.
 */
export async function carpetasCompartidas(_vaultId: string): Promise<CarpetasCompartidasResponse> {
  return { ids: [] };
}
