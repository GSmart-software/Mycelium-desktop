/**
 * La lógica pura de `mycelium_diccionario` (`FUN-L-09`, Parte 4; spec en
 * `docs/features/mcp-control.md`): validar los argumentos, decidir qué palabras
 * se aceptan (con la regla del corrector, `motivoPalabraNoAceptada`), contar el
 * efecto contra lo que había en el archivo, el texto para el agente y el
 * registro, y el Deshacer.
 *
 * Solo el **diccionario del vault** (`.mycelium/diccionario.txt`); el de
 * Mycelium no se toca por MCP. Sin stores ni Tauri, para probarlo con
 * `scripts/test-mcp-diccionario.mjs`; las operaciones están en
 * `lib/mcpDiccionario.ts`.
 */
import { entradaParecida, motivoPalabraNoAceptada, normalizarPalabra } from "@/lib/ortografia/palabras";

/** Cuántas palabras acepta una llamada de agregar o quitar. */
export const TOPE_POR_LLAMADA = 200;

/** Cuántas palabras devuelve `listar` (con el total, si hay más). */
export const TOPE_LISTAR = 500;

export type Accion = "listar" | "agregar" | "quitar";

type ErrorMcp = { codigo: string; mensaje: string; datos: unknown };
export type Validado<T> = { ok: true; valor: T } | { ok: false; error: ErrorMcp };

const invalido = (campo: string, mensaje: string): { ok: false; error: ErrorMcp } => ({
  ok: false,
  error: { codigo: "INVALIDO", mensaje: `\`${campo}\`: ${mensaje}`, datos: { campo } },
});

const CAMPOS = new Set(["accion", "palabras"]);

/** Lo que pidió el agente, ya validado. `palabras` va sin repetir y normalizada. */
export type Pedido = { accion: "listar" } | { accion: "agregar" | "quitar"; palabras: string[] };

export function validarDiccionario(args: Record<string, unknown>): Validado<Pedido> {
  for (const k of Object.keys(args)) {
    if (!CAMPOS.has(k)) return invalido(k, "no es un campo de mycelium_diccionario (van `accion` y `palabras`).");
  }
  const accion = args.accion ?? "listar";
  if (accion !== "listar" && accion !== "agregar" && accion !== "quitar") {
    return invalido("accion", `«${String(accion)}» no es una acción: listar, agregar o quitar.`);
  }
  if (accion === "listar") return { ok: true, valor: { accion } };
  const crudas = args.palabras;
  if (!Array.isArray(crudas) || crudas.length === 0) {
    return invalido("palabras", `para ${accion} hace falta una lista de palabras (["Mycelium", "rizoma"]).`);
  }
  if (crudas.length > TOPE_POR_LLAMADA) {
    return invalido("palabras", `son ${crudas.length}; el tope es ${TOPE_POR_LLAMADA} por llamada. Partilas en varias llamadas.`);
  }
  const vistas = new Set<string>();
  const palabras: string[] = [];
  for (const [i, p] of crudas.entries()) {
    if (typeof p !== "string") return invalido("palabras", `el elemento ${i + 1} no es un texto.`);
    const n = normalizarPalabra(p.trim());
    if (vistas.has(n)) continue;
    vistas.add(n);
    palabras.push(n);
  }
  return { ok: true, valor: { accion, palabras } };
}

// ── El efecto ───────────────────────────────────────────────────────────────

export type Rechazada = { palabra: string; motivo: string };

/** Agregar: cuáles se aceptan como palabra y cuáles se rechazan, y por qué. */
export function separarAceptadas(palabras: readonly string[]): { aceptadas: string[]; rechazadas: Rechazada[] } {
  const aceptadas: string[] = [];
  const rechazadas: Rechazada[] = [];
  for (const p of palabras) {
    const motivo = motivoPalabraNoAceptada(p);
    if (motivo === null) aceptadas.push(p);
    else rechazadas.push({ palabra: p, motivo });
  }
  return { aceptadas, rechazadas };
}

/**
 * Quitar: solo se rechaza una vacía. Lo demás se busca tal cual, porque el
 * archivo puede tener entradas que hoy no se aceptarían (escritas a mano), y
 * tiene que poder limpiarse.
 */
export function separarParaQuitar(palabras: readonly string[]): { aceptadas: string[]; rechazadas: Rechazada[] } {
  return {
    aceptadas: palabras.filter((p) => p !== ""),
    rechazadas: palabras.filter((p) => p === "").map((p) => ({ palabra: p, motivo: "está vacía" })),
  };
}

export type NoEstaba = { palabra: string; parecida: string | null };

export type EfectoAgregar = { agregadas: string[]; ya_estaban: string[]; rechazadas: Rechazada[]; total: number };
export type EfectoQuitar = { quitadas: string[]; no_estaban: NoEstaba[]; rechazadas: Rechazada[]; total: number };

/** Lo que pasó al agregar, contado contra el archivo de antes y el de después. */
export function efectoAgregar(aceptadas: readonly string[], rechazadas: Rechazada[], antes: readonly string[], despues: readonly string[]): EfectoAgregar {
  const habia = new Set(antes);
  return {
    agregadas: aceptadas.filter((p) => !habia.has(p)),
    ya_estaban: aceptadas.filter((p) => habia.has(p)),
    rechazadas,
    total: despues.length,
  };
}

