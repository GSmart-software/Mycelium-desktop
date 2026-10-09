/**
 * Saneo y desambiguación de nombres de archivo/carpeta para el "vault en carpeta"
 * (fase 7, solo-desktop). Módulo **puro**: sin imports ni acceso a disco/DB, para
 * poder probarlo headless (`scripts/test-nombres.mjs`) y reutilizarlo desde
 * `vaultFs.ts` (que sí toca la DB) sin arrastrar dependencias de Tauri.
 *
 * Contexto: el nombre de una nota/carpeta se convierte en un nombre de
 * archivo/directorio REAL en disco, así que debe respetar las reglas del sistema
 * de archivos (sobre todo Windows).
 */

/**
 * Caracteres prohibidos en nombres de archivo por Windows (y problemáticos en
 * POSIX): `\ / : * ? " < > |`. Se sustituyen por `-`.
 */
const CARACTERES_PROHIBIDOS = /[\\/:*?"<>|]/g;

/** Caracteres de control (0x00–0x1F): tampoco válidos en nombres de archivo. */
// eslint-disable-next-line no-control-regex
const CARACTERES_CONTROL = /[\x00-\x1f]/g;

/**
 * Nombres de dispositivo reservados en Windows (case-insensitive). Un archivo o
 * carpeta con uno de estos nombres —con o sin extensión— es inválido (`CON.md`
 * también lo es). Se comprueba contra el nombre SIN extensión (el "stem").
 */
const RESERVADOS_WINDOWS = new Set<string>([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** `true` si `stem` (nombre sin extensión) es un nombre reservado de Windows. */
export function esReservadoWindows(stem: string): boolean {
  return RESERVADOS_WINDOWS.has(stem.trim().toLowerCase());
}

/**
 * Sanea un nombre para que sea un nombre de archivo/carpeta válido en disco:
 *   1. Elimina caracteres de control.
 *   2. Reemplaza los prohibidos (`\ / : * ? " < > |`) por `-`.
 *   3. Colapsa espacios repetidos y recorta espacios/puntos al final (Windows los
 *      recorta silenciosamente, lo que causaría desajustes entre nombre e id).
 *   4. Si queda vacío, usa `fallback` ("Sin título" por defecto; para carpetas se
 *      pasa "Sin nombre").
 *   5. Si el resultado es un nombre reservado de Windows, le añade `_`.
 *
 * El parámetro `nombre` es el NOMBRE SIN EXTENSIÓN (el título de la nota o el
 * nombre de la carpeta); la extensión se añade fuera. Nunca devuelve cadena vacía.
 */
export function sanearNombre(nombre: string, fallback = "Sin título"): string {
  let limpio = nombre
    .replace(CARACTERES_CONTROL, "")
    .replace(CARACTERES_PROHIBIDOS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .trim();

  // Si no queda NINGÚN carácter con significado (p. ej. "///" → "---", o solo
  // puntos/espacios), se considera vacío y se usa el fallback.
  if (limpio.replace(/[-.\s]/g, "").length === 0) limpio = "";
  if (limpio.length === 0) limpio = fallback;
  if (esReservadoWindows(limpio)) limpio = `${limpio}_`;
  return limpio;
}

/**
 * Los caracteres prohibidos (`\ / : * ? " < > |`) que aparecen en `nombre`, sin
 * repetir y en el orden en que aparecen. Vacío si no hay ninguno. Son los que
 * `sanearNombre` va a sustituir por `-` (`DEF-150 m`).
 */
export function caracteresProhibidosEn(nombre: string): string[] {
  const vistos: string[] = [];
  for (const c of nombre.match(CARACTERES_PROHIBIDOS) ?? []) {
    if (!vistos.includes(c)) vistos.push(c);
  }
  return vistos;
}

/**
 * El aviso para el usuario cuando el nombre que escribió lleva caracteres que un
 * archivo no admite y el saneo los cambió por `-` (`DEF-150 m`); `null` si no
 * había ninguno. `quedo` es el nombre que el archivo obtuvo, si se sabe.
 *
 * Antes el reemplazo era silencioso: «¿Qué es?» pasaba a llamarse «¿Qué es-» y
 * el usuario no sabía por qué su título no era el que escribió.
 */
export function avisoCaracteresReemplazados(nombre: string, quedo?: string): string | null {
  const cs = caracteresProhibidosEn(nombre);
  if (cs.length === 0) return null;
  const lista = cs.map((c) => `«${c}»`).join(" ");
  const final = quedo ? `: quedó «${quedo}»` : "";
  return `Se reemplazaron caracteres no permitidos en un nombre de archivo (${lista}) por «-»${final}.`;
}

/**
 * Desambiguación por sufijo incremental estilo Obsidian: si `base` ya está
 * ocupado, prueba `"base 1"`, `"base 2"`… hasta encontrar uno libre. `ocupado` es
 * un predicado (normalmente una consulta al índice) que decide si un candidato ya
 * existe. Función pura y determinista para poder testearla headless.
 */
export function desambiguar(base: string, ocupado: (candidato: string) => boolean): string {
  if (!ocupado(base)) return base;
  let n = 1;
  while (ocupado(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Cola de tareas asíncronas que corren **de a una**, en el orden en que se
 * pidieron (`DEF-136`). Una tarea que falla no traba a las siguientes.
 *
 * Existe por la elección de un nombre libre: `nombreNotaLibre` lee del índice qué
 * nombres están ocupados y el `INSERT` de la nota llega varios `await` después
 * (escribir el archivo es un viaje a Rust). Dos creaciones seguidas —clics
 * rápidos en «Nueva nota»— leían el índice antes de que la primera insertara,
 * elegían las dos el mismo «Sin título N», la segunda pisaba el archivo de la
 * primera y su `INSERT` reventaba con `UNIQUE constraint failed: notas.id`.
 * Elegir el nombre y ocuparlo tiene que ser un solo paso: se hace dentro de la
 * cola.
 */
export function crearCola(): <T>(tarea: () => Promise<T>) => Promise<T> {
  let ultima: Promise<unknown> = Promise.resolve();
  return <T>(tarea: () => Promise<T>): Promise<T> => {
    const esta = ultima.then(tarea);
    // La cola sigue aunque la tarea falle; quien la pidió recibe el rechazo.
    ultima = esta.catch(() => undefined);
    return esta;
  };
}
