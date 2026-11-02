/**
 * La geometría de las gráficas de la salud del vault (`FUN-L-32`, parte C):
 * escalas, arcos de los anillos, barras con el extremo redondeado, barras al
 * 100 % y apiladas, y los textos de cada valor. Módulo **puro** (sin React ni
 * DOM): lo usan los componentes de `components/salud/graficas/` y
 * `scripts/test-graficas.mjs` lo transpila e importa sin build.
 *
 * Reglas de dibujo (spec, «Estilo»): marcas finas, el extremo del dato con
 * 4 px de redondeo, 2 px de separación entre segmentos, y lo que vale 0 no se
 * dibuja (un tipo con cero archivos no aparece en las barras ni en el anillo).
 */
import { GRUPOS, NOMBRE_GRUPO, type ComposicionArchivos, type Cuenta, type GrupoArchivo } from "@/lib/estadisticas";
import { entero, pesoLegible, porcentaje, topeDeEje } from "@/lib/informeSalud";

/** Qué mide una gráfica de composición: el peso en disco o la cantidad de archivos. */
export type Medida = "bytes" | "cantidad";

/** Cómo se dibuja la composición en la pestaña. Se recuerda por vault. */
export type FormaComposicion = "anillos" | "barras";

export const FORMA_COMPOSICION_DEFECTO: FormaComposicion = "anillos";

export function formaValida(x: unknown): FormaComposicion {
  return x === "barras" ? "barras" : FORMA_COMPOSICION_DEFECTO;
}

/** Radio del extremo del dato. */
export const RADIO_EXTREMO = 4;
/** Separación entre segmentos contiguos, en px. */
export const SEPARACION = 2;

export const valorDe = (c: Cuenta, medida: Medida) => (medida === "bytes" ? c.bytes : c.cantidad);

/** El valor de una cuenta como texto: «312 MB» o «1.642». */
export const textoDe = (valor: number, medida: Medida) => (medida === "bytes" ? pesoLegible(valor) : entero(valor));

// ── Escalas ─────────────────────────────────────────────────────────────────

/**
 * Una escala lineal de 0 a un tope redondo (1, 2, 2,5 o 5 por una potencia de
 * 10, como los ejes del informe), con las marcas de la grilla en 0, la mitad y
 * el tope. Con `max <= 0` el tope es 1, y todo mide 0.
 */
export function escala(max: number, largo: number): { tope: number; marcas: number[]; px: (v: number) => number } {
  const tope = topeDeEje(max);
  return {
    tope,
    marcas: [0, tope / 2, tope],
    px: (v) => (v <= 0 ? 0 : Math.min(largo, (v / tope) * largo)),
  };
}

// ── Barras ──────────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Una barra horizontal que crece hacia la derecha: el lado izquierdo recto
 * (está apoyado en el eje o en el segmento anterior) y el derecho con
 * `RADIO_EXTREMO`, recortado si la barra es más chica que eso.
 */
export function barraHorizontal(x: number, y: number, w: number, h: number, radio = RADIO_EXTREMO): string {
  if (!(w > 0) || !(h > 0)) return "";
  const r = Math.min(radio, w / 2, h / 2);
  return (
    `M${r2(x)},${r2(y)}H${r2(x + w - r)}Q${r2(x + w)},${r2(y)} ${r2(x + w)},${r2(y + r)}` +
    `V${r2(y + h - r)}Q${r2(x + w)},${r2(y + h)} ${r2(x + w - r)},${r2(y + h)}H${r2(x)}Z`
  );
}

/** Una columna que crece hacia arriba: la base recta y la punta redondeada. */
export function barraVertical(x: number, y: number, w: number, h: number, radio = RADIO_EXTREMO): string {
  if (!(w > 0) || !(h > 0)) return "";
  const r = Math.min(radio, w / 2, h / 2);
  return (
    `M${r2(x)},${r2(y + h)}V${r2(y + r)}Q${r2(x)},${r2(y)} ${r2(x + r)},${r2(y)}` +
    `H${r2(x + w - r)}Q${r2(x + w)},${r2(y)} ${r2(x + w)},${r2(y + r)}V${r2(y + h)}Z`
  );
}

