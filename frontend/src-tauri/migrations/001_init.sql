-- Esquema inicial de Mycelium desktop (Tauri + SQLite nativo vía tauri-plugin-sql).
-- Portado de backend/migrations/local/local_schema.sql con dos cambios:
--   * El CONTENIDO de notas/diagramas/css deja de vivir en blobs en disco y pasa a
--     tablas TEXT aquí (sistema único, transaccional).
--   * notas.r2_key / css_snippets.r2_key se eliminan (ya no hay blob keys).
-- Se conservan usuarios/vaults/membresías (auth latente) para la futura nube.

CREATE TABLE IF NOT EXISTS usuarios (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  nombre            TEXT NOT NULL,
  password_hash     TEXT,
  github_id         TEXT,
  avatar_url        TEXT,
  email_verificado  INTEGER NOT NULL DEFAULT 0,
  tema              TEXT NOT NULL DEFAULT 'bioluminiscencia',
  modo_oscuro       INTEGER NOT NULL DEFAULT 1,
  preferencias_json TEXT,
  creado_en         TEXT NOT NULL,
  actualizado_en    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
  id             TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  propietario_id TEXT NOT NULL REFERENCES usuarios(id),
  creado_en      TEXT NOT NULL
);

-- Membresías sobre vaults o carpetas (se conservan para la futura nube).
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

-- El título de la nota ES el nombre del archivo. El contenido vive en `contenidos`.
CREATE TABLE IF NOT EXISTS notas (
  id             TEXT PRIMARY KEY,
  vault_id       TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  carpeta_id     TEXT REFERENCES carpetas(id) ON DELETE SET NULL,
  titulo         TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'markdown',  -- 'markdown' | 'excalidraw'
  tamano_bytes   INTEGER NOT NULL DEFAULT 0,
  creado_en      TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notas_vault ON notas(vault_id);
CREATE INDEX IF NOT EXISTS idx_notas_carpeta ON notas(carpeta_id);

-- Contenido markdown / escena excalidraw de cada nota (antes blob en disco).
CREATE TABLE IF NOT EXISTS contenidos (
  nota_id        TEXT PRIMARY KEY REFERENCES notas(id) ON DELETE CASCADE,
  contenido      TEXT NOT NULL DEFAULT '',
  actualizado_en TEXT NOT NULL
);

-- Diagramas excalidraw embebidos (legado): uno o varios por nota.
CREATE TABLE IF NOT EXISTS diagramas (
  nota_id        TEXT NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  diag_id        TEXT NOT NULL,
  contenido      TEXT NOT NULL DEFAULT '',
  actualizado_en TEXT NOT NULL,
  PRIMARY KEY (nota_id, diag_id)
);

-- Papelera: retiene 30 días, luego eliminación permanente.
CREATE TABLE IF NOT EXISTS papelera (
  id                  TEXT PRIMARY KEY,
  nota_id             TEXT NOT NULL UNIQUE REFERENCES notas(id) ON DELETE CASCADE,
  ruta_original       TEXT NOT NULL,
  carpeta_original_id TEXT,
  eliminado_en        TEXT NOT NULL
);

-- Índice full-text del contenido de notas (FTS5). Se mantiene manualmente
-- (delete+insert) al guardar contenido.
CREATE VIRTUAL TABLE IF NOT EXISTS notas_fts USING fts5(
  nota_id UNINDEXED,
  titulo,
  contenido
);

-- Snippets de CSS personalizado por usuario (contenido inline).
CREATE TABLE IF NOT EXISTS css_snippets (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activo      INTEGER NOT NULL DEFAULT 1,
  contenido   TEXT NOT NULL DEFAULT '',
  creado_en   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_css_snippets_usuario ON css_snippets(usuario_id);
