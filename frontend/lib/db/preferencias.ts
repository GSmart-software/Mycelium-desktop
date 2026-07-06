/**
 * Preferencias del usuario (HU-12/14): tema, modo oscuro y tipografía. Se guardan
 * en la fila `usuarios` (`tema`, `modo_oscuro`, `preferencias_json`). La lectura va
 * por `/auth/me`; aquí solo la escritura (`PUT /auth/preferencias`).
 */
import { execute, select } from "./client";
import { ahoraIso } from "./util";

/** `PUT /auth/preferencias`. */
export async function putPreferencias(
  tema: string | null,
  modoOscuro: boolean,
  preferencias: unknown,
): Promise<{ ok: true }> {
  // Actualiza al usuario local (único en modo desktop).
  const rows = await select<{ id: string }>("SELECT id FROM usuarios LIMIT 1");
  if (rows.length === 0) return { ok: true };
  await execute(
    "UPDATE usuarios SET tema = ?, modo_oscuro = ?, preferencias_json = ?, actualizado_en = ? WHERE id = ?",
    [
      tema ?? "bioluminiscencia",
      modoOscuro ? 1 : 0,
      preferencias === undefined || preferencias === null ? null : JSON.stringify(preferencias),
      ahoraIso(),
      rows[0].id,
    ],
  );
  return { ok: true };
}
