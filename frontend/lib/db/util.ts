/**
 * Utilidades puras de la capa de datos (sin acceso a DB): ids, fechas, tamaño en
 * bytes, sufijo único de título y rutas de carpeta. Portado 1:1 de la lógica del
 * backend (`VaultEndpoints.EnsureUniqueTituloAsync`, `BuildRutaLookupAsync`).
 */

/** Id nuevo (equivale a `Guid.NewGuid().ToString()` del backend). */
export function nuevoId(): string {
  return crypto.randomUUID();
}

/** Timestamp ISO-8601 UTC (equivale a `DateTime.UtcNow.ToString("O")`). */
export function ahoraIso(): string {
  return new Date().toISOString();
}

/** Tamaño en bytes UTF-8 del contenido (para `notas.tamano_bytes`). */
export function byteLen(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

/**
 * Sufijo numérico incremental para títulos duplicados (HU-23 CA5):
 * "Nota" → "Nota 2" → "Nota 3". Comparación case-insensitive, igual que el backend.
 */
export function tituloUnico(titulo: string, existentes: Iterable<string>): string {
  const set = new Set<string>();
  for (const t of existentes) set.add(t.toLowerCase());
  if (!set.has(titulo.toLowerCase())) return titulo;

  // Base sin sufijo numérico: "Nota 2" → "Nota".
  const partes = titulo.split(" ");
  const ultimo = partes[partes.length - 1];
  const baseTitulo =
    partes.length > 1 && /^\d+$/.test(ultimo)
      ? partes.slice(0, -1).join(" ")
      : titulo;

  let n = 2;
  while (set.has(`${baseTitulo} ${n}`.toLowerCase())) n++;
  return `${baseTitulo} ${n}`;
}

/** Carpeta mínima para calcular rutas. */
export type CarpetaRuta = { id: string; padre_id: string | null; nombre: string };

/**
 * Lookup carpetaId → ruta completa ("Proyectos/Ideas"). Portado de
 * `BuildRutaLookupAsync`. La raíz (carpetaId null) se representa como "/".
 */
export function buildRutaLookup(carpetas: CarpetaRuta[]): Map<string, string> {
  const porId = new Map(carpetas.map((c) => [c.id, c]));
  const rutas = new Map<string, string>();
  for (const c of carpetas) {
    const partes: string[] = [];
    let actual: string | null = c.id;
    while (actual !== null) {
      const info = porId.get(actual);
      if (!info) break;
      partes.unshift(info.nombre);
      actual = info.padre_id;
    }
    rutas.set(c.id, partes.join("/"));
  }
  return rutas;
}

/** Ruta de una carpeta (o "/" para la raíz). */
export function rutaDe(rutas: Map<string, string>, carpetaId: string | null): string {
  if (carpetaId !== null) {
    const r = rutas.get(carpetaId);
    if (r !== undefined) return r;
  }
  return "/";
}
