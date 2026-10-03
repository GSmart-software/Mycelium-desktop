/**
 * El **registro de actividad** de la IA (`FUN-L-09`, Parte 2; spec en
 * `docs/features/mcp-control.md` § 2.3 y `docs/arquitectura/MCP de Mycelium -
 * control.md` § 8.1): qué hizo el agente por el MCP de control, con su efecto,
 * lo rechazado y lo que falló, y cómo deshacerlo.
 *
 * Puro y sin stores, para probarlo con `scripts/test-mcp-calendario.mjs`; el
 * estado y la persistencia están en `stores/actividadIaStore.ts`.
 *
 * **El archivo**: `.mycelium/actividad.jsonl`, una entrada JSON por renglón,
 * *append-only*: una entrada nunca se reescribe. Deshacer agrega una entrada
 * `deshacer` que apunta a la original (`ref`), y al leer se cruza. Con tope:
 * al escribir se conservan los últimos `TOPE_ENTRADAS` renglones. Un renglón
 * que no se entiende se ignora, sin romper el resto: el registro es
 * descartable, perderlo no pierde nada del vault.
 */
import type { DeshacerArchivos } from "@/lib/mcpArchivosLogica";
import type { DeshacerCalendario } from "@/lib/mcpCalendarioLogica";
import type { DeshacerDiccionario } from "@/lib/mcpDiccionarioLogica";

/**
 * Lo que se guarda para deshacer: del calendario (Parte 2), de archivos
 * (Parte 3) o del diccionario del vault (Parte 4).
 */
export type DeshacerIa = DeshacerCalendario | DeshacerArchivos | DeshacerDiccionario;

export const ARCHIVO_ACTIVIDAD = "actividad.jsonl";

/** Cuántos renglones se conservan. */
export const TOPE_ENTRADAS = 500;

/** Versión del formato de cada renglón. */
const VERSION = 1;

/** Sobre qué actuó: lo que abre «Ir». */
export type Objetivo =
  | { tipo: "nota"; ruta: string }
  | { tipo: "grafo" }
  | { tipo: "calendario" }
  | { tipo: "recordatorio"; id: string; fecha: string }
  | { tipo: "carpeta"; ruta: string }
  | { tipo: "papelera" };

export type Resultado = "hecho" | "fallo" | "rechazado";

/**
 * Lo que vuelve de una operación del canal: el resultado para el agente y lo
 * que va al registro. `sinRegistro`: no se anota (listar la papelera, o la
 * respuesta «esperando confirmación», cuya operación se anota al contestar).
 */
export type Atendido = {
  resultado: unknown;
  actividad?: { efecto: string; objetivo?: Objetivo; deshacer?: DeshacerIa };
  sinRegistro?: boolean;
};

export type Entrada = {
  v: number;
  id: string;
  /** Instante, ISO 8601 (UTC). Se muestra en la hora local. */
  momento: string;
  /** La operación del canal (`abrir`, `recordatorio_crear`…) o `deshacer`. */
  op: string;
  resultado: Resultado;
  /** Lo que pasó, en palabras: el mismo texto que recibe el agente. */
  efecto: string;
  /** El código del error, si falló. */
  codigo?: string;
  objetivo?: Objetivo;
  deshacer?: DeshacerIa;
  /** Solo en `deshacer`: la entrada que deshace. */
  ref?: string;
};

/** Una entrada como se muestra: con lo que se sabe de su deshacer. */
export type EntradaVista = Entrada & {
  /** Si ya se deshizo, cuándo. */
  deshechaEn: string | null;
};

const RESULTADOS = new Set<string>(["hecho", "fallo", "rechazado"]);

/** Un renglón del archivo, o `null` si no se puede usar. */
export function leerRenglon(renglon: string): Entrada | null {
  const t = renglon.trim();
  if (t === "") return null;
  let o: unknown;
  try {
    o = JSON.parse(t);
  } catch {
    return null; // un renglón dañado se ignora; los demás valen
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
  const e = o as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.op !== "string" || typeof e.efecto !== "string") return null;
  if (typeof e.momento !== "string" || Number.isNaN(Date.parse(e.momento))) return null;
  if (typeof e.resultado !== "string" || !RESULTADOS.has(e.resultado)) return null;
  const entrada: Entrada = {
    v: typeof e.v === "number" ? e.v : VERSION,
    id: e.id,
    momento: e.momento,
    op: e.op,
    resultado: e.resultado as Resultado,
    efecto: e.efecto,
  };
  if (typeof e.codigo === "string") entrada.codigo = e.codigo;
  if (typeof e.ref === "string") entrada.ref = e.ref;
  if (esObjetivo(e.objetivo)) entrada.objetivo = e.objetivo;
  if (esDeshacer(e.deshacer)) entrada.deshacer = e.deshacer;
  return entrada;
}

function esObjetivo(x: unknown): x is Objetivo {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  switch (o.tipo) {
    case "nota":
      return typeof o.ruta === "string";
    case "grafo":
    case "calendario":
    case "papelera":
      return true;
    case "recordatorio":
      return typeof o.id === "string" && typeof o.fecha === "string";
    case "carpeta":
      return typeof o.ruta === "string";
    default:
      return false;
  }
}

