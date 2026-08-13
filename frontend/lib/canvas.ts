/**
 * Canvas (`FUN-L-18`): un lienzo infinito donde poner notas y textos en el
 * espacio y conectarlos con flechas. Ver `docs/features/canvas.md`.
 *
 * Se adopta **JSON Canvas 1.0** —el formato de Obsidian— por cuarta vez el mismo
 * criterio: que el vault siga siendo intercambiable. El esquema se verificó
 * contra la especificación publicada antes de escribir esto, que es justo lo que
 * la spec dejó anotado como trampa.
 *
 * > [!danger] Lo que no se entiende se CONSERVA, no se descarta
 * > Un `.canvas` hecho en Obsidian puede traer nodos `link` y `group`, colores,
 * > `subpath`, `label` en las flechas… Mycelium todavía no los edita, pero
 * > guardarlos sin ellos **perdería trabajo del usuario en silencio**. Por eso el
 * > parser conserva el objeto crudo de cada nodo y arista, y al serializar
 * > escribe encima solo los campos que sí maneja.
 *
 * > OJO: este módulo es **puro y sin imports** a propósito — así
 * > `scripts/test-canvas.mjs` puede transpilarlo e importarlo sin build, igual
 * > que `lib/frontmatter.ts`, `lib/esporas.ts`, `lib/bases.ts` y `lib/enlaces.ts`.
 */

export const EXTENSION_CANVAS = ".canvas";

/** Lados por los que una flecha se engancha a un nodo. */
export type Lado = "top" | "right" | "bottom" | "left";

/** Punta de una flecha. En el formato, `toEnd` es `arrow` por defecto. */
export type Punta = "none" | "arrow";

export type TipoNodo = "text" | "file" | "link" | "group";

/**
 * Un nodo del canvas. `crudo` guarda el objeto tal como venía del archivo para
 * poder devolverlo intacto: es lo que hace que abrir y guardar un canvas ajeno no
 * le quite nada.
 */
export type Nodo = {
  id: string;
  tipo: TipoNodo;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  color?: string;
  /** `text`: markdown. */
  texto?: string;
  /** `file`: ruta de la nota, y ancla opcional dentro de ella. */
  archivo?: string;
  subpath?: string;
  /** `link`: la URL. */
  url?: string;
  /** `group`: su etiqueta. */
  etiqueta?: string;
  crudo: Record<string, unknown>;
};

export type Arista = {
  id: string;
  desdeNodo: string;
  desdeLado?: Lado;
  desdePunta?: Punta;
  hastaNodo: string;
  hastaLado?: Lado;
  hastaPunta?: Punta;
  color?: string;
  etiqueta?: string;
  crudo: Record<string, unknown>;
};

export type Canvas = { nodos: Nodo[]; aristas: Arista[] };

export class ErrorCanvas extends Error {}

const LADOS: Lado[] = ["top", "right", "bottom", "left"];
const esLado = (v: unknown): v is Lado => typeof v === "string" && LADOS.includes(v as Lado);
const esPunta = (v: unknown): v is Punta => v === "none" || v === "arrow";

