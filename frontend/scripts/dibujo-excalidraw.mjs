#!/usr/bin/env node
// Generador de dibujos `.excalidraw` para Mycelium (`FUN-L-26`, skill `mycelium-excalidraw`).
// Sin dependencias: viaja con la skill como `.claude/skills/mycelium-excalidraw/dibujo.mjs`.
//
// Uso: copialo junto a tu script, FUERA del vault (en el directorio temporal),
// importalo y corré el script desde la raíz del vault:
//
//   import { Dibujo, centro } from "./dibujo.mjs";
//   const d = new Dibujo();
//   const a = d.caja("Inicio", 200, 150), b = d.caja("Fin", 200, 300);
//   d.flecha(a, b);
//   d.guardar("Procesos/Ejemplo.excalidraw");
//
// Hace la geometría que se escribe mal a mano: tamaño de cada forma según su
// texto, extremos de flecha sobre el borde, enlaces recíprocos y escritura
// atómica. La disposición (dónde va cada centro) la decide quien lo usa.
import fs from "node:fs";

/** Separación entre la punta de una flecha y el borde de su forma. */
export const GAP = 8;
/** Separación mínima entre formas (regla de oro 6), entre BORDES. */
export const SEP_H = 60, SEP_V = 50;
const ANCHO = { 1: 0.6, 2: 0.55, 3: 0.6, 5: 0.6, 6: 0.55, 8: 0.6 }; // ancho por carácter / fontSize (con margen)
const ALTO = { 1: 1.25, 2: 1.15, 3: 1.2, 5: 1.25, 6: 1.35, 8: 1.25 }; // lineHeight de cada fuente
const FORMAS = new Set(["rectangle", "ellipse", "diamond", "image", "embeddable", "iframe"]);
const azar = () => Math.floor(Math.random() * 2 ** 31);
const par = (n) => 2 * Math.ceil(n / 2); // tamaños pares → el centro de la forma cae en un entero
const r2 = (n) => Math.round(n * 100) / 100;
const normal = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

/** Tamaño que ocupa un texto (cota con margen). */
export function medir(texto, fontSize = 20, fontFamily = 5) {
  const lineas = texto.split("\n");
  return {
    w: Math.ceil(Math.max(...lineas.map((l) => [...l].length)) * fontSize * (ANCHO[fontFamily] ?? 0.6)),
    h: Math.ceil(lineas.length * fontSize * (ALTO[fontFamily] ?? 1.25)),
  };
}

/** Tamaño de forma para que la etiqueta entre con aire (el que usa `caja`). */
export function tamanoPara(tipo, texto, fontSize = 20, fontFamily = 5) {
  const m = medir(texto || " ", fontSize, fontFamily);
  if (tipo === "ellipse") return { w: par((m.w + 30) * 1.42), h: par((m.h + 20) * 1.42) };
  if (tipo === "diamond") return { w: par(2 * (m.w + 30)), h: par(2 * (m.h + 20)) };
  return { w: par(m.w + 40), h: par(m.h + 30) };
}

export const centro = (f) => ({ x: f.x + f.width / 2, y: f.y + f.height / 2 });

/** Distancia del centro al borde de la forma en la dirección unitaria (dx, dy). */
function alBorde(f, dx, dy) {
  const a = f.width / 2, b = f.height / 2;
  if (f.type === "ellipse") return 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  if (f.type === "diamond") return 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  return Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity);
}

/** Punto a GAP del borde de `f`, sobre la recta que va del centro de `f` hacia `hacia`. */
export function puntoDeBorde(f, hacia) {
  const c = centro(f);
  const L = Math.hypot(hacia.x - c.x, hacia.y - c.y) || 1;
  const dx = (hacia.x - c.x) / L, dy = (hacia.y - c.y) / L;
  const t = alBorde(f, dx, dy) + GAP;
  return { x: r2(c.x + dx * t), y: r2(c.y + dy * t) };
}

export class Dibujo {
  constructor(elementos = [], resto = {}) {
    this.elementos = elementos;
    this.resto = resto; // appState, files y campos que no tocamos
    // El contador de ids sigue después de los que ya hay (los de este generador
    // son `<tipo>-<n>-<azar>`), así un id nuevo nunca se confunde con uno viejo.
    this.n = elementos.reduce((m, e) => Math.max(m, +(/^[a-z]+-(\d+)-/.exec(e.id ?? "")?.[1] ?? 0)), elementos.length);
  }

