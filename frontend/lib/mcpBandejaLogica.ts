/**
 * La lógica pura de `mycelium_bandeja` (`FUN-S-40`): leer las entradas de una
 * Bandeja **numeradas**, con su día, su hora y su texto, y quitar las que se
 * pidan por número. Sin stores ni disco, para probarla con
 * `scripts/test-mcp-bandeja.mjs`; lo que lee y escribe está en
 * `lib/mcpBandeja.ts`.
 *
 * El formato es el de la captura rápida (`lib/bandeja.ts`, `agregarEntrada`):
 *
 * ```markdown
 * ## 2026-11-05
 * - 09:40 La panadería prefiere hablar por la tarde
 * - [ ] 10:05 Renovar el dominio antes del 15
 * ```
 *
 * Pero la Bandeja se edita a mano, así que se lee con el mismo criterio que el
 * contador del explorador (`contarEntradas`): una **entrada** es un ítem de
 * lista fuera del frontmatter y de los bloques de código; las líneas más
 * sangradas que lo siguen (sub-ítems, continuación) son parte de ella y se van
 * con ella. A diferencia del contador, acá entran también las tareas hechas y
 * canceladas: quitarlas es justamente lo que se pide al procesar.
 */
import { estadoDeSimbolo, type IdEstadoTarea } from "@/lib/estadosTarea";

/** Cuál de las dos bandejas. */
export type BandejaIa = "vault" | "personal";

export type EntradaBandeja = {
  /** Desde 1, en el orden del archivo. Es lo que se pasa para quitar. */
  numero: number;
  /** El texto del encabezado bajo el que está (`2026-11-05`), o `null`. */
  dia: string | null;
  /** `HH:MM` al principio del texto, si lo tiene. */
  hora: string | null;
  /** El texto, sin el marcador, la casilla ni la hora. */
  texto: string;
  /** El estado de la casilla, si es una tarea. */
  tarea: IdEstadoTarea | null;
  /** Cuántas líneas de abajo le pertenecen (sub-ítems, continuación). */
  debajo: number;
  /** Primera línea (índice desde 0) y la siguiente a la última. */
  desde: number;
  hasta: number;
};

type Encabezado = { indice: number; texto: string };

