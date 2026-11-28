/**
 * Dónde está cada panel, en palabras (`FUN-S-44`), y el camino inverso: qué
 * panel quiso decir la IA con «derecha» o «arriba a la izquierda».
 *
 * Funciones puras sobre la **geometría del árbol de divisiones** de
 * `stores/tabsStore` (dirección y fracciones de cada división), sin medir el
 * DOM: el MCP de control las usa al informar los paneles y al resolver el
 * `panel` de `mycelium_abrir` y `mycelium_dividir`. Test:
 * `node --test scripts/test-posicion-paneles.mjs`.
 *
 * ## El algoritmo
 *
 * 1. **Rectángulo de cada hoja.** La raíz ocupa `[0,1]×[0,1]`. Una división
 *    `row` (lado a lado) reparte el ANCHO de su rectángulo entre sus hijos según
 *    `sizes` (normalizadas: si no suman 1 se reescalan); una `column` (una
 *    sobre otra) reparte el ALTO. Las hojas salen en el orden de `allLeaves`,
 *    que es el de los números de panel.
 * 2. **Palabra por eje, según los bordes que toca la hoja** (no según su centro:
 *    con un divisor arrastrado al 70/30, el centro del panel grande cae en el
 *    tercio del medio y se llamaría «centro» siendo el de la izquierda):
 *    - horizontal: toca el borde izquierdo y no el derecho → «izquierda»; el
 *      derecho y no el izquierdo → «derecha»; ninguno → «centro»; los dos → el
 *      eje no se nombra (ocupa todo el ancho: no hay nadie a sus costados).
 *    - vertical: lo mismo con «arriba», «abajo» y «centro».
 *    Así solo se nombran los ejes en los que el panel comparte espacio.
 * 3. **La frase.** Vertical + horizontal: «arriba a la izquierda», «abajo al
 *    centro», «centro a la derecha»; un eje solo: «izquierda», «abajo»,
 *    «centro»; centro y centro: «centro». Un solo panel: «único».
 *
 * Dos paneles pueden compartir posición (cuatro en fila: los dos del medio son
 * «centro»); el número los distingue, y pedir esa posición es `AMBIGUO`.
 */

/** Lo mínimo del árbol de `tabsStore` que importa para la geometría. */
export type NodoGeometria =
  | { type: "leaf"; id: string }
  | { type: "split"; direction: "row" | "column"; children: NodoGeometria[]; sizes: number[] };

export type Rect = { x: number; y: number; ancho: number; alto: number };
export type Horizontal = "izquierda" | "derecha" | "centro";
export type Vertical = "arriba" | "abajo" | "centro";
/** `null` en un eje = el panel ocupa todo ese eje (no se nombra). */
export type Ejes = { h: Horizontal | null; v: Vertical | null };
export type PanelUbicado = { id: string; rect: Rect; ejes: Ejes; posicion: string };

const EPS = 1e-6;

/** El rectángulo (en fracciones de la pantalla de pestañas) de cada hoja, en el orden de `allLeaves`. */
export function rectangulos(raiz: NodoGeometria, rect: Rect = { x: 0, y: 0, ancho: 1, alto: 1 }): { id: string; rect: Rect }[] {
  if (raiz.type === "leaf") return [{ id: raiz.id, rect }];
  const n = raiz.children.length;
  const crudas = raiz.children.map((_, i) => {
    const s = raiz.sizes[i];
    return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 1 / n;
  });
  const total = crudas.reduce((a, b) => a + b, 0) || 1;
  const fila = raiz.direction === "row";
  let desde = 0;
  return raiz.children.flatMap((hijo, i) => {
    const f = crudas[i] / total;
    const sub: Rect = fila
      ? { x: rect.x + desde * rect.ancho, y: rect.y, ancho: f * rect.ancho, alto: rect.alto }
      : { x: rect.x, y: rect.y + desde * rect.alto, ancho: rect.ancho, alto: f * rect.alto };
    desde += f;
    return rectangulos(hijo, sub);
  });
}

/** La palabra de cada eje según los bordes que toca el rectángulo. */
export function ejesDe(rect: Rect): Ejes {
  const izq = rect.x <= EPS;
  const der = rect.x + rect.ancho >= 1 - EPS;
  const arr = rect.y <= EPS;
  const aba = rect.y + rect.alto >= 1 - EPS;
  const h: Horizontal | null = izq && der ? null : izq ? "izquierda" : der ? "derecha" : "centro";
  const v: Vertical | null = arr && aba ? null : arr ? "arriba" : aba ? "abajo" : "centro";
  return { h, v };
}

