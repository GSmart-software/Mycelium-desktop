/**
 * Conflicto entre lo que el usuario escribe en una nota y lo que otro programa
 * escribió en su archivo (`DEF-138`).
 *
 * Hasta `DEF-138`, una nota con cambios sin guardar ignoraba el aviso del
 * watcher —para no pisar la edición en curso— y el próximo guardado escribía
 * encima de lo de afuera sin decir nada: lo que había escrito la IA, otro
 * editor o una sincronización desaparecía. Ahora, cuando los dos lados
 * cambiaron, **no se guarda**: la nota muestra una barra y el usuario elige
 * (ver «Ver lo de afuera», «Quedarme con lo mío», «Guardar lo mío como copia»).
 *
 * Las preguntas viven acá, puras y sin imports, para que
 * `scripts/test-conflicto-externo.mjs` las pruebe sin navegador y para que la
 * capa de datos (`lib/db/contenido.ts`) use el mismo criterio al escribir.
 *
 * Los tres textos con que se decide:
 * - `disco`: lo que hay ahora en el archivo (`null` si no existe).
 * - `conocido`: lo último que el editor sabe que está en disco —lo que leyó al
 *   abrir o lo que guardó—. Es la «base» de la edición. `null` si no lo sabe
 *   (la carga falló): entonces no hay contra qué comparar.
 * - `local`: lo que el usuario tiene en pantalla.
 */

/**
 * Qué hacer cuando el watcher avisa que el archivo cambió, o al volver a una
 * pestaña.
 *
 * - `nada`: no vino nada de afuera (el disco tiene lo conocido: es el eco del
 *   propio guardado) o el archivo ya no está (borrarlo es asunto del watcher y
 *   del árbol, no de esta decisión).
 * - `alcanzado`: el disco ya tiene exactamente lo que se ve. No hay nada que
 *   recargar ni que guardar: lo de afuera coincide con lo de adentro.
 * - `recargar`: cambió afuera y la nota no tiene cambios propios: se trae lo
 *   del disco.
 * - `conflicto`: cambiaron los dos lados. No se recarga ni se guarda: decide
 *   el usuario.
 */
export type DecisionExterna = "nada" | "alcanzado" | "recargar" | "conflicto";

export function decidirAnteCambioExterno(estado: {
  disco: string | null;
  conocido: string | null;
  local: string;
  /** La pestaña tiene cambios propios sin escribir. */
  sucio: boolean;
}): DecisionExterna {
  const { disco, conocido, local, sucio } = estado;
  if (disco === null) return "nada";
  if (disco === conocido) return "nada";
  if (disco === local) return "alcanzado";
  // Sin cambios propios —ni marcados ni de hecho— lo de afuera manda. «De
  // hecho» importa con la misma nota en dos paneles: el espejo recibe lo que
  // se escribe en el otro sin marcarse sucio, y recargarlo publicaría lo de
  // afuera de vuelta al panel donde se está escribiendo.
  const propios = sucio || (conocido !== null && local !== conocido);
  return propios ? "conflicto" : "recargar";
}

/**
 * Qué hacer al ir a guardar: comparar el disco con la base ANTES de escribir.
 * Cubre la carrera que el watcher no alcanza a avisar —el archivo cambió hace
 * milisegundos y el aviso todavía no llegó—.
 *
 * - `escribir`: el disco tiene la base (nadie lo tocó), o no hay base contra la
 *   que comparar, o el archivo no existe (se recrea, como siempre).
 * - `ya-esta`: el disco ya tiene lo que se iba a escribir.
 * - `conflicto`: alguien cambió el archivo desde la última lectura o guardado.
 *   No se escribe.
 */
export type DecisionGuardado = "escribir" | "ya-esta" | "conflicto";

export function decidirAlGuardar(estado: {
  disco: string | null;
  conocido: string | null;
  local: string;
}): DecisionGuardado {
  const { disco, conocido, local } = estado;
  if (disco === null || conocido === null) return "escribir";
  if (disco === local) return "ya-esta";
  if (disco === conocido) return "escribir";
  return "conflicto";
}

/** Sufijo con que se nombra la copia de lo local al resolver un conflicto. */
export const SUFIJO_COPIA_LOCAL = "(copia local)";

/**
 * Título de la nota donde se guarda lo local: «Receta (copia local)». Si ya
 * hay una, la creación del vault le agrega el número como a cualquier
 * homónima, así que acá no se desambigua.
 *
 * Si la nota ya era una copia local, no se apila el sufijo: «Receta (copia
 * local) (copia local)» no le dice nada más al usuario.
 */
export function tituloDeCopiaLocal(titulo: string): string {
  const base = titulo.trim() || "Sin título";
  const sinSufijo = base.endsWith(` ${SUFIJO_COPIA_LOCAL}`)
    ? base.slice(0, -(SUFIJO_COPIA_LOCAL.length + 1)).trimEnd()
    : base;
  return `${sinSufijo} ${SUFIJO_COPIA_LOCAL}`;
}

/**
 * Ruta del archivo de copia cuando NO se puede preguntar ni esperar: al cerrar
 * la ventana con un conflicto pendiente. No hay tiempo de pedirle al vault que
 * desambigüe, así que el nombre lleva fecha y hora para no pisar otra copia.
 *
 * `ruta` es el id de la nota (ruta relativa POSIX con `.md`).
 */
export function rutaDeCopiaDeEmergencia(ruta: string, ahora: Date): string {
  const corte = ruta.lastIndexOf("/");
  const carpeta = corte >= 0 ? ruta.slice(0, corte + 1) : "";
  const archivo = corte >= 0 ? ruta.slice(corte + 1) : ruta;
  const punto = archivo.lastIndexOf(".");
  const nombre = punto > 0 ? archivo.slice(0, punto) : archivo;
  const ext = punto > 0 ? archivo.slice(punto) : ".md";
  const dos = (n: number) => String(n).padStart(2, "0");
  const sello =
    `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())} ` +
    `${dos(ahora.getHours())}${dos(ahora.getMinutes())}${dos(ahora.getSeconds())}`;
  return `${carpeta}${tituloDeCopiaLocal(nombre).slice(0, -1)} ${sello})${ext}`;
}
