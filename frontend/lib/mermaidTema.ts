/**
 * Colores de los diagramas Mermaid a partir de los de Mycelium (`DEF-142`).
 *
 * Puro —sin imports ni DOM— para probarlo fuera de la app
 * (`scripts/test-mermaid-tema.mjs`). Quien lee los tokens `--mic-mermaid-*` de la
 * ventana y llama a Mermaid es `lib/mermaid.ts`.
 *
 * Mermaid no sigue el CSS de la página: cada diagrama sale con los colores que
 * recibe en `mermaid.initialize`. Sin esto usaba su tema claro de fábrica, y en
 * modo oscuro las cajas salían blancas y la flecha gris casi no se veía.
 */

/** Los tokens `--mic-mermaid-*` resueltos a `#rrggbb`. */
export type ColoresMermaid = {
  fondo: string;
  nodo: string;
  nodo2: string;
  grupo: string;
  borde: string;
  linea: string;
  texto: string;
};

/** Mínimos de contraste (WCAG 1.4.3 texto y 1.4.11 elementos gráficos). */
export const CONTRASTE_TEXTO = 4.5;
export const CONTRASTE_LINEA = 3;

type Rgb = [number, number, number];

/** `#rgb`, `#rrggbb` o `rgb(a)(r, g, b…)` → [r, g, b]. Otro formato → null. */
export function parsearColor(valor: string): Rgb | null {
  const v = valor.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as Rgb;
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as Rgb;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(255, Math.round(Number(n)))) as Rgb;
  return null;
}

const aHex = (c: Rgb): string =>
  "#" + c.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");

/** Mezcla `a` con `b`: `peso` es cuánto de `b` (0 → a, 1 → b). */
function mezclar(a: Rgb, b: Rgb, peso: number): Rgb {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * peso) as Rgb;
}

function luminancia(c: Rgb): number {
  const [r, g, b] = c.map((n) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores (1 a 21). */
export function contraste(a: string, b: string): number {
  const ca = parsearColor(a);
  const cb = parsearColor(b);
  if (!ca || !cb) return 1;
  const [l1, l2] = [luminancia(ca), luminancia(cb)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Acerca `color` a `hacia` lo justo para que llegue a `minimo` contra cada uno
 * de los `fondos`. Si ni `hacia` llega (un snippet con tinta y lienzo parecidos),
 * va al blanco o al negro, el que mejor quede contra el peor de los fondos. Con
 * fondos grises medios muy distintos entre sí puede no existir ningún color que
 * llegue: entonces devuelve ese extremo, que es lo más legible posible.
 */
export function asegurarContraste(
  color: string,
  fondos: string[],
  minimo: number,
  hacia: string,
): string {
  const pasa = (c: string) => fondos.every((f) => contraste(c, f) >= minimo);
  if (pasa(color)) return color;
  const origen = parsearColor(color) ?? [128, 128, 128];
  let destino = parsearColor(hacia);
  if (!destino || !pasa(hacia)) {
    const peor = (c: string) => Math.min(...fondos.map((f) => contraste(c, f)));
    destino = peor("#ffffff") >= peor("#000000") ? [255, 255, 255] : [0, 0, 0];
  }
  for (let paso = 1; paso <= 20; paso++) {
    const candidato = aHex(mezclar(origen, destino, paso / 20));
    if (pasa(candidato)) return candidato;
  }
  return aHex(destino);
}

/** Blanco o negro, el que mejor se lea sobre `fondo`. */
const tintaSobre = (fondo: string): string =>
  contraste("#ffffff", fondo) >= contraste("#000000", fondo) ? "#ffffff" : "#000000";

/**
 * Las `themeVariables` del tema `base` de Mermaid. Los colores que Mermaid no
 * recibe los deriva él de estos (gantt, git, pie…), con `darkMode` para saber
 * hacia dónde aclarar u oscurecer.
 *
 * El texto, las líneas y los bordes se corrigen si no llegan al contraste: los
 * tokens vienen de las fórmulas de `tokens.css`, pero un snippet puede pisarlos.
 */
export function variablesMermaid(
  entrada: ColoresMermaid,
  fuente?: string,
): Record<string, string | boolean> {
  const { fondo, nodo, nodo2, grupo } = entrada;
  const oscuro = luminancia(parsearColor(fondo) ?? [255, 255, 255]) < 0.4;
  const texto = asegurarContraste(entrada.texto, [fondo, nodo, nodo2, grupo], CONTRASTE_TEXTO, tintaSobre(fondo));
  const linea = asegurarContraste(entrada.linea, [fondo, grupo], CONTRASTE_LINEA, texto);
  const borde = asegurarContraste(entrada.borde, [fondo], CONTRASTE_LINEA, texto);

  const v: Record<string, string | boolean> = {
    darkMode: oscuro,
    background: fondo,

    primaryColor: nodo,
    primaryTextColor: texto,
    primaryBorderColor: borde,
    secondaryColor: nodo2,
    secondaryTextColor: texto,
    secondaryBorderColor: borde,
    tertiaryColor: grupo,
    tertiaryTextColor: texto,
    tertiaryBorderColor: linea,

    // Diagramas de flujo
    mainBkg: nodo,
    nodeBorder: borde,
    nodeTextColor: texto,
    textColor: texto,
    titleColor: texto,
    lineColor: linea,
    defaultLinkColor: linea,
    arrowheadColor: linea,
    clusterBkg: grupo,
    clusterBorder: linea,
    edgeLabelBackground: fondo,
    labelBackground: fondo,

    // Notas (secuencia, clases)
    noteBkgColor: grupo,
    noteTextColor: texto,
    noteBorderColor: linea,

    // Secuencia
    actorBkg: nodo,
    actorBorder: borde,
    actorTextColor: texto,
    actorLineColor: linea,
    signalColor: linea,
    signalTextColor: texto,
    labelBoxBkgColor: nodo,
    labelBoxBorderColor: borde,
    labelTextColor: texto,
    loopTextColor: texto,
    activationBkgColor: nodo2,
    activationBorderColor: borde,
    // El número va dentro de un círculo pintado con el color de la línea.
    sequenceNumberColor: tintaSobre(linea),

    // Estados y torta
    altBackground: grupo,
    pieTitleTextColor: texto,
    pieLegendTextColor: texto,
    pieStrokeColor: fondo,
    pieOuterStrokeColor: linea,
  };
  if (fuente) v.fontFamily = fuente;
  return v;
}
