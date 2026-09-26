/**
 * Utilidades puras de la capa de datos (sin acceso a DB): ids, fechas, tamaño en
 * bytes, huella y rutas de carpeta. Portado de la lógica del backend
 * (`BuildRutaLookupAsync`).
 */

/**
 * Id nuevo (equivale a `Guid.NewGuid().ToString()` del backend). Lo usan las
 * filas de la papelera: las notas y carpetas se identifican por su ruta.
 */
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
 * Huella barata y estable de un texto (`FUN-M-38`): 64 bits en hexadecimal a
 * partir de dos multiplicaciones enteras por carácter (cyrb53 extendido). No es
 * criptográfica ni tiene que serlo: solo decide si lo que se va a reindexar es
 * lo mismo que ya está indexado, y una colisión cuesta a lo sumo una búsqueda
 * desactualizada hasta el próximo guardado. Sobre una nota de 500 KB tarda
 * ~1 ms, contra los cientos de ms de reescribir FTS5.
 */
export function huellaDe(texto: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
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
