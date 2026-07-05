/**
 * Tipos de la capa de datos del desktop.
 *
 * Dos familias:
 *   - `Row*`: filas tal cual salen de SQLite (snake_case).
 *   - DTOs de respuesta: la forma EXACTA que cada call-site del frontend ya
 *     espera de `api()` hoy (no se cambia ningún consumidor). Ver los stores/
 *     componentes que mapean estas respuestas (vaultStore, authStore, etc.).
 */

export type NotaTipo = "markdown" | "excalidraw";

// ── Filas SQLite ────────────────────────────────────────────────────────────

export type RowUsuario = {
  id: string;
  email: string;
  nombre: string;
  avatar_url: string | null;
  tema: string;
  modo_oscuro: number;
  preferencias_json: string | null;
};

export type RowVault = {
  id: string;
  nombre: string;
  propietario_id: string;
};

export type RowCarpeta = {
  id: string;
  vault_id: string;
  padre_id: string | null;
  nombre: string;
  creado_en: string;
  actualizado_en: string;
};

export type RowNota = {
  id: string;
  vault_id: string;
  carpeta_id: string | null;
  titulo: string;
  tipo: string;
  tamano_bytes: number;
  creado_en: string;
  actualizado_en: string;
};

export type RowPapelera = {
  id: string;
  nota_id: string;
  ruta_original: string;
  carpeta_original_id: string | null;
  eliminado_en: string;
};

export type RowContenido = {
  nota_id: string;
  contenido: string;
  actualizado_en: string;
};

export type RowCssSnippet = {
  id: string;
  usuario_id: string;
  nombre: string;
  activo: number;
  contenido: string;
  creado_en: string;
};

// ── DTOs de respuesta (forma que espera el frontend) ──────────────────────────

/** `GET /vaults/{id}/tree` — vaultStore mapea padre_id/carpeta_id/actualizado_en. */
export type TreeResponse = {
  carpetas: { id: string; padre_id: string | null; nombre: string }[];
  notas: {
    id: string;
    carpeta_id: string | null;
    titulo: string;
    tipo: string;
    actualizado_en: string;
  }[];
};

/** `GET /vaults/{id}/papelera`. */
export type PapeleraResponse = {
  items: {
    nota_id: string;
    titulo: string;
    ruta_original: string;
    eliminado_en: string;
  }[];
};

/** `POST /vaults/{id}/carpetas` y `POST /vaults/{id}/notas`. */
export type CreatedResponse = { id: string };

/** `GET /notas/{id}/contenido`. */
export type ContenidoResponse = { contenido: string; actualizadoEn: string };

/** `PUT /notas/{id}/contenido`. */
export type PutContenidoResponse = { actualizadoEn: string };

/** `GET /vaults/{id}/carpetas-compartidas` (no-op local → vacío). */
export type CarpetasCompartidasResponse = { ids: string[] };

/** `GET /auth/css/snippets`. */
export type SnippetsResponse = { snippets: CssSnippetDto[] };

/** Snippet tal como lo consume cssStore. */
export type CssSnippetDto = {
  id: string;
  nombre: string;
  activo: boolean;
  contenido: string;
};

/** Usuario tal como lo consume authStore. */
export type UserDto = {
  id: string;
  email: string;
  nombre: string;
  avatarUrl: string | null;
  tema: string;
  modoOscuro: boolean;
  preferencias?: Record<string, unknown>;
};

/** Vault tal como lo consume authStore. */
export type VaultDto = {
  id: string;
  nombre: string;
  propietario_id: string;
  rol: "lector" | "editor" | "propietario";
};

/** `POST /auth/login` y `/auth/refresh`. */
export type SessionResponse = {
  accessToken: string;
  expiresInMinutes: number;
  user: UserDto;
};

/** `GET /auth/me`. */
export type MeResponse = { user: UserDto; vaults: VaultDto[] };

/** `GET /vaults/{id}/buscar`. */
export type SearchResponse = {
  resultados: {
    nota_id: string;
    titulo: string;
    carpeta_id: string | null;
    fragmento: string;
  }[];
};