  static desde(ruta) {
    const texto = fs.readFileSync(ruta, "utf8");
    const j = texto.trim() ? JSON.parse(texto) : {};
    const { elements = [], ...resto } = j;
    return new Dibujo(elements, resto);
  }

  id(prefijo) {
    let id;
    do id = prefijo + "-" + (++this.n) + "-" + azar().toString(36).slice(0, 4);
    while (this.porId(id));
    return id;
  }
  porId(id) { return this.elementos.find((e) => e.id === id && !e.isDeleted); }
  /** Formas vivas (rectángulos, elipses, rombos, imágenes): sin textos, flechas ni marcos. */
  formas() { return this.elementos.filter((e) => FORMAS.has(e.type) && !e.isDeleted); }
  /**
   * Forma (o texto suelto) cuyo texto visible es `t`. Compara sin mirar saltos de
   * línea ni espacios repetidos («Pedir al proveedor» encuentra «Pedir al\nproveedor»),
   * y si no hay coincidencia exacta, sin mayúsculas. Si hay más de una, falla: usá `porId`.
   */
  buscar(t) {
    const textos = this.elementos.filter((e) => e.type === "text" && !e.isDeleted);
    let hallados = textos.filter((e) => normal(e.originalText ?? e.text) === normal(t));
    if (!hallados.length) hallados = textos.filter((e) => normal(e.originalText ?? e.text).toLowerCase() === normal(t).toLowerCase());
    if (hallados.length > 1) throw new Error(`buscar(${JSON.stringify(t)}): hay ${hallados.length} textos iguales (${hallados.map((e) => e.id).join(", ")}); usá porId`);
    const txt = hallados[0];
    if (!txt) return undefined;
    return txt.containerId ? this.porId(txt.containerId) : txt;
  }
  /** El texto (etiqueta) de una forma o flecha, o undefined. */
  textoDe(f) {
    const b = (f.boundElements || []).find((x) => x.type === "text");
    return b && this.porId(b.id);
  }
  /** Las flechas que van de `a` a `b` (en ese sentido). */
  flechasEntre(a, b) {
    return this.elementos.filter((e) => e.type === "arrow" && !e.isDeleted && e.startBinding?.elementId === a.id && e.endBinding?.elementId === b.id);
  }

  base(type, x, y, width, height, extra = {}) {
    const e = {
      id: this.id(type), type, x, y, width, height, angle: 0,
      strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
      strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100,
      groupIds: [], frameId: null, roundness: null,
      seed: azar(), version: 1, versionNonce: azar(), isDeleted: false,
      boundElements: [], updated: Date.now(), link: null, locked: false,
      ...extra,
    };
    this.elementos.push(e);
    return e;
  }

  /** Texto suelto. (x, y) es su esquina superior izquierda. */
  texto(t, x, y, o = {}) {
    const fontSize = o.fontSize ?? 20, fontFamily = o.fontFamily ?? 5;
    const m = medir(t, fontSize, fontFamily);
    return this.base("text", x, y, m.w, m.h, {
      text: t, originalText: t, fontSize, fontFamily, textAlign: o.alinear ?? "left",
      verticalAlign: "top", containerId: null, lineHeight: ALTO[fontFamily] ?? 1.25, autoResize: true,
      strokeColor: o.color ?? "#1e1e1e",
    });
  }

  /**
   * Forma con etiqueta centrada. (cx, cy) es el CENTRO de la forma (se redondea a
   * entero, y el tamaño es par: el centro queda exacto y los tramos horizontales,
   * horizontales). `ancho`/`alto` son MÍNIMOS: la forma crece si el texto no entra.
   */
  caja(etiqueta, cx, cy, o = {}) {
    const type = o.forma ?? "rectangle";
    const fontSize = o.fontSize ?? 20, fontFamily = o.fontFamily ?? 5;
    const auto = tamanoPara(type, etiqueta, fontSize, fontFamily);
    const w = par(Math.max(o.ancho ?? 0, auto.w)), h = par(Math.max(o.alto ?? 0, auto.h));
    cx = Math.round(cx); cy = Math.round(cy);
    const f = this.base(type, cx - w / 2, cy - h / 2, w, h, {
      strokeColor: o.borde ?? "#1e1e1e", backgroundColor: o.fondo ?? "transparent",
      roundness: type === "rectangle" ? { type: 3 } : { type: 2 },
      strokeStyle: o.trazo ?? "solid", roughness: o.rugosidad ?? 1,
    });
    if (etiqueta) this.etiquetar(f, etiqueta, { fontSize, fontFamily, color: o.color });
    return f;
  }