export function efectoQuitar(aceptadas: readonly string[], rechazadas: Rechazada[], antes: readonly string[], despues: readonly string[]): EfectoQuitar {
  const habia = new Set(antes);
  return {
    quitadas: aceptadas.filter((p) => habia.has(p)),
    no_estaban: aceptadas.filter((p) => !habia.has(p)).map((p) => ({ palabra: p, parecida: entradaParecida(antes, p) })),
    rechazadas,
    total: despues.length,
  };
}

/** Hasta 8 palabras entre comillas, y «y N más». */
function lista(palabras: readonly string[]): string {
  const vis = palabras.slice(0, 8).map((p) => `«${p}»`);
  const resto = palabras.length - vis.length;
  if (resto > 0) return `${vis.join(", ")} y ${resto} más`;
  return vis.length <= 1 ? vis.join("") : `${vis.slice(0, -1).join(", ")} y ${vis[vis.length - 1]}`;
}

const nPalabras = (n: number) => (n === 1 ? "1 palabra" : `${n} palabras`);

/** El texto del efecto: lo que recibe el agente y lo que muestra el registro. */
export function textoAgregar(e: EfectoAgregar): string {
  const partes: string[] = [];
  partes.push(
    e.agregadas.length
      ? `Agregué ${nPalabras(e.agregadas.length)} al diccionario del vault: ${lista(e.agregadas)}.`
      : "No agregué ninguna palabra al diccionario del vault.",
  );
  if (e.ya_estaban.length) partes.push(`Ya estaban: ${lista(e.ya_estaban)}.`);
  if (e.rechazadas.length) partes.push(`Rechacé ${lista(e.rechazadas.map((r) => r.palabra))}.`);
  partes.push(`Ahora tiene ${nPalabras(e.total)}.`);
  return partes.join(" ");
}

export function textoQuitar(e: EfectoQuitar): string {
  const partes: string[] = [];
  partes.push(
    e.quitadas.length
      ? `Quité ${nPalabras(e.quitadas.length)} del diccionario del vault: ${lista(e.quitadas)}.`
      : "No quité ninguna palabra del diccionario del vault.",
  );
  if (e.no_estaban.length) partes.push(`No estaban: ${lista(e.no_estaban.map((n) => n.palabra))}.`);
  if (e.rechazadas.length) partes.push(`Rechacé ${lista(e.rechazadas.map((r) => r.palabra))}.`);
  partes.push(`Ahora tiene ${nPalabras(e.total)}.`);
  return partes.join(" ");
}

/** `listar`: las primeras `tope` y el total. */
export function listado(palabras: readonly string[], tope = TOPE_LISTAR): { palabras: string[]; total: number; recortado: boolean } {
  return { palabras: palabras.slice(0, tope), total: palabras.length, recortado: palabras.length > tope };
}

// ── Deshacer ────────────────────────────────────────────────────────────────

/**
 * Lo que se guarda para deshacer: agregar se deshace **quitando esas mismas**
 * (las que se agregaron de verdad, no las que ya estaban); quitar, volviéndolas
 * a agregar.
 */
export type DeshacerDiccionario =
  | { tipo: "diccionario_quitar"; palabras: string[] }
  | { tipo: "diccionario_agregar"; palabras: string[] };

export const CAMBIO_DESPUES = "cambió después";

/**
 * Si se puede deshacer contra el diccionario de hoy: lo agregado tiene que
 * seguir estando, y lo quitado, seguir afuera. Si no, el usuario (o la IA)
 * lo cambió después, y deshacer pisaría ese cambio.
 */
export function puedeDeshacerDiccionario(
  palabras: ReadonlySet<string>,
  d: DeshacerDiccionario,
): { ok: true } | { ok: false; porque: string } {
  if (d.tipo === "diccionario_quitar") {
    const faltan = d.palabras.filter((p) => !palabras.has(p));
    if (faltan.length) return { ok: false, porque: `${CAMBIO_DESPUES}: ${lista(faltan)} ya no está en el diccionario` };
  } else {
    const volvieron = d.palabras.filter((p) => palabras.has(p));
    if (volvieron.length) return { ok: false, porque: `${CAMBIO_DESPUES}: ${lista(volvieron)} volvió al diccionario` };
  }
  return { ok: true };
}

export function describirDeshacerDiccionario(d: DeshacerDiccionario): string {
  return d.tipo === "diccionario_quitar"
    ? `quitar del diccionario del vault ${lista(d.palabras)}`
    : `volver a agregar al diccionario del vault ${lista(d.palabras)}`;
}

/** Aplica el deshacer a la lista del archivo (ya comprobado con `puedeDeshacerDiccionario`). */
export function aplicarDeshacer(palabras: readonly string[], d: DeshacerDiccionario): string[] {
  if (d.tipo === "diccionario_quitar") {
    const fuera = new Set(d.palabras);
    return palabras.filter((p) => !fuera.has(p));
  }
  return [...palabras, ...d.palabras];
}

export function textoDeshacer(d: DeshacerDiccionario): string {
  return d.tipo === "diccionario_quitar"
    ? `Se quitó del diccionario del vault ${lista(d.palabras)}.`
    : `Volvió al diccionario del vault ${lista(d.palabras)}.`;
}