/** Un ítem de lista de primer nivel (hasta 3 espacios), con lo que sigue al marcador. */
const ITEM = /^( {0,3})(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
/** La casilla de tarea al principio del contenido del ítem. */
const CASILLA = /^\[([^\[\]\\\r\n\t])\](?:[ \t]+|$)/;
/** La hora de la entrada. */
const HORA = /^(\d{1,2}:\d{2})(?:[ \t]+|$)/;
/** Un encabezado Markdown de cualquier nivel. */
const ENCABEZADO = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
/** Apertura o cierre de un bloque de código cercado. */
const CERCA = /^ {0,3}(`{3,}|~{3,})/;
/** `* * *` o `- - -`: una línea horizontal, no un ítem. */
const REGLA = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

const vacia = (l: string) => l.trim() === "";

/** Las entradas y los encabezados del contenido. */
function analizar(contenido: string): { lineas: string[]; entradas: EntradaBandeja[]; encabezados: Encabezado[] } {
  const lineas = (contenido ?? "").split(/\r?\n/);
  const entradas: EntradaBandeja[] = [];
  const encabezados: Encabezado[] = [];
  let i = 0;
  // Frontmatter: solo si el archivo arranca con `---` y se cierra.
  if (lineas[0]?.trim() === "---") {
    const fin = lineas.findIndex((l, j) => j > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (fin > 0) i = fin + 1;
  }
  let cerca: string | null = null;
  let dia: string | null = null;
  while (i < lineas.length) {
    const linea = lineas[i];
    const c = CERCA.exec(linea);
    if (c) {
      if (cerca === null) cerca = c[1][0];
      else if (c[1][0] === cerca) cerca = null;
      i++;
      continue;
    }
    if (cerca !== null) {
      i++;
      continue;
    }
    if (ENCABEZADO.test(linea)) {
      dia = linea.trim().replace(/^#{1,6}/, "").trim() || null;
      encabezados.push({ indice: i, texto: dia ?? "" });
      i++;
      continue;
    }
    const item = REGLA.test(linea) ? null : ITEM.exec(linea);
    if (!item || item[2].trim() === "") {
      i++;
      continue;
    }
    // Lo que le pertenece: las líneas no vacías siguientes, más sangradas que
    // el marcador.
    const sangria = item[1].length;
    let hasta = i + 1;
    while (hasta < lineas.length && !vacia(lineas[hasta]) && /^[ \t]*/.exec(lineas[hasta])![0].replace(/\t/g, "    ").length > sangria) {
      hasta++;
    }
    let resto = item[2].trim();
    let tarea: IdEstadoTarea | null = null;
    const casilla = CASILLA.exec(resto);
    if (casilla) {
      tarea = estadoDeSimbolo(casilla[1]).id;
      resto = resto.slice(casilla[0].length);
    }
    const h = HORA.exec(resto);
    const hora = h ? h[1] : null;
    if (h) resto = resto.slice(h[0].length);
    entradas.push({
      numero: entradas.length + 1,
      dia,
      hora,
      texto: resto.trim(),
      tarea,
      debajo: hasta - i - 1,
      desde: i,
      hasta,
    });
    i = hasta;
  }
  return { lineas, entradas, encabezados };
}

/** Las entradas de la Bandeja, numeradas desde 1 en el orden del archivo. */
export function entradasDeBandeja(contenido: string): EntradaBandeja[] {
  return analizar(contenido).entradas;
}

export type Quitado =
  | { ok: true; contenido: string; quitadas: EntradaBandeja[]; diasQuitados: string[] }
  | { ok: false; fuera: number[]; total: number };

/**
 * Quita las entradas `numeros` (los de `entradasDeBandeja` sobre ESTE
 * contenido). Lo demás queda tal cual, salvo el encabezado de un día del que
 * se quitaron entradas y que quedó sin nada: ese se va también, con sus líneas
 * en blanco. Un encabezado que ya estaba vacío no se toca. Respeta los saltos
 * del archivo (CRLF o LF). `ok: false` si algún número no es una entrada.
 */
export function quitarEntradas(contenido: string, numeros: readonly number[]): Quitado {
  const { lineas, entradas, encabezados } = analizar(contenido);
  const pedidos = new Set(numeros);
  const fuera = [...pedidos].filter((n) => !Number.isInteger(n) || n < 1 || n > entradas.length).sort((a, b) => a - b);
  if (fuera.length > 0) return { ok: false, fuera, total: entradas.length };

  const quitadas = entradas.filter((e) => pedidos.has(e.numero));
  const borrar = new Set<number>();
  for (const e of quitadas) for (let i = e.desde; i < e.hasta; i++) borrar.add(i);

  // Un día del que se quitó algo y que quedó solo con líneas en blanco: se va
  // su encabezado (y esas líneas). Su sección llega hasta el próximo encabezado.
  const diasQuitados: string[] = [];
  encabezados.forEach((enc, k) => {
    const fin = k + 1 < encabezados.length ? encabezados[k + 1].indice : lineas.length;
    const tocado = quitadas.some((e) => e.desde > enc.indice && e.desde < fin);
    if (!tocado) return;
    const queda = [];
    for (let i = enc.indice + 1; i < fin; i++) if (!borrar.has(i)) queda.push(i);
    if (queda.every((i) => vacia(lineas[i]))) {
      borrar.add(enc.indice);
      for (const i of queda) borrar.add(i);
      diasQuitados.push(enc.texto);
    }
  });

  const eol = contenido.includes("\r\n") ? "\r\n" : "\n";
  // El final del archivo (el salto final es una línea vacía más en `split`)
  // se recompone como estaba, aunque lo último que se quitó fuera lo de abajo.
  const vaciasAlFinal = (ls: string[]) => {
    let n = 0;
    while (n < ls.length && vacia(ls[ls.length - 1 - n])) n++;
    return n;
  };
  const final = vaciasAlFinal(lineas);
  const quedan = lineas.filter((_, i) => !borrar.has(i));
  quedan.splice(quedan.length - vaciasAlFinal(quedan));
  if (quedan.length === 0) return { ok: true, contenido: "", quitadas, diasQuitados };
  for (let i = 0; i < final; i++) quedan.push("");
  return { ok: true, contenido: quedan.join(eol), quitadas, diasQuitados };
}

/** «la Bandeja del vault» / «la Bandeja personal». */
export function nombreBandeja(b: BandejaIa): string {
  return b === "vault" ? "la Bandeja del vault" : "la Bandeja personal";
}

/** El texto del efecto de quitar, para el agente y el registro de actividad. */
export function efectoQuitar(b: BandejaIa, quitadas: readonly EntradaBandeja[], diasQuitados: readonly string[]): string {
  const n = quitadas.length;
  const cuales = quitadas.map((e) => `«${e.texto.length > 60 ? `${e.texto.slice(0, 59)}…` : e.texto}»`).join(", ");
  let t = `Quité ${n === 1 ? "1 entrada" : `${n} entradas`} de ${nombreBandeja(b)}: ${cuales}.`;
  if (diasQuitados.length === 1) t += ` El día ${diasQuitados[0]} quedó vacío y se fue su encabezado.`;
  else if (diasQuitados.length > 1) t += ` Los días ${diasQuitados.join(", ")} quedaron vacíos y se fueron sus encabezados.`;
  return t;
}

// ── Deshacer ────────────────────────────────────────────────────────────────

/**
 * Lo que se guarda para deshacer un `quitar`: el contenido de antes, entero, y
 * la huella de lo que quedó. Se repone solo si la Bandeja sigue exactamente
 * como la dejó la IA: si alguien anotó o la editó después, reponer lo de antes
 * pisaría ese cambio (se comprueba al deshacer, leyendo el archivo).
 */
export type DeshacerBandeja = {
  tipo: "bandeja_reponer";
  bandeja: BandejaIa;
  /** La ruta de la del vault (relativa); la de la personal, solo para mostrarla. */
  ruta: string;
  antes: string;
  /** Huella (SHA-256 hex) de lo que dejó la IA. */
  huella: string;
  cuantas: number;
};

export function describirDeshacerBandeja(d: DeshacerBandeja): string {
  return `Volver a poner ${d.cuantas === 1 ? "la entrada quitada" : `las ${d.cuantas} entradas quitadas`} en ${nombreBandeja(d.bandeja)}`;
}

/** Por qué no se puede deshacer, contra la huella de lo que hay hoy, o `null`. */
export function motivoSinDeshacerBandeja(d: DeshacerBandeja, huellaActual: string | null): string | null {
  const nombre = d.bandeja === "vault" ? "La Bandeja del vault" : "La Bandeja personal";
  if (huellaActual === null) return `${nombre} ya no existe.`;
  if (huellaActual !== d.huella) {
    return `${nombre} cambió después (otra captura o una edición): reponer lo de antes pisaría ese cambio.`;
  }
  return null;
}
