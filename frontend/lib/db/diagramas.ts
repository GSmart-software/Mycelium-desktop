/**
 * Diagramas Excalidraw embebidos por nota (HU-16 CA4). Portado de
 * `NoteContentEndpoints.MapDiagramEndpoints`. En el modelo desktop la escena JSON
 * vive en la tabla `diagramas` (antes blob en disco). El `diagId` se sanea igual
 * que el backend para que lectura y escritura usen la misma clave.
 */
import { execute, select } from "./client";
import { DbError } from "./errors";

/** Solo letras/dígitos/`-`/`_` (equivale a `SanitizeId` del backend). */
function sanitizeId(id: string): string {
  return Array.from(id)
    .filter((c) => /[a-zA-Z0-9]/.test(c) || c === "-" || c === "_")
    .join("");
}

async function notaExiste(notaId: string): Promise<boolean> {
  const rows = await select<{ id: string }>("SELECT id FROM notas WHERE id = ?", [notaId]);
  return rows.length > 0;
}

/** `GET /notas/{notaId}/diagramas/{diagId}` → escena JSON (string cruda). */
export async function getDiagrama(notaId: string, diagId: string): Promise<string> {
  if (!(await notaExiste(notaId))) throw new DbError(404, "La nota no existe.");
  const rows = await select<{ contenido: string }>(
    "SELECT contenido FROM diagramas WHERE nota_id = ? AND diag_id = ?",
    [notaId, sanitizeId(diagId)],
  );
  if (rows.length === 0) throw new DbError(404, "El diagrama no existe.");
  return rows[0].contenido;
}

/** `PUT /notas/{notaId}/diagramas/{diagId}`: upsert de la escena. */
export async function putDiagrama(
  notaId: string,
  diagId: string,
  json: string,
): Promise<{ notaId: string; diagId: string }> {
  if (!(await notaExiste(notaId))) throw new DbError(404, "La nota no existe.");
  const clean = sanitizeId(diagId);
  await execute(
    `INSERT INTO diagramas (nota_id, diag_id, contenido, actualizado_en) VALUES (?, ?, ?, ?)
     ON CONFLICT(nota_id, diag_id) DO UPDATE SET contenido = excluded.contenido, actualizado_en = excluded.actualizado_en`,
    [notaId, clean, json, new Date().toISOString()],
  );
  return { notaId, diagId: clean };
}
