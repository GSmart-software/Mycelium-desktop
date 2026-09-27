/**
 * Dibujo de las disposiciones «micelio» del grafo global (`FUN-L-23`): anillo de
 * colonias, crecimiento y sustrato. El cúmulo conserva su dibujo de siempre en
 * `MiniGraph.tsx`; acá no se toca.
 *
 * Dos capas:
 *
 * - **Estática** (`dibujarCapaEstatica`): halo, arcos, hifas y nodos, a un canvas
 *   offscreen. Solo se repinta cuando cambia la vista, se mueven los nodos
 *   (Sustrato mientras no está en reposo), cambia lo revelado o cambia la
 *   preferencia. Es la propuesta 1 de `DEF-109` aplicada a estas disposiciones.
 * - **Sobrecapa** (`dibujarSobrecapa`): copia la estática y encima pinta el foco
 *   (el nodo apuntado, sus hifas y quienes lo referencian) y los nombres. Es lo
 *   único que se redibuja al mover el cursor.
 *
 * Referencia: `docs/design/demos/micelio-del-vault.html`, afinada por el usuario.
 */

import type { DisposicionGrafo, ModoNombresGrafo } from "@/stores/prefsVaultStore";
import {
  type GrafoIndexado,
  type LayoutAnillo,
  tinteColonia,
  UMBRAL_CUERPO_FRUCTIFERO,
} from "./disposiciones";

const TAU = Math.PI * 2;

/** Las disposiciones que dibuja este módulo: todas menos el cúmulo. */
export type DisposicionMicelio = Exclude<DisposicionGrafo, "cumulo">;

/** Cuánto tarda en crecer la hifa de una nota recién revelada (construcción temporal). */
export const CRECIMIENTO_HIFA_MS = 420;

/** Zoom, desplazamiento y tamaño del lienzo (en píxeles CSS) más el `devicePixelRatio`. */
export type Camara = {
  scale: number;
  ox: number;
  oy: number;
  ancho: number;
  alto: number;
  dpr: number;
};

/**
 * Colores ya resueltos. Se leen de los tokens en `MiniGraph.tsx` con
 * `getComputedStyle` (como hoy, `DEF-030`) y se pasan acá listos para usar.
 */
export type PaletaMicelio = {
  /** Hifas de Crecimiento: `--mic-glow` al 24 %. */
  hifa: string;
  /** Hifas del Sustrato: `--mic-glow` al 20 %. Donde se juntan muchas no deben tapar las esporas. */
  hifaSustrato: string;
  /** Aristas que cruzan de colonia en el anillo: `--mic-glow` al 7 %. */
  cruce: string;
  /** Halo difuso del Sustrato: `--mic-glow` al 10 %. */
  halo: string;
  /** Esporas: `--mic-glow`. */
  espora: string;
  /** Cuerpos fructíferos: crema, como el nodo central de hoy. */
  cuerpo: string;
  /** El nodo en foco. */
  foco: string;
  /** Sus hifas y quienes lo referencian: `--mic-accent`. */
  acento: string;
  texto: string;
  textoFoco: string;
  textoHub: string;
  fondoEtiqueta: string;
  fuente: string;
};

/** Todo lo que hace falta para dibujar un frame, sin estado propio del módulo. */
export type EscenaMicelio = {
  disposicion: DisposicionMicelio;
  g: GrafoIndexado;
  /** Posición actual de cada nodo (`x` en `2i`, `y` en `2i+1`). */
  pos: Float64Array;
  /** Radio de cada nodo en unidades de mundo. */
  radio: Float32Array;
  /** Solo en `anillo`: ángulos, radio y arcos de las colonias. */
  anillo: LayoutAnillo | null;
  /** Construcción temporal: se dibujan los nodos con `rango < limiteRango`. */
  limiteRango: number;
  /**
   * Instante (`performance.now()`) en que apareció cada nodo, o 0 si ya estaba:
   * sus hifas crecen desde ahí durante `CRECIMIENTO_HIFA_MS`. `null` = nada crece.
   */
  aparicion: Float64Array | null;
  /** `prefers-reduced-motion`: las hifas aparecen completas. */
  reducido: boolean;
  /** Color por id según los grupos de color del usuario. */
  colores: Map<string, string> | undefined;
};

/** Qué está en foco: el nodo apuntado, sus vecinos (ambas direcciones) y quienes lo referencian. */
export type FocoMicelio = {
  nodo: number;
  vecinos: Set<number>;
  refs: Set<number>;
};