export type Tramo<K> = { clave: K; valor: number; x: number; w: number };

/**
 * Parte un largo en tramos proporcionales a sus valores, con `SEPARACION`
 * entre uno y otro. Los que valen 0 no aparecen. Un tramo que daría menos de
 * `minimo` px se agranda hasta ese mínimo (algo que hay no puede desaparecer),
 * y lo que suma de más se descuenta de los demás.
 */
export function tramos<K>(
  items: readonly { clave: K; valor: number }[],
  largo: number,
  { x0 = 0, separacion = SEPARACION, minimo = 1.5, escalaDe }: { x0?: number; separacion?: number; minimo?: number; escalaDe?: number } = {},
): Tramo<K>[] {
  const visibles = items.filter((i) => i.valor > 0);
  if (visibles.length === 0 || !(largo > 0)) return [];
  const total = escalaDe ?? visibles.reduce((s, i) => s + i.valor, 0);
  // Lo que hay para repartir: el largo proporcional (si la escala es de otro
  // total, la barra no llena el largo) menos las separaciones.
  const suma = visibles.reduce((s, i) => s + i.valor, 0);
  const util = Math.max(0, (suma / total) * largo - separacion * (visibles.length - 1));
  const crudos = visibles.map((i) => (i.valor / suma) * util);
  const chicos = crudos.filter((w) => w < minimo);
  const faltan = chicos.reduce((s, w) => s + (minimo - w), 0);
  const grandes = crudos.reduce((s, w) => s + (w >= minimo ? w : 0), 0);
  const factor = grandes > 0 ? Math.max(0, (grandes - faltan) / grandes) : 1;
  let x = x0;
  return visibles.map((i, k) => {
    const w = crudos[k] < minimo ? minimo : crudos[k] * factor;
    const t = { clave: i.clave, valor: i.valor, x, w };
    x += w + separacion;
    return t;
  });
}

// ── Anillos ─────────────────────────────────────────────────────────────────

export type Sector<K> = { clave: K; valor: number; a0: number; a1: number };

const DOS_PI = Math.PI * 2;

/**
 * Los sectores de un anillo, en radianes desde las 12 en sentido horario. Lo
 * que vale 0 no aparece. La separación de `separacionPx` se mide sobre
 * `radioMedio` y se quita mitad de cada lado, así se ve igual en los dos
 * anillos; un sector más chico que la separación queda como una raya de
 * `minimoRad`. Con un solo sector no hay separación: es el círculo entero.
 */
export function sectores<K>(
  items: readonly { clave: K; valor: number }[],
  radioMedio: number,
  { separacionPx = SEPARACION, minimoRad = 0.004 }: { separacionPx?: number; minimoRad?: number } = {},
): Sector<K>[] {
  const visibles = items.filter((i) => i.valor > 0);
  const total = visibles.reduce((s, i) => s + i.valor, 0);
  if (total <= 0) return [];
  if (visibles.length === 1) return [{ clave: visibles[0].clave, valor: visibles[0].valor, a0: 0, a1: DOS_PI }];
  const medio = radioMedio > 0 ? separacionPx / radioMedio / 2 : 0;
  let a = 0;
  return visibles.map((i) => {
    const barrido = (i.valor / total) * DOS_PI;
    let a0 = a + medio;
    let a1 = a + barrido - medio;
    if (a1 - a0 < minimoRad) {
      const centro = a + barrido / 2;
      a0 = centro - minimoRad / 2;
      a1 = centro + minimoRad / 2;
    }
    a += barrido;
    return { clave: i.clave, valor: i.valor, a0, a1 };
  });
}

/** Un punto a `r` del centro en el ángulo `a` (desde las 12, horario). */
export const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [
  r2(cx + r * Math.sin(a)),
  r2(cy - r * Math.cos(a)),
];

/**
 * El `d` de un sector de anillo entre los radios `r0` y `r1`. Si da la vuelta
 * entera, son dos medias vueltas (un arco SVG con el mismo inicio y fin no
 * dibuja nada) y el agujero va en sentido contrario.
 */
