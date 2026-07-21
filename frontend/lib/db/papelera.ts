/**
 * Papelera (HU-23 CA6–10). Portado de `VaultRepository` + `VaultEndpoints`:
 * enviar a papelera con ruta original, listar (con purga de expiradas), recuperar
 * (al directorio original o a la raíz si ya no existe) y borrar permanentemente.
 */
import { execute, select } from "./client";
import { DbError } from "./errors";
import type { PapeleraResponse } from "./types";
import { ahoraIso, buildRutaLookup, nuevoId, rutaDe } from "./util";
import { getVaultActual } from "./vaultContext";
import { basenameDe, borrarAPapelera, borrarDefinitivo, rekeyIndice, restaurarDePapelera, unir } from "./vaultFs";

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
  const now = ahoraIso();

  // Modo carpeta: mover el archivo a la papelera de disco (`.mycelium/.trash`) y
  // guardar en `ruta_papelera` dónde quedó para poder restaurarlo. La fila `notas`
  // del índice SE CONSERVA (con su id = ruta original) para poder recuperarla.
  const vault = getVaultActual();
  if (vault !== null) {
    const rutaPapelera = await borrarAPapelera(vault, id);
    await execute(
      "INSERT INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en, ruta_papelera) VALUES (?, ?, ?, ?, ?, ?)",
      [nuevoId(), id, rutaDe(rutas, carpeta_id), carpeta_id, now, rutaPapelera],
    );
    return;
  }

  await execute(
    "INSERT INTO papelera (id, nota_id, ruta_original, carpeta_original_id, eliminado_en) VALUES (?, ?, ?, ?, ?)",
    [nuevoId(), id, rutaDe(rutas, carpeta_id), carpeta_id, now],
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
  const vault = getVaultActual();
  // La columna `ruta_papelera` solo existe en el índice (modo carpeta); en clásico
  // no se selecciona para no romper contra el esquema de `mycelium.db`.
  const entry = await select<{ carpeta_original_id: string | null; ruta_papelera?: string | null }>(
    vault !== null
      ? "SELECT carpeta_original_id, ruta_papelera FROM papelera WHERE nota_id = ?"
      : "SELECT carpeta_original_id FROM papelera WHERE nota_id = ?",
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

  if (vault !== null) {
    // Reconstruir la ruta destino: carpeta original (si sigue existiendo) o raíz,
    // con el mismo nombre de archivo. Mover el archivo de la papelera de vuelta.
    const destino = unir(carpetaOriginal, basenameDe(id));
    if (entry[0].ruta_papelera) {
      await restaurarDePapelera(vault, entry[0].ruta_papelera, destino);
    }
    await execute("DELETE FROM papelera WHERE nota_id = ?", [id]);
    if (destino !== id) {
      // La carpeta original ya no existe → la nota se restaura en la raíz: su id
      // (=ruta) cambia, hay que recodificarla en el índice.
      const titulo = await select<{ titulo: string }>("SELECT titulo FROM notas WHERE id = ?", [id]);
      await rekeyIndice(
        [],
        [{ oldId: id, newId: destino, newCarpetaId: carpetaOriginal, newTitulo: titulo[0]?.titulo ?? basenameDe(destino) }],
      );
    } else {
      await execute("UPDATE notas SET carpeta_id = ?, actualizado_en = ? WHERE id = ?", [
        carpetaOriginal,
        ahoraIso(),
        id,
      ]);
    }
    return;
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
  const vault = getVaultActual();
  const entry = await select<{ ruta_papelera?: string | null }>(
    vault !== null
      ? "SELECT ruta_papelera FROM papelera WHERE nota_id = ?"
      : "SELECT nota_id FROM papelera WHERE nota_id = ?",
    [id],
  );
  if (entry.length === 0) {
    throw new DbError(400, "Solo se pueden eliminar permanentemente notas en la papelera.");
  }

  // Modo carpeta: borrar de disco el archivo que está en `.mycelium/.trash`.
  if (vault !== null && entry[0].ruta_papelera) {
    await borrarDefinitivo(vault, entry[0].ruta_papelera);
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