// ── Sprites ──────────────────────────────────────────────────────────────────

/**
 * Caché de discos con brillo ya rasterizados, por la misma razón que en el
 * cúmulo: `shadowBlur` por nodo y por frame es de lo más caro del canvas 2D.
 * Tiene su propio caché porque el del cúmulo es privado de `MiniGraph.tsx`.
 */
const cacheSprites = new Map<string, HTMLCanvasElement>();
const SPRITES_MAX = 300;

export function spriteBrillo(color: string, rPix: number, blurPix: number): HTMLCanvasElement {
  const clave = `${color}|${rPix}|${blurPix}`;
  const hit = cacheSprites.get(clave);
  if (hit) return hit;
  if (cacheSprites.size > SPRITES_MAX) cacheSprites.clear();
  const lado = Math.ceil(2 * (rPix + blurPix) + 2);
  const s = document.createElement("canvas");
  s.width = lado;
  s.height = lado;
  const c = s.getContext("2d");
  if (c) {
    c.shadowColor = color;
    c.shadowBlur = blurPix;
    c.fillStyle = color;
    c.beginPath();
    c.arc(lado / 2, lado / 2, rPix, 0, TAU);
    c.fill();
  }
  cacheSprites.set(clave, s);
  return s;
}

// ── Color ────────────────────────────────────────────────────────────────────

/**
 * `color` con la opacidad indicada. El token puede venir en cualquier sintaxis
 * CSS, así que se normaliza pasándolo por `fillStyle`, que devuelve siempre
 * `#rrggbb` (o `rgba(...)` si ya traía alpha).
 */
