/**
 * Identidad interna del vault local (desktop). No hay usuarios ni login: se
 * siembra 1 registro + 1 vault por defecto y `me()`/`session()` devuelven esa
 * sesión fija (sin JWT). Las tablas usuarios/vaults/membresias se conservan
 * como plomería interna (el checksum de la migración sqlx impide tocar el
 * esquema) y la FORMA de las respuestas no cambia para no tocar `authStore`.
 */
import { execute, select } from "./client";
import type { MeResponse, RowUsuario, SessionResponse, UserDto, VaultDto } from "./types";
import { ahoraIso } from "./util";

const LOCAL_USER_ID = "local-user";
const LOCAL_VAULT_ID = "local-vault";
// ~1 año: valor simbólico, la sesión local no expira (nadie lo consume).
const EXPIRES_IN_MINUTES = 525_600;

/** Siembra usuario+vault+membresía por defecto si la DB está vacía (idempotente). */
export async function ensureSeed(): Promise<void> {
  const existentes = await select<{ n: number }>("SELECT count(*) AS n FROM usuarios");
  if (existentes[0]?.n > 0) return;

  const now = ahoraIso();
  await execute(
    `INSERT INTO usuarios (id, email, nombre, email_verificado, tema, modo_oscuro, creado_en, actualizado_en)
     VALUES (?, ?, ?, 1, 'bioluminiscencia', 1, ?, ?)`,
    [LOCAL_USER_ID, "local@mycelium.app", "Yo", now, now],
  );
  await execute("INSERT INTO vaults (id, nombre, propietario_id, creado_en) VALUES (?, ?, ?, ?)", [
    LOCAL_VAULT_ID,
    "Mi Vault",
    LOCAL_USER_ID,
    now,
  ]);
  await execute(
    "INSERT INTO membresias (id, usuario_id, recurso_tipo, recurso_id, rol, creado_en) VALUES (?, ?, 'vault', ?, 'propietario', ?)",
    ["local-membresia", LOCAL_USER_ID, LOCAL_VAULT_ID, now],
  );
}

function toUserDto(u: RowUsuario): UserDto {
  let preferencias: Record<string, unknown> | undefined;
  if (u.preferencias_json) {
    try {
      preferencias = JSON.parse(u.preferencias_json);
    } catch {
      preferencias = undefined;
    }
  }
  return {
    id: u.id,
    email: u.email,
    nombre: u.nombre,
    avatarUrl: u.avatar_url,
    tema: u.tema,
    modoOscuro: u.modo_oscuro === 1,
    preferencias,
  };
}

async function usuarioLocal(): Promise<UserDto> {
  await ensureSeed();
  const rows = await select<RowUsuario>(
    "SELECT id, email, nombre, avatar_url, tema, modo_oscuro, preferencias_json FROM usuarios LIMIT 1",
  );
  return toUserDto(rows[0]);
}

async function vaultsDe(usuarioId: string): Promise<VaultDto[]> {
  const rows = await select<{
    id: string;
    nombre: string;
    propietario_id: string;
    rol: "lector" | "editor" | "propietario";
  }>(
    `SELECT v.id, v.nombre, v.propietario_id, m.rol
     FROM vaults v JOIN membresias m ON m.recurso_tipo = 'vault' AND m.recurso_id = v.id
     WHERE m.usuario_id = ?`,
    [usuarioId],
  );
  return rows;
}

/** Sesión fija (`POST /auth/refresh`). El accessToken es un marcador; no se valida. */
export async function session(): Promise<SessionResponse> {
  const user = await usuarioLocal();
  return { accessToken: "local", expiresInMinutes: EXPIRES_IN_MINUTES, user };
}

/** `GET /auth/me`. */
export async function me(): Promise<MeResponse> {
  const user = await usuarioLocal();
  return { user, vaults: await vaultsDe(user.id) };
}
