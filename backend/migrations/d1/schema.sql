-- Esquema Cloudflare D1 (producción). Espejo de migrations/local/local_schema.sql
-- (SQLite puro, D1-compatible, FTS5 incluido). En modo cloudflare el
-- LocalDbInitializer NO corre, así que este esquema se aplica manualmente:
--   wrangler d1 execute micelio-prod --remote --file=backend/migrations/d1/schema.sql
-- Idempotente: todo es CREATE ... IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS usuarios (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,
  nombre           TEXT NOT NULL,
  password_hash    TEXT,                 -- NULL si la cuenta es solo OAuth
  github_id        TEXT,
  avatar_url       TEXT,
  email_verificado INTEGER NOT NULL DEFAULT 0,
  tema             TEXT NOT NULL DEFAULT 'bioluminiscencia',
  modo_oscuro      INTEGER NOT NULL DEFAULT 1,
  preferencias_json TEXT,                -- tipografía y demás preferencias (HU-14)
  creado_en        TEXT NOT NULL,
  actualizado_en   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expira_en   TEXT NOT NULL,
  revocado    INTEGER NOT NULL DEFAULT 0,
  creado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_usuario ON refresh_tokens(usuario_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- Verificación de email y reset de contraseña (HU-32)
CREATE TABLE IF NOT EXISTS tokens_un_uso (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('verificar_email', 'reset_password')),
  token_hash  TEXT NOT NULL,
  expira_en   TEXT NOT NULL,
  usado       INTEGER NOT NULL DEFAULT 0,
  creado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_un_uso_usuario ON tokens_un_uso(usuario_id);

CREATE TABLE IF NOT EXISTS vaults (
  id             TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  propietario_id TEXT NOT NULL REFERENCES usuarios(id),
  creado_en      TEXT NOT NULL
);

-- Membresías sobre vaults o carpetas compartidas (HU-33 / HU-35)
CREATE TABLE IF NOT EXISTS membresias (
  id           TEXT PRIMARY KEY,
  usuario_id   TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  recurso_tipo TEXT NOT NULL CHECK (recurso_tipo IN ('vault', 'carpeta')),
  recurso_id   TEXT NOT NULL,
  rol          TEXT NOT NULL CHECK (rol IN ('lector', 'editor', 'propietario')),
  creado_en    TEXT NOT NULL,
  UNIQUE (usuario_id, recurso_tipo, recurso_id)
);

CREATE INDEX IF NOT EXISTS idx_membresias_usuario ON membresias(usuario_id);
CREATE INDEX IF NOT EXISTS idx_membresias_recurso ON membresias(recurso_tipo, recurso_id);

CREATE TABLE IF NOT EXISTS carpetas (
  id             TEXT PRIMARY KEY,
  vault_id       TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  padre_id       TEXT REFERENCES carpetas(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_carpetas_vault ON carpetas(vault_id);
CREATE INDEX IF NOT EXISTS idx_carpetas_padre ON carpetas(padre_id);

-- El título de la nota ES el nombre del archivo (HU-23). r2_key es ID-based
-- e invariante ante renombres. El contenido .md vive en blob storage (HU-04).
CREATE TABLE IF NOT EXISTS notas (
  id             TEXT PRIMARY KEY,
  vault_id       TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  carpeta_id     TEXT REFERENCES carpetas(id) ON DELETE SET NULL,
  titulo         TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'markdown',  -- 'markdown' | 'excalidraw' (HU-16)
  r2_key         TEXT NOT NULL,
  tamano_bytes   INTEGER NOT NULL DEFAULT 0,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notas_vault ON notas(vault_id);
CREATE INDEX IF NOT EXISTS idx_notas_carpeta ON notas(carpeta_id);

-- Papelera: retiene 30 días, luego eliminación permanente (HU-23)
CREATE TABLE IF NOT EXISTS papelera (
  id                  TEXT PRIMARY KEY,
  nota_id             TEXT NOT NULL UNIQUE REFERENCES notas(id) ON DELETE CASCADE,
  ruta_original       TEXT NOT NULL,
  carpeta_original_id TEXT,
  eliminado_en        TEXT NOT NULL
);

-- Índice full-text del contenido de notas (HU-21). Se actualiza al guardar.
CREATE VIRTUAL TABLE IF NOT EXISTS notas_fts USING fts5(
  nota_id UNINDEXED,
  titulo,
  contenido
);

-- Snippets de CSS personalizado por usuario (estilo Obsidian, HU-13/15).
-- El contenido vive en blob (usuarios/{id}/css/{snippetId}.css).
CREATE TABLE IF NOT EXISTS css_snippets (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activo      INTEGER NOT NULL DEFAULT 1,
  r2_key      TEXT NOT NULL,
  creado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_css_snippets_usuario ON css_snippets(usuario_id);
