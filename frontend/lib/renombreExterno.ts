/**
 * Renombres hechos **por fuera** de Mycelium (`FUN-M-47`): un `git mv`, un `mv`
 * en la terminal, el explorador del sistema. El watcher los ve como dos cosas
 * sueltas en la misma ráfaga —`A.md` desapareció y apareció `B.md`— y el índice
 * los trata así: borra A (sus enlaces entrantes quedan rotos) y agrega B. Acá
 * se decide si ese par **parece un renombre**, para ofrecer reparar los enlaces.
 *
 * Módulo **puro** (solo importa el también puro `lib/frontmatter.ts`): lo
 * prueba `scripts/test-renombre-externo.mjs` sin build. La E/S —leer el índice
 * y el disco, preguntar, reparar— vive en `lib/renombresExternos.ts`.
 *
 * ## El criterio
 *
 * Se compara el **cuerpo** de las dos notas, sin el frontmatter (un renombre a
 * mano suele venir con un `aliases:` o una fecha cambiada):
 *
 * 1. **Iguales** (ignorando los finales de línea y los espacios al final de
 *    cada línea): es un renombre, con similitud 1.
 * 2. Si no, la **proporción de líneas en común** (como multiconjunto, sin las
 *    vacías) sobre la nota más larga. Desde `UMBRAL_SIMILITUD` (0,9) cuenta,
 *    solo si las dos tienen al menos `MIN_LINEAS` líneas con texto: en una nota
 *    de dos líneas, una sola distinta ya es la mitad, y no prueba nada.
 *
 * Es barato a propósito —una pasada por nota, sin distancia de edición—: el
 * caso que importa es el renombre puro, y el umbral alto evita ofrecer reparar
 * enlaces entre dos notas que solo se parecen.
 *
 * Una nota **vacía** (o solo con frontmatter) no se empareja: borrar una vacía
 * y crear otra vacía en la misma ráfaga no dice nada. Y el emparejamiento es
 * **uno a uno** y sin empates: si A se parece igual a B y a C, no se ofrece
 * nada —elegir sería adivinar—.
 */
import { cuerpoDe } from "@/lib/frontmatter";

/** Una nota con su texto: la que se fue (del índice) o la que llegó (del disco). */
export type NotaConTexto = { id: string; titulo: string; contenido: string };

/** Un renombre detectado: de qué nota a cuál, y cuánto se parecen (0–1). */
export type RenombreDetectado = { de: NotaConTexto; a: NotaConTexto; similitud: number };

/** Desde qué similitud dos notas distintas cuentan como la misma. */
export const UMBRAL_SIMILITUD = 0.9;

/** Cuántas líneas con texto hacen falta para comparar por similitud. */
export const MIN_LINEAS = 3;

/** El cuerpo comparable: sin frontmatter, con `\n`, sin espacios al final de cada línea. */
export function cuerpoComparable(texto: string): string {
  return cuerpoDe(texto.replace(/\r\n?/g, "\n"))
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/** Qué tanto se parecen dos textos de nota, de 0 a 1 (ver la cabecera). */
export function similitud(a: string, b: string): number {
  const ca = cuerpoComparable(a);
  const cb = cuerpoComparable(b);
  if (ca === "" || cb === "") return 0;
  if (ca === cb) return 1;
  const la = ca.split("\n").filter((l) => l.trim() !== "");
  const lb = cb.split("\n").filter((l) => l.trim() !== "");
  if (la.length < MIN_LINEAS || lb.length < MIN_LINEAS) return 0;
  const cuenta = new Map<string, number>();
  for (const l of la) cuenta.set(l, (cuenta.get(l) ?? 0) + 1);
  let comunes = 0;
  for (const l of lb) {
    const n = cuenta.get(l) ?? 0;
    if (n > 0) {
      comunes++;
      cuenta.set(l, n - 1);
    }
  }
  return comunes / Math.max(la.length, lb.length);
}

/** La extensión de un id-ruta, en minúsculas (`.md`), o `""`. */
function extension(id: string): string {
  const nombre = id.slice(id.lastIndexOf("/") + 1);
  const p = nombre.lastIndexOf(".");
  return p <= 0 ? "" : nombre.slice(p).toLowerCase();
}

/**
 * Los renombres que explican una ráfaga: entre las notas que se fueron
 * (`idas`) y las que llegaron (`nuevas`), los pares de la misma extensión que
 * se parecen desde el umbral. Uno a uno, del más parecido al menos, y sin
 * empates: un par empatado con otro que comparte una de sus notas se descarta.
 */
export function detectarRenombres(
  idas: readonly NotaConTexto[],
  nuevas: readonly NotaConTexto[],
): RenombreDetectado[] {
  const candidatos: RenombreDetectado[] = [];
  for (const de of idas) {
    for (const a of nuevas) {
      if (de.id === a.id || extension(de.id) !== extension(a.id)) continue;
      const s = similitud(de.contenido, a.contenido);
      if (s >= UMBRAL_SIMILITUD) candidatos.push({ de, a, similitud: s });
    }
  }
  candidatos.sort((x, y) => y.similitud - x.similitud);
  const usadas = new Set<string>();
  const salida: RenombreDetectado[] = [];
  for (const c of candidatos) {
    if (usadas.has(`de:${c.de.id}`) || usadas.has(`a:${c.a.id}`)) continue;
    const empate = candidatos.some(
      (o) => o !== c && o.similitud === c.similitud && (o.de.id === c.de.id || o.a.id === c.a.id),
    );
    usadas.add(`de:${c.de.id}`);
    usadas.add(`a:${c.a.id}`);
    if (!empate) salida.push(c);
  }
  return salida;
}

/** El texto del aviso que ofrece reparar. `enlaces`: cuántos apuntaban a la de antes. */
export function textoOferta(de: string, a: string, enlaces: number, notas: number): string {
  const cuantos = enlaces === 1 ? "1 enlace" : `${enlaces} enlaces`;
  const donde = notas === 1 ? "1 nota" : `${notas} notas`;
  return `Parece que «${de}» se renombró a «${a}» fuera de Mycelium. ¿Reparar ${cuantos} (en ${donde}) que apuntaban a «${de}»?`;
}
