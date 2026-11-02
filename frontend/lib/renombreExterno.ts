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

/**
 * Desde cuántos pares (idas × llegadas) la ráfaga no se mira (`FUN-M-58`).
 * Es una oferta, no un requisito, y el cálculo corre en el hilo principal:
 * medido sobre un vault real, 750 × 750 (≈560 000 pares) tarda ~0,7 s, así
 * que el tope (1 000 × 1 000) deja el peor caso cerca de 1,5 s. Una ráfaga
 * así es un `git checkout` o una sincronización masiva, no un renombre a mano.
 */
export const MAX_PARES = 1_000_000;

/** El cuerpo comparable: sin frontmatter, con `\n`, sin espacios al final de cada línea. */
export function cuerpoComparable(texto: string): string {
  return cuerpoDe(texto.replace(/\r\n?/g, "\n"))
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/**
 * Un texto ya preparado para comparar: el cuerpo comparable y sus líneas con
 * texto. Se arma UNA vez por nota (`FUN-M-58`): antes `similitud` normalizaba
 * los dos textos en cada par, o sea cada nota `n` veces en una ráfaga de `n`
 * idas y `n` llegadas.
 */
type Comparable = { cuerpo: string; lineas: string[] };

function comparable(texto: string): Comparable {
  const cuerpo = cuerpoComparable(texto);
  return { cuerpo, lineas: cuerpo === "" ? [] : cuerpo.split("\n").filter((l) => l.trim() !== "") };
}

/**
 * La similitud entre dos textos preparados (la métrica de la cabecera).
 *
 * El descarte por cantidad de líneas es **exacto**, no una aproximación: las
 * líneas en común nunca superan las de la nota más corta, así que la
 * similitud (`comunes / max`) nunca supera `min / max`. Si `min / max` ya está
 * por debajo del umbral, el par no puede llegar y no hace falta contar nada.
 * Solo afecta la comparación por líneas: la igualdad exacta se mira antes.
 * Los pares que no podrían llegar devuelven 0 (lo mismo que se descarta).
 */
function similitudPreparada(a: Comparable, b: Comparable, soloSiLlega: boolean): number {
  if (a.cuerpo === "" || b.cuerpo === "") return 0;
  if (a.cuerpo === b.cuerpo) return 1;
  const la = a.lineas;
  const lb = b.lineas;
  if (la.length < MIN_LINEAS || lb.length < MIN_LINEAS) return 0;
  const max = Math.max(la.length, lb.length);
  if (soloSiLlega && Math.min(la.length, lb.length) / max < UMBRAL_SIMILITUD) return 0;
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
  return comunes / max;
}

/** Qué tanto se parecen dos textos de nota, de 0 a 1 (ver la cabecera). */
export function similitud(a: string, b: string): number {
  return similitudPreparada(comparable(a), comparable(b), false);
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
 *
 * Corre en el hilo principal antes de indexar, y un `git checkout` o una
 * sincronización mete cientos de notas en una sola ráfaga (`FUN-M-58`). Antes
 * normalizaba los dos textos en cada par y comparaba todos los pares: con 150
 * idas y 150 llegadas, 10–12 s de app congelada; con 300, más de 45 s. Ahora
 * cada texto se prepara una vez y los pares cuyo largo hace imposible el
 * umbral se descartan sin contar líneas: 150 → ~0,1 s y 300 → ~0,2 s, con
 * el mismo resultado. Por encima de `MAX_PARES` no se ofrece nada.
 */
export function detectarRenombres(
  idas: readonly NotaConTexto[],
  nuevas: readonly NotaConTexto[],
): RenombreDetectado[] {
  if (idas.length === 0 || nuevas.length === 0) return [];
  if (idas.length * nuevas.length > MAX_PARES) return [];
  const prepIdas = idas.map((n) => comparable(n.contenido));
  const prepNuevas = nuevas.map((n) => comparable(n.contenido));
  const extNuevas = nuevas.map((n) => extension(n.id));
  const candidatos: RenombreDetectado[] = [];
  for (let i = 0; i < idas.length; i++) {
    const de = idas[i];
    const pd = prepIdas[i];
    if (pd.cuerpo === "") continue; // una vacía nunca empareja
    const ext = extension(de.id);
    for (let j = 0; j < nuevas.length; j++) {
      const a = nuevas[j];
      if (de.id === a.id || ext !== extNuevas[j]) continue;
      const s = similitudPreparada(pd, prepNuevas[j], true);
      if (s >= UMBRAL_SIMILITUD) candidatos.push({ de, a, similitud: s });
    }
  }
  candidatos.sort((x, y) => y.similitud - x.similitud);
  // El empate se mira contando, no buscando en la lista por cada candidato:
  // con muchas notas idénticas (plantillas recién creadas) los candidatos son
  // `idas × nuevas` y la búsqueda volvía la pasada cuadrática en ellos.
  const porNota = new Map<string, number>();
  const clave = (lado: "de" | "a", id: string, s: number) => `${lado}\u0000${id}\u0000${s}`;
  const sumar = (k: string) => porNota.set(k, (porNota.get(k) ?? 0) + 1);
  for (const c of candidatos) {
    sumar(clave("de", c.de.id, c.similitud));
    sumar(clave("a", c.a.id, c.similitud));
  }
  const usadas = new Set<string>();
  const salida: RenombreDetectado[] = [];
  for (const c of candidatos) {
    if (usadas.has(`de:${c.de.id}`) || usadas.has(`a:${c.a.id}`)) continue;
    // Hay otro candidato con la misma similitud que comparte la ida o la llegada.
    const empate =
      (porNota.get(clave("de", c.de.id, c.similitud)) ?? 0) > 1 ||
      (porNota.get(clave("a", c.a.id, c.similitud)) ?? 0) > 1;
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
