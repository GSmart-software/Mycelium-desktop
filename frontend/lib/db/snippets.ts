/**
 * Snippets de CSS personalizado del usuario (HU-13/15). CRUD sobre `css_snippets`.
 * Portado del backend (Auth feature) a la tabla local.
 */
import { execute, select } from "./client";
import { ensureSeed } from "./auth";
import type { CssSnippetDto, RowCssSnippet, SnippetsResponse } from "./types";

async function usuarioId(): Promise<string> {
  await ensureSeed();
  const rows = await select<{ id: string }>("SELECT id FROM usuarios LIMIT 1");
  return rows[0].id;
}

function toDto(r: RowCssSnippet): CssSnippetDto {
  return { id: r.id, nombre: r.nombre, activo: r.activo === 1, contenido: r.contenido };
}

/** `GET /auth/css/snippets`. */
export async function listarSnippets(): Promise<SnippetsResponse> {
  const uid = await usuarioId();
  const rows = await select<RowCssSnippet>(
    "SELECT id, usuario_id, nombre, activo, contenido, creado_en FROM css_snippets WHERE usuario_id = ? ORDER BY creado_en",
    [uid],
  );
  return { snippets: rows.map(toDto) };
}

/** `POST /auth/css/snippets`. */
export async function crearSnippet(nombre: string, contenido: string): Promise<CssSnippetDto> {
  const uid = await usuarioId();
  const id = crypto.randomUUID();
  await execute(
    "INSERT INTO css_snippets (id, usuario_id, nombre, activo, contenido, creado_en) VALUES (?, ?, ?, 1, ?, ?)",
    [id, uid, nombre, contenido, new Date().toISOString()],
  );
  return { id, nombre, activo: true, contenido };
}

/** `PATCH /auth/css/snippets/{id}` (activo / contenido / nombre, parcial). */
export async function actualizarSnippet(
  id: string,
  campos: { activo?: boolean; contenido?: string; nombre?: string },
): Promise<{ ok: true }> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (campos.nombre !== undefined) {
    sets.push("nombre = ?");
    params.push(campos.nombre);
  }
  if (campos.contenido !== undefined) {
    sets.push("contenido = ?");
    params.push(campos.contenido);
  }
  if (campos.activo !== undefined) {
    sets.push("activo = ?");
    params.push(campos.activo ? 1 : 0);
  }
  if (sets.length === 0) return { ok: true };
  params.push(id);
  await execute(`UPDATE css_snippets SET ${sets.join(", ")} WHERE id = ?`, params);
  return { ok: true };
}

/** `DELETE /auth/css/snippets/{id}`. */
export async function borrarSnippet(id: string): Promise<{ ok: true }> {
  await execute("DELETE FROM css_snippets WHERE id = ?", [id]);
  return { ok: true };
}