  /**
   * Forma nueva al lado de `ref` («abajo», «arriba», «derecha» o «izquierda»),
   * alineada con su centro y a `o.sep` px entre BORDES (por defecto, la regla 6:
   * 50 en vertical, 60 en horizontal; pasá 120 si la flecha que las une lleva
   * etiqueta). Acepta las mismas opciones que `caja`.
   */
  junto(ref, lado, etiqueta, o = {}) {
    const t = tamanoPara(o.forma ?? "rectangle", etiqueta, o.fontSize ?? 20, o.fontFamily ?? 5);
    const w = par(Math.max(o.ancho ?? 0, t.w)), h = par(Math.max(o.alto ?? 0, t.h));
    const c = centro(ref), v = lado === "abajo" || lado === "arriba";
    const sep = o.sep ?? (v ? SEP_V : SEP_H), s = lado === "abajo" || lado === "derecha" ? 1 : -1;
    const cx = v ? c.x : c.x + s * (ref.width / 2 + sep + w / 2);
    const cy = v ? c.y + s * (ref.height / 2 + sep + h / 2) : c.y;
    return this.caja(etiqueta, cx, cy, o);
  }

  /** Texto dentro de un contenedor (forma o flecha): enlace recíproco y centrado. */
  etiquetar(cont, etiqueta, o = {}) {
    const fontSize = o.fontSize ?? (cont.type === "arrow" ? 16 : 20), fontFamily = o.fontFamily ?? 5;
    const m = medir(etiqueta, fontSize, fontFamily);
    const c = cont.type === "arrow" ? this.medioDeFlecha(cont) : centro(cont);
    const t = this.base("text", r2(c.x - m.w / 2), r2(c.y - m.h / 2), m.w, m.h, {
      text: etiqueta, originalText: etiqueta, fontSize, fontFamily,
      textAlign: "center", verticalAlign: "middle", containerId: cont.id,
      lineHeight: ALTO[fontFamily] ?? 1.25, autoResize: true, strokeColor: o.color ?? "#1e1e1e",
      groupIds: [...cont.groupIds], frameId: cont.frameId,
    });
    cont.boundElements = [...(cont.boundElements || []), { id: t.id, type: "text" }];
    return t;
  }

  medioDeFlecha(a) {
    const p = a.points, n = p.length;
    if (n % 2 === 1) { const q = p[(n - 1) / 2]; return { x: a.x + q[0], y: a.y + q[1] }; }
    const q1 = p[n / 2 - 1], q2 = p[n / 2];
    return { x: a.x + (q1[0] + q2[0]) / 2, y: a.y + (q1[1] + q2[1]) / 2 };
  }

  /**
   * Flecha enlazada de `desde` a `hasta` (formas o textos sueltos). `o.via`: puntos
   * intermedios ABSOLUTOS [{x,y}] para rodear obstáculos (tramos rectos, salvo
   * `o.curva`); `o.etiqueta`; `o.trazo`: "dashed". Si las dos formas están en el
   * mismo marco, la flecha y su etiqueta también.
   */
  flecha(desde, hasta, o = {}) {
    const mismoMarco = desde.frameId && desde.frameId === hasta.frameId ? desde.frameId : null;
    const a = this.base("arrow", 0, 0, 0, 0, {
      points: [[0, 0], [1, 1]], roundness: o.via && !o.curva ? null : { type: 2 },
      strokeColor: o.color ?? "#1e1e1e", strokeStyle: o.trazo ?? "solid",
      startBinding: { elementId: desde.id, focus: 0, gap: GAP },
      endBinding: { elementId: hasta.id, focus: 0, gap: GAP },
      startArrowhead: o.puntaInicio ?? null, endArrowhead: o.puntaFin === undefined ? "arrow" : o.puntaFin,
      elbowed: false, frameId: mismoMarco,
    });
    desde.boundElements = [...(desde.boundElements || []), { id: a.id, type: "arrow" }];
    hasta.boundElements = [...(hasta.boundElements || []), { id: a.id, type: "arrow" }];
    this.trazar(a, o.via ?? []);
    if (o.etiqueta) this.etiquetar(a, o.etiqueta, { fontFamily: o.fontFamily, color: o.color });
    return a;
  }