/** La frase: «arriba a la izquierda», «derecha», «abajo al centro», «único». */
export function nombrarPosicion({ h, v }: Ejes): string {
  if (!h && !v) return "único";
  if (!v) return h!;
  if (!h) return v;
  if (v === "centro" && h === "centro") return "centro";
  return `${v} ${h === "centro" ? "al centro" : `a la ${h}`}`;
}

/** Cada hoja con su rectángulo y su posición en palabras, en el orden de los números de panel. */
export function ubicarPaneles(raiz: NodoGeometria): PanelUbicado[] {
  return rectangulos(raiz).map(({ id, rect }) => {
    const ejes = ejesDe(rect);
    return { id, rect, ejes, posicion: nombrarPosicion(ejes) };
  });
}

// ── El camino inverso: texto → panel ───────────────────────────────────────

/** Lo que pidió la IA, por eje. `centroSuelto`: un «centro» que no se sabe de qué eje es. */
export type ConsultaPosicion = { h: Horizontal | null; v: Vertical | null; centroSuelto: boolean; unico: boolean };

const SINONIMOS: Record<string, "izquierda" | "derecha" | "arriba" | "abajo" | "centro" | "unico"> = {
  izquierda: "izquierda", izquierdo: "izquierda", izq: "izquierda", izda: "izquierda", left: "izquierda",
  derecha: "derecha", derecho: "derecha", der: "derecha", dcha: "derecha", right: "derecha",
  arriba: "arriba", superior: "arriba", alto: "arriba", alta: "arriba", encima: "arriba", top: "arriba", up: "arriba",
  abajo: "abajo", inferior: "abajo", bajo: "abajo", baja: "abajo", debajo: "abajo", bottom: "abajo", down: "abajo",
  centro: "centro", central: "centro", medio: "centro", media: "centro", centrado: "centro", mitad: "centro",
  center: "centro", middle: "centro",
  unico: "unico", unica: "unico", solo: "unico", only: "unico",
};

/** Palabras que no dicen nada de la posición: se ignoran. */
const RELLENO = new Set([
  "la", "el", "lo", "los", "las", "de", "del", "a", "al", "en", "y", "que", "panel", "paneles", "pantalla",
  "lado", "parte", "zona", "esquina", "the", "pane", "side",
]);

/** Minúsculas, sin tildes, sin signos. */
function normalizar(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Interpreta «arriba izquierda», «Superior izquierdo», «la de la derecha»,
 * «centro inferior»… `null` si hay una palabra que no es de posición o si se
 * contradice («izquierda derecha»).
 */
export function interpretarPosicion(texto: string): ConsultaPosicion | null {
  const palabras = normalizar(texto).filter((p) => !RELLENO.has(p));
  if (palabras.length === 0) return null;
  let h: Horizontal | null = null;
  let v: Vertical | null = null;
  let centros = 0;
  let unico = false;
  for (const p of palabras) {
    const s = SINONIMOS[p];
    if (!s) return null;
    if (s === "unico") unico = true;
    else if (s === "centro") centros++;
    else if (s === "izquierda" || s === "derecha") {
      if (h && h !== s) return null;
      h = s;
    } else {
      if (v && v !== s) return null;
      v = s;
    }
  }
  if (unico) return h || v || centros ? null : { h: null, v: null, centroSuelto: false, unico: true };
  // Un «centro» va al eje que falta; si faltan los dos, queda suelto.
  if (centros > 0) {
    if (h && v) return null;
    if (h) v = "centro";
    else if (v) h = "centro";
  }
  const centroSuelto = centros > 0 && h === null && v === null;
  return { h, v, centroSuelto, unico: false };
}

/** Si el panel ubicado responde a la consulta. */
function coincide(c: ConsultaPosicion, p: PanelUbicado, total: number): boolean {
  if (c.unico) return total === 1;
  if (c.centroSuelto) return p.ejes.h === "centro" || p.ejes.v === "centro";
  return (c.h === null || p.ejes.h === c.h) && (c.v === null || p.ejes.v === c.v);
}

/**
 * Los índices (desde 0, en el orden de los números de panel) de los paneles que
 * responden a `texto`; `null` si el texto no es una posición. Un número escrito
 * como texto («2») vale como número.
 */
export function panelesEnPosicion(texto: string, paneles: PanelUbicado[]): number[] | null {
  const t = texto.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= paneles.length ? [n - 1] : [];
  }
  const c = interpretarPosicion(t);
  if (!c) return null;
  return paneles.flatMap((p, i) => (coincide(c, p, paneles.length) ? [i] : []));
}