export function arcoAnillo(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  if (!(a1 > a0) || !(r1 > r0)) return "";
  if (a1 - a0 >= DOS_PI - 1e-6) {
    const [ax, ay] = polar(cx, cy, r1, 0);
    const [bx, by] = polar(cx, cy, r1, Math.PI);
    const [cx0, cy0] = polar(cx, cy, r0, 0);
    const [dx, dy] = polar(cx, cy, r0, Math.PI);
    return (
      `M${ax},${ay}A${r1},${r1} 0 1 1 ${bx},${by}A${r1},${r1} 0 1 1 ${ax},${ay}Z` +
      `M${cx0},${cy0}A${r0},${r0} 0 1 0 ${dx},${dy}A${r0},${r0} 0 1 0 ${cx0},${cy0}Z`
    );
  }
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  const [x1, y1] = polar(cx, cy, r1, a0);
  const [x2, y2] = polar(cx, cy, r1, a1);
  const [x3, y3] = polar(cx, cy, r0, a1);
  const [x4, y4] = polar(cx, cy, r0, a0);
  return `M${x1},${y1}A${r1},${r1} 0 ${grande} 1 ${x2},${y2}L${x3},${y3}A${r0},${r0} 0 ${grande} 0 ${x4},${y4}Z`;
}

/** Dónde va el nombre de un sector por fuera del anillo, y hacia qué lado se alinea. */
export function rotuloExterior(
  cx: number,
  cy: number,
  r: number,
  s: { a0: number; a1: number },
): { x: number; y: number; ancla: "start" | "middle" | "end" } {
  const a = (s.a0 + s.a1) / 2;
  const [x, y] = polar(cx, cy, r, a);
  const seno = Math.sin(a);
  return { x, y: r2(y + 4), ancla: seno > 0.25 ? "start" : seno < -0.25 ? "end" : "middle" };
}

/** Acorta un texto a `maximo` caracteres con «…». */
export function acortar(s: string, maximo: number): string {
  return s.length <= maximo ? s : `${s.slice(0, Math.max(1, maximo - 1)).trimEnd()}…`;
}

// ── Composición ─────────────────────────────────────────────────────────────

/** Nombres cortos de cada extensión, para las barras y la lista. */
const NOMBRE_EXTENSION: Readonly<Record<string, string>> = {
  md: "Notas",
  png: "Imágenes",
  jpg: "Imágenes",
  jpeg: "Imágenes",
  webp: "Imágenes",
  gif: "Imágenes",
  svg: "Imágenes",
  pdf: "PDF",
  excalidraw: "Dibujos",
  drawio: "Diagramas",
  canvas: "Lienzos",
  base: "Tablas",
};

/** «Imágenes», «Dibujos»… o «Otros» para una extensión sin nombre propio (o sin extensión: su rótulo lo dice). */
export const nombreDeExtension = (extension: string) =>
  extension === "" ? "Otros" : (NOMBRE_EXTENSION[extension] ?? "Otros");

/** «.png», o «sin extensión». */
export const rotuloExtension = (extension: string) => (extension === "" ? "sin extensión" : `.${extension}`);

export type FilaComposicion = {
  grupo: GrupoArchivo;
  nombre: string;
  /** Qué tipos hay adentro: «.md», «.png .jpg», «dibujos, lienzos». */
  detalle: string;
  valor: number;
  texto: string;
  porcentaje: string;
};

/**
 * Las filas de la lista de composición: los cinco grupos en el orden de la
 * paleta, con los tipos que tienen archivos. Un grupo vacío va igual, con 0,
 * para que la lista no cambie de forma entre un vault y otro.
 */