  /** Puntos intermedios de una flecha, en coordenadas absolutas. */
  via(a) { return a.points.slice(1, -1).map(([px, py]) => ({ x: a.x + px, y: a.y + py })); }

  /**
   * Recalcula los extremos de una flecha enlazada (y recoloca su etiqueta).
   * `via`: puntos intermedios absolutos nuevos; sin `via`, conserva los que tiene.
   * `trazar(a, [])` la deja recta.
   */
  trazar(a, via) {
    const s = a.startBinding && this.porId(a.startBinding.elementId);
    const e = a.endBinding && this.porId(a.endBinding.elementId);
    const abs = a.points.map(([px, py]) => ({ x: a.x + px, y: a.y + py }));
    const medio = via ?? abs.slice(1, -1);
    const fin0 = e ? centro(e) : abs[abs.length - 1];
    const ini0 = s ? centro(s) : abs[0];
    const p1 = s ? puntoDeBorde(s, medio[0] ?? fin0) : ini0;
    const p2 = e ? puntoDeBorde(e, medio[medio.length - 1] ?? ini0) : fin0;
    const todos = [p1, ...medio, p2];
    a.x = p1.x; a.y = p1.y;
    a.points = todos.map((p) => [r2(p.x - p1.x), r2(p.y - p1.y)]);
    const xs = a.points.map((p) => p[0]), ys = a.points.map((p) => p[1]);
    a.width = r2(Math.max(...xs) - Math.min(...xs));
    a.height = r2(Math.max(...ys) - Math.min(...ys));
    this.tocar(a);
    const t = this.textoDe(a);
    if (t) { const c = this.medioDeFlecha(a); t.x = r2(c.x - t.width / 2); t.y = r2(c.y - t.height / 2); this.tocar(t); }
  }

  /**
   * Mueve una forma (o varias: pasá un array) con su texto y reengancha sus
   * flechas. Los puntos intermedios de una flecha se corren así:
   * - si las dos puntas se mueven juntas, todos, lo mismo que las formas;
   * - si se mueve una sola, el punto intermedio vecino a esa punta copia el
   *   desplazamiento en el eje en que estaba ALINEADO con su centro (mismo x o
   *   mismo y): un retorno con codos sigue siendo ortogonal.
   * Si el recorrido ya no sirve, rehacelo con `trazar(flecha, via)`.
   */
  mover(formas, dx, dy) {
    const lista = Array.isArray(formas) ? formas : [formas];
    const ids = new Set(lista.map((f) => f.id));
    const antes = new Map(lista.map((f) => [f.id, centro(f)]));
    for (const f of lista) {
      f.x += dx; f.y += dy; this.tocar(f);
      const t = this.textoDe(f);
      if (t) { t.x += dx; t.y += dy; this.tocar(t); }
    }
    const flechas = new Set();
    for (const f of lista) for (const b of f.boundElements || []) {
      const a = this.porId(b.id);
      if (a && a.type === "arrow") flechas.add(a);
    }
    for (const a of flechas) {
      const via = this.via(a);
      const s = a.startBinding?.elementId, e = a.endBinding?.elementId;
      if (via.length) {
        if (ids.has(s) && ids.has(e)) for (const p of via) { p.x += dx; p.y += dy; }
        else {
          const [p, c] = ids.has(s) ? [via[0], antes.get(s)] : [via[via.length - 1], antes.get(e)];
          if (Math.abs(p.x - c.x) < 1) p.x += dx;
          if (Math.abs(p.y - c.y) < 1) p.y += dy;
        }
      }
      this.trazar(a, via);
    }
  }

  /**
   * Cambia una punta de una flecha a otra forma: `{ desde }` y/o `{ hasta }`.
   * Actualiza el binding, los `boundElements` de la forma vieja y de la nueva, y
   * el trazo: recto, salvo que pases `via`.
   */
  reconectar(a, { desde, hasta, via } = {}) {
    const cambiar = (lado, nueva) => {
      const vieja = a[lado] && this.porId(a[lado].elementId);
      const otroLado = lado === "startBinding" ? "endBinding" : "startBinding";
      if (vieja && a[otroLado]?.elementId !== vieja.id) {
        vieja.boundElements = (vieja.boundElements || []).filter((b) => b.id !== a.id);
        this.tocar(vieja);
      }
      a[lado] = { elementId: nueva.id, focus: 0, gap: GAP };
      if (!(nueva.boundElements || []).some((b) => b.id === a.id)) {
        nueva.boundElements = [...(nueva.boundElements || []), { id: a.id, type: "arrow" }];
      }
      this.tocar(nueva);
    };
    if (desde) cambiar("startBinding", desde);
    if (hasta) cambiar("endBinding", hasta);
    this.trazar(a, via ?? []);
    return a;
  }

