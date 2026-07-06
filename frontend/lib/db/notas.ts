/**
 * CRUD de notas (HU-23). Portado de `VaultRepository` + orquestación de
 * `VaultEndpoints` (sufijo único al crear/duplicar, chequeo de mismo vault al mover,
 * copia de contenido al duplicar).
 */
import { execute, select } from "./client";
import { DbError } from "./errors";
import type { CreatedResponse, NotaTipo } from "./types";
import { ahoraIso, nuevoId, tituloUnico } from "./util";

async function vaultIdOfNota(notaId: string): Promise<string | null> {
  const rows = await select<{ vault_id: string }>("SELECT vault_id FROM notas WHERE id = ?", [
    notaId,
  ]);
  return rows.length > 0 ? rows[0].vault_id : null;
}

async function vaultIdOfCarpeta(carpetaId: string): Promise<string | null> {
  const rows = await select<{ vault_id: string }>("SELECT vault_id FROM carpetas WHERE id = ?", [
    carpetaId,
  ]);
  return rows.length > 0 ? rows[0].vault_id : null;
}

/** Títulos de notas (no en papelera) hermanas, para el sufijo único. */
async function titulosEnCarpeta(vaultId: string, carpetaId: string | null): Promise<string[]> {
  const rows =
    carpetaId === null
      ? await select<{ titulo: string }>(
          "SELECT titulo FROM notas WHERE vault_id = ? AND carpeta_id IS NULL AND id NOT IN (SELECT nota_id FROM papelera)",
          [vaultId],
        )
      : await select<{ titulo: string }>(
          "SELECT titulo FROM notas WHERE vault_id = ? AND carpeta_id = ? AND id NOT IN (SELECT nota_id FROM papelera)",
          [vaultId, carpetaId],
        );
  return rows.map((r) => r.titulo);
}

/** `POST /vaults/{id}/notas`. */
export async function crearNota(
  vaultId: string,
  carpetaId: string | null,
  titulo?: string | null,
  tipo?: string | null,
): Promise<CreatedResponse> {
  const t: NotaTipo = tipo === "excalidraw" ? "excalidraw" : "markdown";
  const defecto = t === "excalidraw" ? "Dibujo sin título" : "Sin título";
  const base = titulo && titulo.trim().length > 0 ? titulo.trim() : defecto;
  const unico = tituloUnico(base, await titulosEnCarpeta(vaultId, carpetaId));

  const id = nuevoId();
  const now = ahoraIso();
  await execute(
    "INSERT INTO notas (id, vault_id, carpeta_id, titulo, tipo, tamano_bytes, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
    [id, vaultId, carpetaId, unico, t, now, now],
  );
  return { id };
}

/** `PATCH /notas/{id}` (renombrar). No reindexa FTS: el contenido no cambió. */
export async function renombrarNota(id: string, titulo: string): Promise<void> {
  const limpio = titulo.trim();
  if (limpio.length === 0) throw new DbError(400, "El título no puede estar vacío.");
  await execute("UPDATE notas SET titulo = ?, actualizado_en = ? WHERE id = ?", [
    limpio,
    ahoraIso(),
    id,
  ]);
  // Mantener el título del índice FTS en sincronía si la nota ya está indexada.
  await execute("UPDATE notas_fts SET titulo = ? WHERE nota_id = ?", [limpio, id]);
}

/** `POST /notas/{id}/mover`. Valida mismo vault. */
export async function moverNota(id: string, destinoId: string | null): Promise<void> {
  if (destinoId !== null) {
    const [vaultDestino, vaultNota] = await Promise.all([
      vaultIdOfCarpeta(destinoId),
      vaultIdOfNota(id),
    ]);
    if (vaultDestino !== vaultNota) {
      throw new DbError(400, "El destino no pertenece al mismo vault.");
    }
  }
  await execute("UPDATE notas SET carpeta_id = ?, actualizado_en = ? WHERE id = ?", [
    destinoId,
    ahoraIso(),
    id,
  ]);
}

/** `POST /notas/{id}/duplicar`: copia nota + contenido + diagramas con título único. */
export async function duplicarNota(id: string): Promise<CreatedResponse> {
  const rows = await select<{
    vault_id: string;
    carpeta_id: string | null;
    titulo: string;
    tipo: string;
    tamano_bytes: number;
  }>("SELECT vault_id, carpeta_id, titulo, tipo, tamano_bytes FROM notas WHERE id = ?", [id]);
  if (rows.length === 0) throw new DbError(404, "La nota no existe.");
  const nota = rows[0];

  const titulo = tituloUnico(
    nota.titulo,
    await titulosEnCarpeta(nota.vault_id, nota.carpeta_id),
  );
  const nuevo = nuevoId();
  const now = ahoraIso();
  await execute(
    "INSERT INTO notas (id, vault_id, carpeta_id, titulo, tipo, tamano_bytes, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [nuevo, nota.vault_id, nota.carpeta_id, titulo, nota.tipo, nota.tamano_bytes, now, now],
  );

  // Copia del contenido (si existe) y reindex FTS de la copia.
  const cont = await select<{ contenido: string }>(
    "SELECT contenido FROM contenidos WHERE nota_id = ?",
    [id],
  );
  if (cont.length > 0) {
    await execute("INSERT INTO contenidos (nota_id, contenido, actualizado_en) VALUES (?, ?, ?)", [
      nuevo,
      cont[0].contenido,
      now,
    ]);
    await execute("INSERT INTO notas_fts (nota_id, titulo, contenido) VALUES (?, ?, ?)", [
      nuevo,
      titulo,
      cont[0].contenido,
    ]);
  }

  // Copia de diagramas excalidraw embebidos.
  const diags = await select<{ diag_id: string; contenido: string }>(
    "SELECT diag_id, contenido FROM diagramas WHERE nota_id = ?",
    [id],
  );
  for (const d of diags) {
    await execute(
      "INSERT INTO diagramas (nota_id, diag_id, contenido, actualizado_en) VALUES (?, ?, ?, ?)",
      [nuevo, d.diag_id, d.contenido, now],
    );
  }

  return { id: nuevo };
}
