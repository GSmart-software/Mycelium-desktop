/**
 * Tipos de la capa de datos del desktop.
 *
 * DTOs de respuesta: la forma EXACTA que cada call-site del frontend ya espera
 * de `api()` (la misma que devuelve el backend de web). Ver los stores y
 * componentes que mapean estas respuestas (vaultStore, graphStore, etc.).
 */

export type NotaTipo = "markdown" | "excalidraw" | "base" | "canvas" | "drawio";

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

/** `GET /vaults/{id}/buscar`. */
export type SearchResponse = {
  resultados: {
    nota_id: string;
    titulo: string;
    carpeta_id: string | null;
    fragmento: string;
  }[];
};
