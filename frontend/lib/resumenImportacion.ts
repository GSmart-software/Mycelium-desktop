/**
 * Textos del resumen de una importación que dependen de lo que la regla fija
 * dejó fuera (`DEF-165`). Módulo puro: lo prueba `scripts/test-resumen-importacion.mjs`.
 */

/** «a», «a y b», «a, b y c». */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** El último segmento de una ruta POSIX, con la `/` final si es una carpeta. */
function nombre(ruta: string): string {
  const carpeta = ruta.endsWith("/");
  const limpia = carpeta ? ruta.slice(0, -1) : ruta;
  const base = limpia.slice(limpia.lastIndexOf("/") + 1);
  return carpeta ? `${base}/` : base;
}

/** Hasta cuántos archivos ocultos se nombran; más que eso, se cuentan. */
const ARCHIVOS_NOMBRADOS = 2;

/**
 * Lo excluido, agrupado para leerlo de un vistazo: las carpetas por su nombre
 * (sin repetir: tres `.git/` en distintos niveles son un `.git/`) y los archivos
 * ocultos por nombre si son pocos, o contados. `null` si no se excluyó nada.
 *
 *   [".claude/", "a/.git/", ".git/", ".mcp.json", ".env", "x/.env"]
 *     → «.claude/, .git/ y 3 archivos ocultos»
 */
export function textoExcluidos(excluidos: string[]): string | null {
  if (excluidos.length === 0) return null;
  const carpetas = [...new Set(excluidos.filter((r) => r.endsWith("/")).map(nombre))];
  const archivos = excluidos.filter((r) => !r.endsWith("/"));
  const nombres = [...new Set(archivos.map(nombre))];
  const partes = [...carpetas];
  if (archivos.length > 0 && archivos.length <= ARCHIVOS_NOMBRADOS) {
    partes.push(...nombres);
  } else if (archivos.length > 0) {
    partes.push(`${archivos.length} archivos ocultos`);
  }
  return enumerar(partes);
}