export function filasComposicion(a: ComposicionArchivos, medida: Medida): FilaComposicion[] {
  const total = valorDe(a.total, medida);
  return GRUPOS.map((g) => {
    const tipos = a.porTipo.filter((t) => t.grupo === g && t.cantidad > 0);
    const nombres = [...new Set(tipos.map((t) => nombreDeExtension(t.extension)))];
    // Si todos los tipos se llaman como el grupo («Imágenes»), se listan las extensiones.
    const detalle =
      nombres.length === 0
        ? "ninguno"
        : nombres.every((n) => n === NOMBRE_GRUPO[g])
          ? tipos.map((t) => rotuloExtension(t.extension)).join(" ")
          : nombres.map((n) => n.toLowerCase()).join(", ");
    const valor = valorDe(a.porGrupo[g], medida);
    return { grupo: g, nombre: NOMBRE_GRUPO[g], detalle, valor, texto: textoDe(valor, medida), porcentaje: porcentaje(valor, total) };
  });
}

/** Los tipos con archivos, de mayor a menor según la medida (las barras por tipo). */
export function tiposOrdenados(a: ComposicionArchivos, medida: Medida) {
  return a.porTipo
    .filter((t) => t.cantidad > 0)
    .sort((x, y) => valorDe(y, medida) - valorDe(x, medida) || y.cantidad - x.cantidad || (x.extension < y.extension ? -1 : 1));
}

/**
 * Las carpetas de primer nivel para una gráfica de `tope` filas: las más
 * pesadas, y el resto sumado en una última fila «Otras N carpetas».
 */
export function carpetasConResto<C extends { carpeta: string; cantidad: number; bytes: number; porGrupo: Record<GrupoArchivo, Cuenta> }>(
  carpetas: readonly C[],
  tope: number,
): { carpeta: string; cantidad: number; bytes: number; porGrupo: Record<GrupoArchivo, Cuenta>; resto: boolean }[] {
  if (carpetas.length <= tope) return carpetas.map((c) => ({ ...c, resto: false }));
  const visibles = carpetas.slice(0, tope - 1).map((c) => ({ ...c, resto: false }));
  const resto = carpetas.slice(tope - 1);
  const porGrupo = Object.fromEntries(GRUPOS.map((g) => [g, { cantidad: 0, bytes: 0 }])) as Record<GrupoArchivo, Cuenta>;
  let cantidad = 0;
  let bytes = 0;
  for (const c of resto) {
    cantidad += c.cantidad;
    bytes += c.bytes;
    for (const g of GRUPOS) {
      porGrupo[g].cantidad += c.porGrupo[g].cantidad;
      porGrupo[g].bytes += c.porGrupo[g].bytes;
    }
  }
  return [...visibles, { carpeta: `Otras ${resto.length} carpetas`, cantidad, bytes, porGrupo, resto: true }];
}

// ── Fechas y tiempos ────────────────────────────────────────────────────────

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** «mar» para `2026-03`. */
export function mesCorto(mes: string): string {
  const m = Number(mes.slice(5, 7));
  return MESES_CORTOS[m - 1] ?? mes;
}

/** «marzo de 2026» para `2026-03`. */
export function mesLargo(mes: string): string {
  const m = Number(mes.slice(5, 7));
  return MESES_LARGOS[m - 1] ? `${MESES_LARGOS[m - 1]} de ${mes.slice(0, 4)}` : mes;
}

const dos = (n: number) => String(n).padStart(2, "0");

/**
 * Cuándo se revisó, sin un reloj que lo actualice (nada corre en reposo,
 * `DEF-174`): «a las 14:32» si fue hoy, «ayer a las 9:05», o la fecha.
 */
export function cuandoSeReviso(iso: string, ahora: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hora = `${d.getHours()}:${dos(d.getMinutes())}`;
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(ahora) - dia(d)) / 86_400_000);
  if (dias === 0) return `a las ${hora}`;
  if (dias === 1) return `ayer a las ${hora}`;
  return `el ${d.getDate()} de ${MESES_LARGOS[d.getMonth()]} a las ${hora}`;
}

/** «0,4 s», «120 ms», «3 s». */
export function duracionLegible(ms: number): string {
  if (!(ms >= 0)) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return `${s >= 10 ? Math.round(s) : s.toFixed(1).replace(".", ",")} s`;
}

/** «1 nota», «12 notas». */
export const plural = (n: number, singular: string, pluralTexto: string) => `${entero(n)} ${n === 1 ? singular : pluralTexto}`;