const num = (v: unknown, defecto = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : defecto;

const texto = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// ── Lectura ───────────────────────────────────────────────────────────────────

/**
 * Parsea un `.canvas`. Un archivo vacío es un canvas vacío (así se crea uno
 * nuevo sin caso especial); un JSON inválido sí es un error, porque guardarlo
 * encima destruiría lo que hubiera.
 */
export function parsearCanvas(json: string): Canvas {
  if (json.trim() === "") return { nodos: [], aristas: [] };

  let raiz: unknown;
  try {
    raiz = JSON.parse(json);
  } catch (e) {
    throw new ErrorCanvas(`El archivo no es JSON válido: ${e instanceof Error ? e.message : e}`);
  }
  if (typeof raiz !== "object" || raiz === null || Array.isArray(raiz)) {
    throw new ErrorCanvas("Un canvas debe ser un objeto con `nodes` y `edges`.");
  }

  const obj = raiz as { nodes?: unknown; edges?: unknown };
  const nodos: Nodo[] = [];
  const aristas: Arista[] = [];

  if (Array.isArray(obj.nodes)) {
    for (const n of obj.nodes) {
      if (typeof n !== "object" || n === null) continue;
      const c = n as Record<string, unknown>;
      const id = texto(c.id);
      if (id === undefined) continue; // sin id no se puede referenciar ni dibujar
      const tipoBruto = texto(c.type) ?? "text";
      nodos.push({
        id,
        tipo: (["text", "file", "link", "group"].includes(tipoBruto)
          ? tipoBruto
          : "text") as TipoNodo,
        x: num(c.x),
        y: num(c.y),
        ancho: num(c.width, 250),
        alto: num(c.height, 60),
        color: texto(c.color),
        texto: texto(c.text),
        archivo: texto(c.file),
        subpath: texto(c.subpath),
        url: texto(c.url),
        etiqueta: texto(c.label),
        crudo: c,
      });
    }
  }

  if (Array.isArray(obj.edges)) {
    const ids = new Set(nodos.map((n) => n.id));
    for (const e of obj.edges) {
      if (typeof e !== "object" || e === null) continue;
      const c = e as Record<string, unknown>;
      const id = texto(c.id);
      const desdeNodo = texto(c.fromNode);
      const hastaNodo = texto(c.toNode);
      if (id === undefined || desdeNodo === undefined || hastaNodo === undefined) continue;
      // Una flecha a un nodo que no existe no se puede dibujar. Se descarta acá y
      // no al guardar, porque conservarla dejaría un archivo que se ve roto.
      if (!ids.has(desdeNodo) || !ids.has(hastaNodo)) continue;
      aristas.push({
        id,
        desdeNodo,
        desdeLado: esLado(c.fromSide) ? c.fromSide : undefined,
        desdePunta: esPunta(c.fromEnd) ? c.fromEnd : undefined,
        hastaNodo,
        hastaLado: esLado(c.toSide) ? c.toSide : undefined,
        hastaPunta: esPunta(c.toEnd) ? c.toEnd : undefined,
        color: texto(c.color),
        etiqueta: texto(c.label),
        crudo: c,
      });
    }
  }

  return { nodos, aristas };
}

// ── Escritura ─────────────────────────────────────────────────────────────────

/** Quita las claves `undefined` para no escribir campos vacíos en el archivo. */
function limpio<T extends Record<string, unknown>>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/**
 * Serializa a JSON Canvas 1.0.
 *
 * Se parte del objeto **crudo** y se escriben encima los campos que Mycelium
 * maneja: así un `backgroundStyle`, un `subpath` o cualquier extensión futura del
 * formato sobreviven a una edición aunque esta versión no sepa qué son.
 */
export function serializarCanvas(canvas: Canvas): string {
  const nodes = canvas.nodos.map((n) =>
    limpio({
      ...n.crudo,
      id: n.id,
      type: n.tipo,
      x: Math.round(n.x),
      y: Math.round(n.y),
      width: Math.round(n.ancho),
      height: Math.round(n.alto),
      color: n.color,
      text: n.tipo === "text" ? (n.texto ?? "") : n.crudo.text,
      file: n.tipo === "file" ? n.archivo : n.crudo.file,
      subpath: n.subpath,
      url: n.tipo === "link" ? n.url : n.crudo.url,
      label: n.tipo === "group" ? n.etiqueta : n.crudo.label,
    }),
  );

  const edges = canvas.aristas.map((a) =>
    limpio({
      ...a.crudo,
      id: a.id,
      fromNode: a.desdeNodo,
      fromSide: a.desdeLado,
      fromEnd: a.desdePunta,
      toNode: a.hastaNodo,
      toSide: a.hastaLado,
      toEnd: a.hastaPunta,
      color: a.color,
      label: a.etiqueta,
    }),
  );

  return `${JSON.stringify({ nodes, edges }, null, 2)}\n`;
}

/** Un canvas recién creado: vacío y válido. */
export function canvasInicial(): string {
  return serializarCanvas({ nodos: [], aristas: [] });
}

// ── Creación ──────────────────────────────────────────────────────────────────

/** Id corto y único dentro del canvas (el formato solo pide que no se repita). */
export function nuevoId(existentes: Iterable<string>): string {
  const usados = new Set(existentes);
  for (;;) {
    const id = Math.random().toString(36).slice(2, 18);
    if (!usados.has(id)) return id;
  }
}

export const ANCHO_TARJETA = 260;
export const ALTO_TARJETA = 140;

export function nodoTexto(id: string, x: number, y: number, texto = ""): Nodo {
  return {
    id,
    tipo: "text",
    x,
    y,
    ancho: ANCHO_TARJETA,
    alto: ALTO_TARJETA,
    texto,
    crudo: {},
  };
}

export function nodoArchivo(id: string, x: number, y: number, archivo: string): Nodo {
  return {
    id,
    tipo: "file",
    x,
    y,
    ancho: ANCHO_TARJETA,
    alto: 200,
    archivo,
    crudo: {},
  };
}

export function nuevaArista(id: string, desdeNodo: string, hastaNodo: string): Arista {
  // `toEnd` se deja implícito: el formato ya define `arrow` por defecto, y
  // escribirlo sería ruido.
  return { id, desdeNodo, hastaNodo, crudo: {} };
}

// ── Geometría de las flechas ──────────────────────────────────────────────────

export type Punto = { x: number; y: number };

/** Punto de enganche de un lado del nodo. */
export function anclaDe(nodo: Nodo, lado: Lado): Punto {
  switch (lado) {
    case "top":
      return { x: nodo.x + nodo.ancho / 2, y: nodo.y };
    case "bottom":
      return { x: nodo.x + nodo.ancho / 2, y: nodo.y + nodo.alto };
    case "left":
      return { x: nodo.x, y: nodo.y + nodo.alto / 2 };
    case "right":
      return { x: nodo.x + nodo.ancho, y: nodo.y + nodo.alto / 2 };
  }
}

/**
 * Lados por los que conviene salir y entrar cuando el archivo no los fija.
 * JSON Canvas los deja opcionales, así que hay que elegirlos: se toma el eje en
 * el que los nodos están más separados, que es lo que produce el trazo más corto
 * y menos cruces.
 */
export function ladosAutomaticos(a: Nodo, b: Nodo): { desde: Lado; hasta: Lado } {
  const dx = b.x + b.ancho / 2 - (a.x + a.ancho / 2);
  const dy = b.y + b.alto / 2 - (a.y + a.alto / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { desde: "right", hasta: "left" } : { desde: "left", hasta: "right" };
  }
  return dy >= 0 ? { desde: "bottom", hasta: "top" } : { desde: "top", hasta: "bottom" };
}

/** Vector unitario que sale del nodo por ese lado (para curvar la bezier). */
function normal(lado: Lado): Punto {
  switch (lado) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

/**
 * Trazo de una flecha: una bezier cúbica cuyos tiradores salen perpendiculares a
 * cada lado, que es como se dibujan en Obsidian. La longitud del tirador crece
 * con la distancia pero se acota, para que dos nodos pegados no produzcan un
 * rulo enorme.
 */
export function trazoArista(
  a: Nodo,
  ladoA: Lado,
  b: Nodo,
  ladoB: Lado,
): { d: string; fin: Punto; anguloFin: number } {
  const p1 = anclaDe(a, ladoA);
  const p2 = anclaDe(b, ladoB);
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const tirador = Math.min(120, Math.max(40, dist / 2));
  const n1 = normal(ladoA);
  const n2 = normal(ladoB);
  const c1 = { x: p1.x + n1.x * tirador, y: p1.y + n1.y * tirador };
  const c2 = { x: p2.x + n2.x * tirador, y: p2.y + n2.y * tirador };
  return {
    d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`,
    fin: p2,
    // La punta mira hacia adentro del nodo destino, o sea contra su normal.
    // El `+ 0` normaliza el `-0` que devuelve `atan2` con normales negativas: no
    // cambia el dibujo, pero evita que un `rotate(-0)` acabe en el DOM.
    anguloFin: (Math.atan2(-n2.y, -n2.x) * 180) / Math.PI + 0,
  };
}

// ── Lo que el canvas aporta al grafo ──────────────────────────────────────────

const RE_WIKILINK = /\[\[([^\[\]]+)\]\]/g;

/**
 * Referencias que un canvas hace a otras notas, para el grafo del vault.
 *
 * | Elemento | ¿Cuenta? |
 * |---|---|
 * | `[[enlace]]` dentro de una tarjeta de texto | **sí** |
 * | Tarjeta de nota (`file`) | **sí** — es una referencia explícita, como un embed |
 * | Flecha entre dos tarjetas | **no**: es disposición visual |
 *
 * Que las flechas no cuenten fue decisión del usuario, y es la opción sin
 * ambigüedad: una arista del grafo se crea de una sola manera.
 *
 * Se devuelve por separado lo que son **títulos** (de los wikilinks, que se
 * resuelven por título) y lo que son **rutas** (de las tarjetas de nota, que ya
 * apuntan a un archivo). Quien llama sabe cuál usar.
 */
export function referenciasDe(json: string): { titulos: string[]; rutas: string[] } {
  let canvas: Canvas;
  try {
    canvas = parsearCanvas(json);
  } catch {
    return { titulos: [], rutas: [] };
  }

  const titulos: string[] = [];
  const rutas: string[] = [];
  for (const n of canvas.nodos) {
    if (n.tipo === "text" && n.texto) {
      RE_WIKILINK.lastIndex = 0;
      for (let m = RE_WIKILINK.exec(n.texto); m !== null; m = RE_WIKILINK.exec(n.texto)) {
        // `[[destino|alias]]` y `[[Carpeta/destino]]`: interesa el destino.
        const interior = m[1].split("|")[0];
        const destino = interior.slice(interior.lastIndexOf("/") + 1).trim();
        if (destino !== "") titulos.push(destino);
      }
    }
    if (n.tipo === "file" && n.archivo) rutas.push(n.archivo);
  }
  return { titulos, rutas };
}