export function conAlpha(ctx: CanvasRenderingContext2D, color: string, alpha: number): string {
  const previo = ctx.fillStyle;
  ctx.fillStyle = color;
  const norm = String(ctx.fillStyle);
  ctx.fillStyle = previo;
  if (norm.startsWith("#") && norm.length === 7) {
    const r = parseInt(norm.slice(1, 3), 16);
    const g = parseInt(norm.slice(3, 5), 16);
    const b = parseInt(norm.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const m = norm.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
  return color;
}

// ── Primitivas ───────────────────────────────────────────────────────────────

export function aplicarCamara(c: CanvasRenderingContext2D, cam: Camara) {
  c.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
  c.translate(cam.ancho / 2 + cam.ox, cam.alto / 2 + cam.oy);
  c.scale(cam.scale, cam.scale);
}

/** Rectángulo visible en coordenadas de mundo, con margen para brillos y etiquetas. */
function rectVisible(cam: Camara) {
  const m = 60 / cam.scale;
  return {
    l: (-cam.ancho / 2 - cam.ox) / cam.scale - m,
    r: (cam.ancho / 2 - cam.ox) / cam.scale + m,
    t: (-cam.alto / 2 - cam.oy) / cam.scale - m,
    b: (cam.alto / 2 - cam.oy) / cam.scale + m,
  };
}

/** Segmentos de una hifa en reposo y mientras los nodos se mueven. */
const PASOS_HIFA = 8;
const PASOS_HIFA_RAPIDA = 4;
// Arrays de trabajo de `hifa()`, reutilizados: antes se reservaban cuatro por
// hifa y por repintado (13.000 arrays para las 3.275 hifas de la Tesina).
const hx = new Float64Array(PASOS_HIFA + 1);
const hy = new Float64Array(PASOS_HIFA + 1);
const hnx = new Float64Array(PASOS_HIFA + 1);
const hny = new Float64Array(PASOS_HIFA + 1);

/**
 * Hifa ahusada: un polígono relleno a lo largo de una bézier cuadrática, con
 * ancho que va de `w0` a `w1` y un leve ondular para que no parezca una línea.
 * `frac` en `[0, 1]` dibuja solo el tramo inicial (la hifa creciendo).
 * `rapida` (los nodos se mueven): 4 segmentos y sin ondular; la curva y el
 * ahusamiento se conservan.
 */
export function hifa(
  c: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  w0: number,
  w1: number,
  semilla: number,
  frac: number,
  rapida = false,
) {
  const pasos = rapida ? PASOS_HIFA_RAPIDA : PASOS_HIFA;
  const L = Math.hypot(x1 - x0, y1 - y0);
  const amp = rapida ? 0 : Math.min(L * 0.045, 6);
  const px = hx;
  const py = hy;
  const nx = hnx;
  const ny = hny;
  for (let i = 0; i <= pasos; i++) {
    const t = (i / pasos) * frac;
    const u = 1 - t;
    let x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    let y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const dx = 2 * u * (cx - x0) + 2 * t * (x1 - cx);
    const dy = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
    const l = Math.hypot(dx, dy) || 1;
    const n1 = -dy / l;
    const n2 = dx / l;
    const ond = Math.sin(t * 9.4 + semilla) * amp * Math.sin(t * Math.PI);
    x += n1 * ond;
    y += n2 * ond;
    px[i] = x;
    py[i] = y;
    nx[i] = n1;
    ny[i] = n2;
  }
  c.beginPath();
  for (let i = 0; i <= pasos; i++) {
    const w = (w0 + (w1 - w0) * (i / pasos)) / 2;
    if (i === 0) c.moveTo(px[i] + nx[i] * w, py[i] + ny[i] * w);
    else c.lineTo(px[i] + nx[i] * w, py[i] + ny[i] * w);
  }
  for (let i = pasos; i >= 0; i--) {
    const w = (w0 + (w1 - w0) * (i / pasos)) / 2;
    c.lineTo(px[i] - nx[i] * w, py[i] - ny[i] * w);
  }
  c.closePath();
  c.fill();
}

// ── Capa estática ────────────────────────────────────────────────────────────

/** Cuánto creció ya la hifa de `u`: 1 = completa. */
function fraccionDe(e: EscenaMicelio, u: number, ahora: number) {
  if (!e.aparicion || e.reducido) return 1;
  const t = e.aparicion[u];
  return t ? Math.min(1, (ahora - t) / CRECIMIENTO_HIFA_MS) : 1;
}

/**
 * Pinta la capa estática completa en `c` (el contexto del canvas offscreen).
 * Devuelve `true` si alguna hifa sigue creciendo y hay que volver a pintar en el
 * próximo frame.
 */
export function dibujarCapaEstatica(
  c: CanvasRenderingContext2D,
  e: EscenaMicelio,
  cam: Camara,
  p: PaletaMicelio,
  ahora: number,
): boolean {
  const { g, pos } = e;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  aplicarCamara(c, cam);
  const v = rectVisible(cam);
  const s = cam.scale;
  const revelado = (u: number) => g.rango[u] < e.limiteRango;
  const dentro = (x: number, y: number) => x >= v.l && x <= v.r && y >= v.t && y <= v.b;
  const cruzaVista = (ax: number, ay: number, bx: number, by: number) =>
    !(Math.max(ax, bx) < v.l || Math.min(ax, bx) > v.r || Math.max(ay, by) < v.t || Math.min(ay, by) > v.b);
  let animando = false;

  if (e.disposicion === "sustrato") {
    // Un halo difuso por nodo, más grande en los hubs: le da cuerpo a las zonas
    // densas de la colonia.
    const sp = spriteBrillo(p.halo, 6, 26);
    for (let u = 0; u < g.n; u++) {
      if (!revelado(u)) continue;
      const x = pos[u * 2];
      const y = pos[u * 2 + 1];
      if (!dentro(x, y)) continue;
      const k = (18 + Math.min(g.conexiones[u], 60) * 1.2) * 2;
      c.drawImage(sp, x - k / 2, y - k / 2, k, k);
    }
  }

  if (e.disposicion === "anillo" && e.anillo) {
    const { ang, R, arcos } = e.anillo;
    // Arcos de las colonias, por fuera del anillo, con su tinte.
    c.lineWidth = 6;
    for (const a of arcos) {
      c.beginPath();
      c.arc(0, 0, R + 16, a.a0, a.a1);
      c.strokeStyle = tinteColonia(g.colonias[a.colonia].matiz, 50, 0.9);
      c.stroke();
    }
    // Aristas: dentro de una colonia se curvan cerca del borde con su tinte;
    // entre colonias pasan por el centro, tenues, y forman el tapiz pálido.
    c.lineWidth = Math.max(0.5, 0.9 / Math.sqrt(s));
    for (const [sI, tI] of g.aristas) {
      if (!revelado(sI) || !revelado(tI)) continue;
      const x0 = pos[sI * 2];
      const y0 = pos[sI * 2 + 1];
      const x1 = pos[tI * 2];
      const y1 = pos[tI * 2 + 1];
      c.beginPath();
      c.moveTo(x0, y0);
      if (g.colonia[sI] === g.colonia[tI]) {
        const am = (ang[sI] + ang[tI]) / 2;
        const sep = Math.abs(ang[sI] - ang[tI]);
        const r = R * Math.max(0.12, 1 - sep * 1.6);
        c.quadraticCurveTo(Math.cos(am) * r, Math.sin(am) * r, x1, y1);
        c.strokeStyle = tinteColonia(g.colonias[g.colonia[sI]].matiz, 66, 0.2);
      } else {
        c.bezierCurveTo(x0 * 0.12, y0 * 0.12, x1 * 0.12, y1 * 0.12, x1, y1);
        c.strokeStyle = p.cruce;
      }
      c.stroke();
    }
  } else {
    // Crecimiento y sustrato: cada enlace es una hifa de la nota vieja a la
    // nueva (así se ve hacia dónde creció), más fina en la punta.
    c.fillStyle = e.disposicion === "sustrato" ? p.hifaSustrato : p.hifa;
    for (const [sI, tI] of g.aristas) {
      if (!revelado(sI) || !revelado(tI)) continue;
      const viejo = g.rango[sI] <= g.rango[tI] ? sI : tI;
      const nuevo = viejo === sI ? tI : sI;
      const x0 = pos[viejo * 2];
      const y0 = pos[viejo * 2 + 1];
      const x1 = pos[nuevo * 2];
      const y1 = pos[nuevo * 2 + 1];
      if (!cruzaVista(x0, y0, x1, y1)) continue;
      const w0 = 0.6 + Math.min(g.conexiones[viejo], 40) * 0.05;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const dx = x1 - x0;
      const dy = y1 - y0;
      // Curvatura leve y determinista por arista, para que no salgan todas rectas.
      const curva = ((((sI * 7919) % 13) - 6) / 6) * 0.13;
      const f = fraccionDe(e, nuevo, ahora);
      if (f < 1) animando = true;
      hifa(c, x0, y0, mx - dy * curva, my + dx * curva, x1, y1, w0, 0.35, sI * 0.37, f);
    }
  }

  // Esporas y cuerpos fructíferos. El nodo aparece cuando su hifa termina de crecer.
  const pix = s * cam.dpr;
  for (let u = 0; u < g.n; u++) {
    if (!revelado(u)) continue;
    const x = pos[u * 2];
    const y = pos[u * 2 + 1];
    if (!dentro(x, y)) continue;
    if (fraccionDe(e, u, ahora) < 1) continue;
    const r = e.radio[u];
    const propio = e.colores?.get(g.ids[u]);
    if (g.conexiones[u] >= UMBRAL_CUERPO_FRUCTIFERO) {
      const rp = Math.max(1, Math.round(r * pix * 2) / 2);
      const sp = spriteBrillo(propio ?? p.cuerpo, rp, 14);
      const lado = sp.width / pix;
      c.drawImage(sp, x - lado / 2, y - lado / 2, lado, lado);
    } else {
      c.fillStyle = propio ?? p.espora;
      c.beginPath();
      // Alejado, una espora de 2 unidades desaparecería: al menos un píxel.
      c.arc(x, y, Math.max(r, 0.9 / s), 0, TAU);
      c.fill();
    }
  }
  return animando;
}

// ── Sobrecapa: foco y nombres ────────────────────────────────────────────────

/**
 * Copia la capa estática al canvas visible y pinta encima el foco y los nombres.
 * Los nombres van en **pantalla** (tamaño fijo, no escalan con el zoom) y no se
 * pisan: una etiqueta que solaparía a otra ya puesta no se dibuja, salvo la del
 * foco y las de sus vecinos.
 */
export function dibujarSobrecapa(
  ctx: CanvasRenderingContext2D,
  estatico: HTMLCanvasElement,
  e: EscenaMicelio,
  cam: Camara,
  p: PaletaMicelio,
  foco: FocoMicelio,
  modoNombres: ModoNombresGrafo,
  hubs: number[],
) {
  const { g, pos } = e;
  const s = cam.scale;
  const W = cam.ancho;
  const H = cam.alto;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(estatico, 0, 0);
  const revelado = (u: number) => g.rango[u] < e.limiteRango;
  const aPantalla = (u: number): [number, number] => [
    W / 2 + cam.ox + pos[u * 2] * s,
    H / 2 + cam.oy + pos[u * 2 + 1] * s,
  ];

  const hayFoco = foco.nodo >= 0 && revelado(foco.nodo);
  if (hayFoco) {
    const f = foco.nodo;
    aplicarCamara(ctx, cam);
    // Sus hifas, en el color de acento (son pocas: el blur acá sí se paga).
    ctx.strokeStyle = p.acento;
    ctx.lineWidth = 1.6 / s;
    ctx.lineCap = "round";
    ctx.shadowColor = p.acento;
    ctx.shadowBlur = 8;
    const x0 = pos[f * 2];
    const y0 = pos[f * 2 + 1];
    for (const v of foco.vecinos) {
      if (!revelado(v)) continue;
      const x1 = pos[v * 2];
      const y1 = pos[v * 2 + 1];
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      if (e.disposicion === "anillo") ctx.quadraticCurveTo(0, 0, x1, y1);
      else ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2, x1, y1);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // El foco en blanco; quienes lo referencian, en acento (como en el cúmulo).
    ctx.fillStyle = p.foco;
    ctx.beginPath();
    ctx.arc(x0, y0, e.radio[f] + 1.5 / s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.acento;
    for (const v of foco.refs) {
      if (!revelado(v)) continue;
      ctx.beginPath();
      ctx.arc(pos[v * 2], pos[v * 2 + 1], e.radio[v] + 0.8 / s, 0, TAU);
      ctx.fill();
    }
  }

  // Etiquetas en espacio de pantalla.
  ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const ocupados: [number, number, number, number][] = [];
  const rotular = (u: number, color: string, peso: number, forzar: boolean) => {
    const [x, y] = aPantalla(u);
    if (x < -10 || x > W + 10 || y < -10 || y > H + 10) return;
    const t = g.titulos[u];
    const dx = e.radio[u] * s + 5;
    ctx.font = `${peso} 11px ${p.fuente}`;
    const w = ctx.measureText(t).width;
    const caja: [number, number, number, number] = [x + dx - 2, y - 7, w + 4, 14];
    if (
      !forzar &&
      ocupados.some(
        (o) => caja[0] < o[0] + o[2] && caja[0] + caja[2] > o[0] && caja[1] < o[1] + o[3] && caja[1] + caja[3] > o[1],
      )
    ) {
      return;
    }
    ocupados.push(caja);
    ctx.fillStyle = p.fondoEtiqueta;
    ctx.fillRect(caja[0], caja[1], caja[2], caja[3]);
    ctx.fillStyle = color;
    ctx.fillText(t, x + dx, y);
  };

  if (modoNombres === "todos") {
    if (s >= 1.8) {
      // Cerca, todos los que entren (los hubs primero, para que ganen el sitio).
      let cuantos = 0;
      const primero = new Set(hubs);
      const candidatos = [...hubs, ...Array.from({ length: g.n }, (_, i) => i).filter((i) => !primero.has(i))];
      for (const u of candidatos) {
        if (cuantos >= 260) break;
        if (!revelado(u)) continue;
        const [x, y] = aPantalla(u);
        if (x < 0 || x > W || y < 0 || y > H) continue;
        rotular(u, primero.has(u) ? p.textoHub : p.texto, primero.has(u) ? 500 : 400, false);
        cuantos++;
      }
    } else if (s >= (e.disposicion === "anillo" ? 1.0 : 0.35)) {
      // Alejado, solo los hubs: con muchos nodos cada punto es pequeño y la
      // vista es para leer la estructura, no las notas.
      for (const u of hubs) if (revelado(u)) rotular(u, p.textoHub, 500, false);
    }
  }

  if (e.disposicion === "anillo" && e.anillo) {
    // El nombre de cada colonia por fuera del anillo, siempre legible.
    ctx.font = `500 12px ${p.fuente}`;
    ctx.textAlign = "center";
    const r = e.anillo.R + 62;
    for (const a of e.anillo.arcos) {
      const am = (a.a0 + a.a1) / 2;
      const x = W / 2 + cam.ox + Math.cos(am) * r * s;
      const y = H / 2 + cam.oy + Math.sin(am) * r * s;
      if (x < 0 || x > W || y < 0 || y > H) continue;
      const col = g.colonias[a.colonia];
      ctx.fillStyle = tinteColonia(col.matiz, 74, 1);
      ctx.fillText(col.nombre, x, y);
    }
    ctx.textAlign = "left";
  }

  // El foco y sus vecinos se rotulan siempre (salvo en «apuntado», solo el foco).
  if (hayFoco) {
    if (modoNombres !== "apuntado") {
      for (const v of foco.vecinos) if (revelado(v)) rotular(v, p.acento, 400, true);
    }
    rotular(foco.nodo, p.textoFoco, 500, true);
  }
}