/** Lo justo para no intentar un deshacer con datos rotos; el resto lo valida quien deshace. */
function esDeshacer(x: unknown): x is DeshacerIa {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  const s = (k: string) => typeof o[k] === "string";
  const clase = o.clase === "nota" || o.clase === "carpeta";
  const r = o.recordatorio as Record<string, unknown> | undefined;
  const recordatorioOk = typeof r === "object" && r !== null && typeof r.id === "string" && typeof r.titulo === "string" && typeof r.fecha === "string";
  switch (o.tipo) {
    case "borrar":
      return typeof o.id === "string";
    case "restaurar":
      return recordatorioOk && typeof o.ocurrencias === "object" && o.ocurrencias !== null;
    case "reponer":
      return recordatorioOk;
    case "completar":
      return typeof o.id === "string" && typeof o.fecha === "string" && typeof o.completado === "boolean";
    // Parte 3: archivos.
    case "archivo_renombrar":
      return clase && s("ruta") && s("rutaAntes") && s("nombre");
    case "archivo_mover":
      return clase && s("ruta") && s("rutaAntes") && (o.carpeta === null || s("carpeta"));
    case "archivo_restaurar":
      return clase && s("ruta") && Array.isArray(o.notas) && o.notas.every((n) => typeof n === "string");
    case "archivo_borrar":
      return s("ruta");
    // Parte 4: el diccionario del vault.
    case "diccionario_quitar":
    case "diccionario_agregar":
      return Array.isArray(o.palabras) && o.palabras.length > 0 && o.palabras.every((p) => typeof p === "string");
    default:
      return false;
  }
}

/** Todas las entradas legibles del archivo, en el orden en que se escribieron. */
export function leerActividad(texto: string | null): Entrada[] {
  if (!texto) return [];
  return texto
    .split(/\r?\n/)
    .map(leerRenglon)
    .filter((e): e is Entrada => e !== null);
}

/** El archivo con una entrada más, recortado a las últimas `tope`. */
export function agregarEntrada(entradas: readonly Entrada[], nueva: Entrada, tope = TOPE_ENTRADAS): Entrada[] {
  const todas = [...entradas, nueva];
  return todas.length > tope ? todas.slice(todas.length - tope) : todas;
}

export function serializar(entradas: readonly Entrada[]): string {
  return entradas.map((e) => JSON.stringify(e)).join("\n") + (entradas.length ? "\n" : "");
}

/**
 * Lo que muestra el panel: las operaciones, de la más nueva a la más vieja,
 * cada una con si ya se deshizo. Las entradas `deshacer` no se listan aparte:
 * se ven como «Deshecho» en la que deshicieron.
 */
export function vistaActividad(entradas: readonly Entrada[]): EntradaVista[] {
  const deshechas = new Map<string, string>();
  for (const e of entradas) {
    if (e.op === "deshacer" && e.resultado === "hecho" && e.ref) deshechas.set(e.ref, e.momento);
  }
  return entradas
    .filter((e) => e.op !== "deshacer")
    .map((e) => ({ ...e, deshechaEn: deshechas.get(e.id) ?? null }))
    .reverse();
}

export function nuevaEntrada(datos: Omit<Entrada, "v" | "id" | "momento">, ahora = new Date()): Entrada {
  return { v: VERSION, id: idEntrada(), momento: ahora.toISOString(), ...datos };
}

function idEntrada(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Nombre de cada operación para el panel. */
export const NOMBRE_OP: Record<string, string> = {
  abrir: "Abrir",
  recordatorios: "Leer el calendario",
  recordatorio_crear: "Crear recordatorio",
  recordatorio_editar: "Editar recordatorio",
  recordatorio_completar: "Completar recordatorio",
  recordatorio_borrar: "Borrar recordatorio",
  renombrar: "Renombrar",
  mover: "Mover",
  borrar: "Mandar a la papelera",
  papelera: "Papelera",
  diccionario: "Diccionario del vault",
};

/**
 * Qué operaciones se registran. `estado` no: es la primera llamada de casi
 * toda sesión y no cambia nada, así que solo ensuciaría. Leer el calendario
 * tampoco, por lo mismo; sí sus fallos, que ayudan a entender qué pidió. Ni
 * listar la papelera ni el diccionario (lo decide la operación:
 * `Atendido.sinRegistro`).
 */
export function seRegistra(op: string, resultado: Resultado): boolean {
  if (op === "estado" || op === "ping") return false;
  // Consultar o retirar una confirmación pendiente no es una operación: la
  // operación confirmada se registra sola, cuando el usuario contesta.
  if (op === "confirmacion" || op === "confirmacion_retirar") return false;
  if (op === "recordatorios") return resultado !== "hecho";
  return true;
}

/** Cómo está el canal, para la cabecera del panel. */
export type EstadoCanal = "apagado" | "encendido" | "conectado" | "error";

/** Cuánto vale «conectado» después del último pedido. */
export const VENTANA_CONECTADO_MS = 10 * 60 * 1000;

/**
 * El servidor MCP abre una conexión por pedido, así que «conectado» no es un
 * estado del pipe: es que **Claude Code habló hace poco**.
 */
export function estadoCanal(
  encendido: boolean,
  error: string | null,
  ultimoPedido: number | null,
  ahora: number,
): EstadoCanal {
  if (!encendido) return "apagado";
  if (error !== null) return "error";
  if (ultimoPedido !== null && ahora - ultimoPedido <= VENTANA_CONECTADO_MS) return "conectado";
  return "encendido";
}
