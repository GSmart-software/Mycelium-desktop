/**
 * Compartir carpetas / colaboración (HU-35/36/37). En el desktop local queda
 * LATENTE: las tablas (membresias) se conservan para la futura nube, pero los
 * endpoints devuelven vacío/éxito neutro para que la UI no rompa. Se reactiva al
 * integrar Cloudflare (fase 7).
 */

/** `GET /compartido`. */
export function compartido(): { compartidos: unknown[] } {
  return { compartidos: [] };
}

/** `GET /carpetas/{id}/miembros`. */
export function miembros(): { miembros: unknown[] } {
  return { miembros: [] };
}

/** `POST /carpetas/{id}/compartir`, `PATCH`/`DELETE /carpetas/{id}/miembros/{u}`. */
export function noop(): { ok: true } {
  return { ok: true };
}