  /** Borra una forma, su texto y las flechas que la tocan, limpiando las referencias. */
  borrar(f) {
    const fuera = new Set([f.id]);
    for (const b of f.boundElements || []) fuera.add(b.id);
    for (const id of [...fuera]) { const x = this.porId(id); const t = x && x.type === "arrow" && this.textoDe(x); if (t) fuera.add(t.id); }
    this.elementos = this.elementos.filter((e) => !fuera.has(e.id));
    for (const e of this.elementos) {
      if (e.boundElements && e.boundElements.some((b) => fuera.has(b.id))) {
        e.boundElements = e.boundElements.filter((b) => !fuera.has(b.id)); this.tocar(e);
      }
    }
  }

  /** Marca un elemento como modificado: sube `version`, cambia `versionNonce` y `updated`. */
  tocar(e) { e.version = (e.version || 1) + 1; e.versionNonce = azar(); e.updated = Date.now(); }

  /** Agrupa formas (con su texto): se seleccionan y mueven juntas. */
  agrupar(formas) {
    const g = this.id("grupo");
    for (const f of formas) { f.groupIds = [...f.groupIds, g]; const t = this.textoDe(f); if (t) t.groupIds = [...t.groupIds, g]; }
    return g;
  }

  /**
   * Marco con nombre alrededor de `formas` (con margen). Entran al marco las
   * formas, sus textos y las flechas que unen dos formas del marco (con su
   * etiqueta); una flecha que cruza el borde queda afuera, porque el marco
   * recorta a sus hijos. El nombre se dibuja ENCIMA del borde superior.
   */
  marco(nombre, formas, margen = 40) {
    const m = this.base("frame", 0, 0, 1, 1, { name: nombre, roughness: 0, strokeWidth: 2 });
    return this.enMarco(m, formas, margen);
  }

  /** Mete formas (con su texto) en un marco existente y lo agranda para abarcarlas. */
  enMarco(m, formas, margen = 40) {
    for (const f of formas) {
      f.frameId = m.id; this.tocar(f);
      const t = this.textoDe(f);
      if (t) { t.frameId = m.id; this.tocar(t); }
    }
    return this.encuadrar(m, margen);
  }

  /**
   * Ajusta el marco a sus hijos (con margen) y reasigna sus flechas: adentro las
   * que unen dos hijos, afuera las que cruzan el borde. Usalo después de mover o
   * agregar formas a un marco.
   */
  encuadrar(m, margen = 40) {
    const hijos = this.formas().filter((f) => f.frameId === m.id);
    if (!hijos.length) return m;
    const x1 = Math.min(...hijos.map((f) => f.x)) - margen, y1 = Math.min(...hijos.map((f) => f.y)) - margen;
    const x2 = Math.max(...hijos.map((f) => f.x + f.width)) + margen, y2 = Math.max(...hijos.map((f) => f.y + f.height)) + margen;
    Object.assign(m, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
    this.tocar(m);
    const dentro = new Set(hijos.map((f) => f.id));
    for (const a of this.elementos.filter((e) => e.type === "arrow" && !e.isDeleted)) {
      const adentro = dentro.has(a.startBinding?.elementId) && dentro.has(a.endBinding?.elementId);
      const frameId = adentro ? m.id : a.frameId === m.id ? null : a.frameId;
      if (frameId === a.frameId) continue;
      a.frameId = frameId; this.tocar(a);
      const t = this.textoDe(a);
      if (t) { t.frameId = frameId; this.tocar(t); }
    }
    return m;
  }

  guardar(ruta) {
    const j = { type: "excalidraw", version: 2, source: "mycelium", ...this.resto, elements: this.elementos };
    j.appState = j.appState ?? {}; j.files = j.files ?? {};
    const tmp = ruta + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
    fs.renameSync(tmp, ruta); // escritura atómica: Mycelium nunca ve un JSON a medias
  }
}
