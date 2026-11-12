/**
 * Coordinación entre sesiones de IA (`FUN-L-31`; spec en
 * `docs/features/ia-vaults-intensivos.md` § 6 y `docs/features/mcp-control.md`
 * § «Sesiones y reservas»). Solo desktop.
 *
 * Varias sesiones de Claude Code pueden trabajar a la vez sobre el mismo vault,
 * cada una con su proceso `mycelium-mcp`. Cada proceso **es** una sesión: se
 * anuncia al conectarse (presencia, `control.rs`) y manda su id en cada pedido.
 * Acá está lo puro:
 *
 * - qué es un anuncio de sesión válido;
 * - las **reservas**: un aviso con vencimiento sobre una nota o carpeta —no un
 *   bloqueo—, cuándo dos se pisan, renovar, liberar, limpiar las de una sesión
 *   que murió;
 * - lo que `mycelium_estado` (y `mycelium_sesion`, `mycelium_reservar`) le
 *   cuentan a una sesión de las otras, ya redactado;
 * - agrupar el registro de actividad por sesión, para el panel.
 *
 * Sin stores ni Tauri, para probarlo con `node --test scripts/test-sesiones-ia.mjs`.
 * El estado vive en `stores/sesionesIaStore.ts`, **en memoria**: si Mycelium se
 * cierra, sesiones y reservas se pierden (los servidores se vuelven a anunciar
 * solos al reabrir; las tareas y las reservas, no).
 */
import type { Entrada, EntradaVista } from "@/lib/actividadIa";

// ── Constantes ──────────────────────────────────────────────────────────────

/** Duración de una reserva si no se pide otra. */
export const MINUTOS_RESERVA_DEFECTO = 30;
/** Lo más que puede durar una reserva (se renueva reservando de nuevo). */
export const MINUTOS_RESERVA_TOPE = 240;
/** Largo máximo de una tarea y de un motivo. */
export const TOPE_TEXTO = 200;
/** Qué cuenta como «recién»: lo modificado en esta ventana de tiempo. */
export const VENTANA_RECIENTES_MS = 30 * 60 * 1000;
/** Una sesión que nunca se anunció por presencia se olvida tras esta inactividad. */
export const OLVIDAR_SIN_PRESENCIA_MS = 30 * 60 * 1000;
/** Cuántos renglones de cada lista se cuentan a la IA. */
const TOPE_LISTA = 10;

// ── Tipos ───────────────────────────────────────────────────────────────────

export type ClienteIa = { nombre: string; version: string };

/** Lo que manda el servidor de cada sesión (`mycelium-mcp/src/sesion.rs`). */
export type DatosSesion = {
  id: string;
  pid: number | null;
  /** Cuándo arrancó el proceso (ms). */
  inicio: number;
  cliente: ClienteIa | null;
};

export type SesionIa = DatosSesion & {
  /** Lo que declaró con `mycelium_sesion`, o `null`. */
  tarea: string | null;
  /** Cuándo pidió algo por última vez (ms), o `null` si todavía nada. */
  ultimaActividad: number | null;
  /** Está sostenida por su conexión de presencia: si se corta, murió. */
  presente: boolean;
};

export type ObjetivoReserva = {
  clase: "nota" | "carpeta";
  /** Ruta relativa al vault, con `/`, sin barra final. */
  ruta: string;
  /** `false` si es una nota que todavía no existe (se reservó para crearla). */
  existe: boolean;
};

export type Reserva = {
  sesion: string;
  objetivo: ObjetivoReserva;
  motivo: string;
  desde: number;
  vence: number;
};

/** Una ruta que cambió en disco sin pasar por Mycelium (watcher). */
export type CambioExterno = { ruta: string; momento: number; borrada: boolean };

export type ErrorSesiones = { codigo: "INVALIDO" | "NO_ENCONTRADO" | "AMBIGUO"; mensaje: string; datos: unknown };
export type Validado<T> = { ok: true; valor: T } | { ok: false; error: ErrorSesiones };

const invalido = (campo: string, mensaje: string): { ok: false; error: ErrorSesiones } => ({
  ok: false,
  error: { codigo: "INVALIDO", mensaje: `\`${campo}\`: ${mensaje}`, datos: { campo } },
});

// ── Anuncios ────────────────────────────────────────────────────────────────

/** Un id de sesión usable: corto, sin espacios ni caracteres raros (lo mismo que exige `control.rs`). */
export function esIdSesion(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 64 && /^[A-Za-z0-9_-]+$/.test(x);
}

/** El campo `sesion` de un pedido (o un anuncio), o `null` si no sirve. */
export function leerDatosSesion(x: unknown): DatosSesion | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (!esIdSesion(o.id)) return null;
  const c = o.cliente as Record<string, unknown> | null | undefined;
  const cliente =
    c && typeof c === "object" && typeof c.nombre === "string" && c.nombre.trim() !== ""
      ? { nombre: c.nombre.trim(), version: typeof c.version === "string" ? c.version.trim() : "" }
      : null;
  return {
    id: o.id,
    pid: typeof o.pid === "number" && Number.isFinite(o.pid) ? o.pid : null,
    inicio: typeof o.inicio === "number" && Number.isFinite(o.inicio) ? o.inicio : 0,
    cliente,
  };
}

/**
 * Las sesiones después de que Rust avisó cuáles están conectadas: las de la
 * lista quedan (con su tarea y actividad), las que estaban presentes y ya no
 * figuran murieron, y las que nunca se anunciaron (pidieron algo antes de que
 * llegara su presencia) se conservan hasta que se anuncien o se olviden.
 */
export function conConectadas(
  previas: Readonly<Record<string, SesionIa>>,
  conectadas: readonly DatosSesion[],
): { sesiones: Record<string, SesionIa>; murieron: string[] } {
  const sesiones: Record<string, SesionIa> = {};
  const vivas = new Set(conectadas.map((d) => d.id));
  for (const d of conectadas) {
    const p = previas[d.id];
    sesiones[d.id] = { ...d, tarea: p?.tarea ?? null, ultimaActividad: p?.ultimaActividad ?? null, presente: true };
  }
  const murieron: string[] = [];
  for (const [id, s] of Object.entries(previas)) {
    if (vivas.has(id)) continue;
    if (s.presente) murieron.push(id);
    else sesiones[id] = s;
  }
  return { sesiones, murieron };
}

/** Registra que la sesión pidió algo ahora (la crea si no se había anunciado). */
export function conActividad(previas: Readonly<Record<string, SesionIa>>, d: DatosSesion, ahora: number): Record<string, SesionIa> {
  const p = previas[d.id];
  return {
    ...previas,
    [d.id]: p
      ? { ...p, cliente: p.cliente ?? d.cliente, ultimaActividad: ahora }
      : { ...d, tarea: null, ultimaActividad: ahora, presente: false },
  };
}

/** Las que nunca se anunciaron y llevan mucho sin pedir nada: se olvidan. */
export function sinOlvidadas(sesiones: Readonly<Record<string, SesionIa>>, ahora: number): { sesiones: Record<string, SesionIa>; olvidadas: string[] } {
  const quedan: Record<string, SesionIa> = {};
  const olvidadas: string[] = [];
  for (const [id, s] of Object.entries(sesiones)) {
    if (!s.presente && ahora - (s.ultimaActividad ?? s.inicio) > OLVIDAR_SIN_PRESENCIA_MS) olvidadas.push(id);
    else quedan[id] = s;
  }
  return { sesiones: quedan, olvidadas };
}

// ── Validar los argumentos ──────────────────────────────────────────────────

function sobrantes(args: Record<string, unknown>, permitidos: readonly string[]): { ok: false; error: ErrorSesiones } | null {
  const otro = Object.keys(args).find((k) => !permitidos.includes(k));
  return otro ? invalido(otro, `campo desconocido (se aceptan: ${permitidos.join(", ")}).`) : null;
}

/** Un texto de una línea, sin espacios de más; `null` si no es texto o quedó vacío. */
function unaLinea(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/** `mycelium_sesion({tarea})`. */
export function validarSesion(args: Record<string, unknown>): Validado<{ tarea: string }> {
  const s = sobrantes(args, ["tarea"]);
  if (s) return s;
  const tarea = unaLinea(args.tarea);
  if (tarea === null) return invalido("tarea", "falta la tarea, en una línea.");
  if (tarea.length > TOPE_TEXTO) return invalido("tarea", `es demasiado larga (${tarea.length} caracteres; hasta ${TOPE_TEXTO}).`);
  return { ok: true, valor: { tarea } };
}

export type PedidoReserva =
  | { liberar: true; objetivo: string | null }
  | { liberar: false; objetivo: string; motivo: string; minutos: number };

/** `mycelium_reservar({objetivo, motivo, minutos?, liberar?})`. */
export function validarReservar(args: Record<string, unknown>): Validado<PedidoReserva> {
  const s = sobrantes(args, ["objetivo", "motivo", "minutos", "liberar"]);
  if (s) return s;
  if (args.liberar !== undefined && typeof args.liberar !== "boolean") return invalido("liberar", "va true o false.");
  const objetivo = args.objetivo === undefined ? null : unaLinea(args.objetivo);
  if (args.objetivo !== undefined && objetivo === null) return invalido("objetivo", "está vacío.");
  if (args.liberar === true) return { ok: true, valor: { liberar: true, objetivo } };
  if (objetivo === null) return invalido("objetivo", "falta: una nota (ruta o título) o una carpeta (ruta).");
  const motivo = unaLinea(args.motivo);
  if (motivo === null) return invalido("motivo", "falta: para qué se reserva, en una línea.");
  if (motivo.length > TOPE_TEXTO) return invalido("motivo", `es demasiado largo (${motivo.length} caracteres; hasta ${TOPE_TEXTO}).`);
  let minutos = MINUTOS_RESERVA_DEFECTO;
  if (args.minutos !== undefined) {
    const m = args.minutos;
    if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > MINUTOS_RESERVA_TOPE) {
      return invalido("minutos", `va un entero entre 1 y ${MINUTOS_RESERVA_TOPE}.`);
    }
    minutos = m;
  }
  return { ok: true, valor: { liberar: false, objetivo, motivo, minutos } };
}

// ── El objetivo de una reserva ──────────────────────────────────────────────

/** Ruta del vault normalizada: `/`, sin `./` ni barras en los extremos. */
export function normalizarRuta(ruta: string): string {
  return ruta.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "").trim();
}

/**
 * El objetivo de la reserva a partir de cómo lo resolvió `resolverAfectado`
 * (`lib/mcpArchivosLogica.ts`, las reglas de renombrar y mover). Una nota que
 * **todavía no existe** se puede reservar por su ruta (para crearla sin que otra
 * sesión cree la misma): si no se encontró y parece una ruta —tiene `/` o
 * termina en `.md`—, se acepta así. Un título suelto que no existe sigue siendo
 * `NO_ENCONTRADO` (con las parecidas): un typo no debe reservar la nada.
 */
export function objetivoDeReserva(
  crudo: string,
  resolucion:
    | { ok: true; valor: { clase: "nota"; nota: { id: string } } | { clase: "carpeta"; carpeta: { id: string } } }
    | { ok: false; error: { codigo: string; mensaje: string; datos: unknown } },
): Validado<ObjetivoReserva> {
  if (resolucion.ok) {
    const v = resolucion.valor;
    return v.clase === "nota"
      ? { ok: true, valor: { clase: "nota", ruta: v.nota.id, existe: true } }
      : { ok: true, valor: { clase: "carpeta", ruta: v.carpeta.id, existe: true } };
  }
  const t = crudo.replace(/\\/g, "/").trim();
  const pareceRuta = t.includes("/") || /\.md$/i.test(t);
  if (resolucion.error.codigo === "NO_ENCONTRADO" && pareceRuta) {
    const ruta = normalizarRuta(t);
    if (ruta === "" || ruta.split("/").some((p) => p === "" || p === "." || p === "..")) {
      return invalido("objetivo", `«${crudo}» no es una ruta del vault.`);
    }
    if (t.endsWith("/")) return { ok: true, valor: { clase: "carpeta", ruta, existe: false } };
    return { ok: true, valor: { clase: "nota", ruta: /\.[A-Za-z0-9]+$/.test(ruta) ? ruta : `${ruta}.md`, existe: false } };
  }
  const { codigo, mensaje, datos } = resolucion.error;
  return {
    ok: false,
    error: { codigo: codigo === "NO_ENCONTRADO" || codigo === "AMBIGUO" ? codigo : "INVALIDO", mensaje, datos },
  };
}

// ── Reservas ────────────────────────────────────────────────────────────────

const enCarpeta = (ruta: string, carpeta: string) => ruta.toLowerCase().startsWith(`${carpeta.toLowerCase()}/`);
const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Si dos objetivos se pisan: la misma ruta, o uno es una carpeta que contiene
 * al otro. Sin distinguir mayúsculas, como el sistema de archivos de Windows.
 */
export function sePisan(a: ObjetivoReserva, b: ObjetivoReserva): boolean {
  if (igual(a.ruta, b.ruta)) return true;
  if (a.clase === "carpeta" && enCarpeta(b.ruta, a.ruta)) return true;
  if (b.clase === "carpeta" && enCarpeta(a.ruta, b.ruta)) return true;
  return false;
}

export function vigentes(reservas: readonly Reserva[], ahora: number): Reserva[] {
  return reservas.filter((r) => r.vence > ahora);
}

/**
 * Concede una reserva **siempre** (es un aviso): devuelve la lista nueva, las
 * reservas vigentes de OTRAS sesiones que se pisan con ella, y si renovó una
 * propia sobre la misma ruta. Las vencidas se descartan de paso.
 */
export function reservar(
  reservas: readonly Reserva[],
  nueva: Reserva,
  ahora: number,
): { reservas: Reserva[]; conflictos: Reserva[]; renovada: boolean } {
  const vivas = vigentes(reservas, ahora);
  const propiaMisma = (r: Reserva) => r.sesion === nueva.sesion && igual(r.objetivo.ruta, nueva.objetivo.ruta);
  const renovada = vivas.some(propiaMisma);
  const conflictos = vivas.filter((r) => r.sesion !== nueva.sesion && sePisan(r.objetivo, nueva.objetivo));
  return { reservas: [...vivas.filter((r) => !propiaMisma(r)), nueva], conflictos, renovada };
}

/**
 * Suelta las reservas de `sesion` sobre `ruta` (o todas, con `null`). Una
 * ruta que nombra una carpeta suelta solo esa reserva, no las de adentro.
 */
export function liberar(
  reservas: readonly Reserva[],
  sesion: string,
  ruta: string | null,
  ahora: number,
): { reservas: Reserva[]; liberadas: Reserva[] } {
  const vivas = vigentes(reservas, ahora);
  const suelta = (r: Reserva) => r.sesion === sesion && (ruta === null || igual(r.objetivo.ruta, ruta));
  return { reservas: vivas.filter((r) => !suelta(r)), liberadas: vivas.filter(suelta) };
}

/** Sin las reservas de unas sesiones (murieron). */
export function sinReservasDe(reservas: readonly Reserva[], sesiones: Iterable<string>): Reserva[] {
  const fuera = new Set(sesiones);
  return reservas.filter((r) => !fuera.has(r.sesion));
}

// ── Textos ──────────────────────────────────────────────────────────────────

/** «hace un momento», «hace 3 min», «hace 2 h». */
export function hace(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h`;
}

/** «vence en 25 min» (redondeado hacia arriba: «en 0 min» no se dice). */
export function venceEn(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return min < 60 ? `vence en ${min} min` : `vence en ${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Cómo se nombra una sesión: `id «tarea»`, o el id solo. */
export function nombreSesion(id: string, sesiones: Readonly<Record<string, SesionIa>>): string {
  const t = sesiones[id]?.tarea;
  return t ? `${id} «${t}»` : id;
}

function describirObjetivo(o: ObjetivoReserva): string {
  const clase = o.clase === "carpeta" ? "carpeta" : "nota";
  return `${o.ruta}${o.clase === "carpeta" ? "/" : ""} (${clase}${o.existe ? "" : ", todavía no existe"})`;
}

/** El efecto de `mycelium_reservar` al reservar: lo que recibe la IA y lo que va al registro. */
export function efectoReserva(
  r: Reserva,
  conflictos: readonly Reserva[],
  renovada: boolean,
  sesiones: Readonly<Record<string, SesionIa>>,
  ahora: number,
): string {
  const minutos = Math.round((r.vence - r.desde) / 60_000);
  let t = `${renovada ? "Renové" : "Reservé"} ${describirObjetivo(r.objetivo)} por ${minutos} min: «${r.motivo}».`;
  if (conflictos.length > 0) {
    t += " Ojo: la reserva es un aviso, no un bloqueo, y esto ya lo tiene otra sesión:";
    for (const c of conflictos) {
      t += `\n  - ${describirObjetivo(c.objetivo)} · sesión ${nombreSesion(c.sesion, sesiones)} · «${c.motivo}» · ${venceEn(c.vence - ahora)}`;
    }
    t += "\nAntes de tocarlo, coordina con el usuario (o espera a que lo libere).";
  }
  return t;
}

export function efectoLiberar(liberadas: readonly Reserva[], ruta: string | null): string {
  if (liberadas.length === 0) {
    return ruta === null ? "Esta sesión no tenía reservas vigentes." : `Esta sesión no tenía reservado «${ruta}».`;
  }
  if (liberadas.length === 1) return `Liberé ${describirObjetivo(liberadas[0].objetivo)}.`;
  return `Liberé ${liberadas.length} reservas: ${liberadas.map((r) => r.objetivo.ruta).join(", ")}.`;
}

// ── Lo modificado recién ────────────────────────────────────────────────────

/** Las operaciones del registro que cambian notas o carpetas. */
const MODIFICAN: ReadonlySet<string> = new Set(["renombrar", "mover", "borrar", "papelera", "reparar_renombre", "bandeja"]);

export type Modificacion = { ruta: string; sesion: string; op: string; momento: number };

/**
 * Lo que otras sesiones cambiaron **por Mycelium** en la ventana de recientes,
 * del registro de actividad: una línea por ruta, la más nueva.
 */
export function modificadasPorOtras(entradas: readonly Entrada[], propia: string | null, ahora: number): Modificacion[] {
  const porRuta = new Map<string, Modificacion>();
  for (const e of entradas) {
    if (e.resultado !== "hecho" || !e.sesion || e.sesion === propia || !MODIFICAN.has(e.op)) continue;
    const o = e.objetivo;
    if (!o || (o.tipo !== "nota" && o.tipo !== "carpeta")) continue;
    const momento = Date.parse(e.momento);
    if (!(ahora - momento <= VENTANA_RECIENTES_MS)) continue;
    const previa = porRuta.get(o.ruta);
    if (!previa || previa.momento <= momento) porRuta.set(o.ruta, { ruta: o.ruta, sesion: e.sesion, op: e.op, momento });
  }
  return [...porRuta.values()].sort((a, b) => b.momento - a.momento);
}

/** Los cambios externos de la ventana de recientes, una línea por ruta (el último). */
export function externosRecientes(cambios: readonly CambioExterno[], ahora: number): CambioExterno[] {
  const porRuta = new Map<string, CambioExterno>();
  for (const c of cambios) {
    if (ahora - c.momento > VENTANA_RECIENTES_MS) continue;
    const p = porRuta.get(c.ruta);
    if (!p || p.momento <= c.momento) porRuta.set(c.ruta, c);
  }
  return [...porRuta.values()].sort((a, b) => b.momento - a.momento);
}

// ── Lo que se le cuenta a una sesión ────────────────────────────────────────

export type Coordinacion = {
  sesion: string | null;
  tarea: string | null;
  sesiones: { id: string; tarea: string | null; cliente: string | null; desde_min: number; actividad_min: number | null }[];
  reservas_propias: { ruta: string; clase: string; motivo: string; vence_min: number }[];
  reservas_ajenas: { ruta: string; clase: string; sesion: string; tarea: string | null; motivo: string; vence_min: number }[];
  modificadas: { ruta: string; sesion: string; op: string; hace_min: number }[];
  externas: { ruta: string; borrada: boolean; hace_min: number }[];
  /** Todo lo anterior, ya redactado para la IA. */
  texto: string;
};

const minutos = (ms: number) => Math.max(0, Math.floor(ms / 60_000));

function recorte<T>(lista: readonly T[], linea: (x: T) => string): string {
  let t = lista.slice(0, TOPE_LISTA).map((x) => `\n  - ${linea(x)}`).join("");
  if (lista.length > TOPE_LISTA) t += `\n  - … y ${lista.length - TOPE_LISTA} más`;
  return t;
}

/**
 * Lo que `mycelium_estado`, `mycelium_sesion` y `mycelium_reservar` agregan
 * para la sesión `propia`: las otras sesiones conectadas, lo que tienen
 * reservado, lo que cambiaron recién por Mycelium y lo que cambió en disco por
 * fuera (sin atribuir: el watcher no sabe quién escribió).
 */
export function coordinacion(datos: {
  propia: string | null;
  sesiones: Readonly<Record<string, SesionIa>>;
  reservas: readonly Reserva[];
  entradas: readonly Entrada[];
  externos: readonly CambioExterno[];
  ahora: number;
  /** Nombres de operación para el texto (`NOMBRE_OP`). */
  nombreOp?: Readonly<Record<string, string>>;
}): Coordinacion {
  const { propia, sesiones, ahora } = datos;
  const vivas = vigentes(datos.reservas, ahora);
  const otras = Object.values(sesiones)
    .filter((s) => s.id !== propia)
    .sort((a, b) => a.inicio - b.inicio);
  const yo = propia ? sesiones[propia] : undefined;
  const c: Coordinacion = {
    sesion: propia,
    tarea: yo?.tarea ?? null,
    sesiones: otras.map((s) => ({
      id: s.id,
      tarea: s.tarea,
      cliente: s.cliente ? `${s.cliente.nombre}${s.cliente.version ? ` ${s.cliente.version}` : ""}` : null,
      desde_min: minutos(ahora - s.inicio),
      actividad_min: s.ultimaActividad === null ? null : minutos(ahora - s.ultimaActividad),
    })),
    reservas_propias: vivas
      .filter((r) => r.sesion === propia)
      .map((r) => ({ ruta: r.objetivo.ruta, clase: r.objetivo.clase, motivo: r.motivo, vence_min: Math.ceil((r.vence - ahora) / 60_000) })),
    reservas_ajenas: vivas
      .filter((r) => r.sesion !== propia)
      .map((r) => ({
        ruta: r.objetivo.ruta,
        clase: r.objetivo.clase,
        sesion: r.sesion,
        tarea: sesiones[r.sesion]?.tarea ?? null,
        motivo: r.motivo,
        vence_min: Math.ceil((r.vence - ahora) / 60_000),
      })),
    modificadas: modificadasPorOtras(datos.entradas, propia, ahora).map((m) => ({
      ruta: m.ruta,
      sesion: m.sesion,
      op: m.op,
      hace_min: minutos(ahora - m.momento),
    })),
    externas: externosRecientes(datos.externos, ahora).map((x) => ({ ruta: x.ruta, borrada: x.borrada, hace_min: minutos(ahora - x.momento) })),
    texto: "",
  };

  const total = otras.length + (yo ? 1 : 0);
  let t =
    otras.length === 0
      ? "Sesiones de IA en este vault: solo esta."
      : `Sesiones de IA en este vault: ${total} conectadas${yo ? " (contando esta)" : ""}.`;
  if (propia) {
    t += `\nEsta sesión: ${propia} · ${
      c.tarea ? `tarea «${c.tarea}»` : "sin tarea declarada (declárala con mycelium_sesion si vas a trabajar un rato)"
    }.`;
  }
  if (c.reservas_propias.length > 0) {
    t += `\nTus reservas:${recorte(vivas.filter((r) => r.sesion === propia), (r) => `${describirObjetivo(r.objetivo)} · «${r.motivo}» · ${venceEn(r.vence - ahora)}`)}`;
  }
  if (otras.length > 0) {
    t += `\nOtras sesiones:${recorte(otras, (s) => {
      const tarea = s.tarea ? `«${s.tarea}»` : "sin tarea declarada";
      const act = s.ultimaActividad === null ? "todavía no pidió nada" : `última actividad ${hace(ahora - s.ultimaActividad)}`;
      return `${s.id} · ${tarea} · conectada ${hace(ahora - s.inicio)} · ${act}`;
    })}`;
  }
  const ajenas = vivas.filter((r) => r.sesion !== propia);
  if (ajenas.length > 0) {
    t += `\nReservado por otras sesiones (es un aviso: coordina antes de tocarlo):${recorte(
      ajenas,
      (r) => `${describirObjetivo(r.objetivo)} · sesión ${nombreSesion(r.sesion, sesiones)} · «${r.motivo}» · ${venceEn(r.vence - ahora)}`,
    )}`;
  }
  const mods = modificadasPorOtras(datos.entradas, propia, ahora);
  if (mods.length > 0) {
    const nombre = (op: string) => datos.nombreOp?.[op] ?? op;
    t += `\nCambiado por otras sesiones a través de Mycelium (últimos 30 min):${recorte(
      mods,
      (m) => `${m.ruta} · ${nombre(m.op)} · ${hace(ahora - m.momento)} · sesión ${nombreSesion(m.sesion, sesiones)}`,
    )}`;
  }
  const ext = externosRecientes(datos.externos, ahora);
  if (ext.length > 0) {
    t +=
      "\nCambiado en disco por fuera de Mycelium (últimos 30 min; no se sabe quién: esta sesión, otra, el usuario en otro editor o git):" +
      recorte(ext, (x) => `${x.ruta}${x.borrada ? " (ya no está)" : ""} · ${hace(ahora - x.momento)}`);
  }
  c.texto = t;
  return c;
}

// ── El registro agrupado por sesión ─────────────────────────────────────────

export type GrupoActividad = {
  /** Clave estable para React: el id de sesión, o `sin-sesion`. */
  clave: string;
  sesion: string | null;
  tarea: string | null;
  /** La sesión sigue conectada. */
  conectada: boolean;
  entradas: EntradaVista[];
};

/**
 * Agrupa lo que muestra el panel (de lo más nuevo a lo más viejo) por sesión:
 * los grupos van en el orden de su entrada más nueva y, adentro, como venían.
 * La tarea del encabezado es la de la sesión si sigue conectada; si no, la
 * última que figura en sus entradas. Lo registrado antes de que existieran las
 * sesiones (o sin sesión) va en un grupo aparte.
 */
export function agruparPorSesion(
  vista: readonly EntradaVista[],
  sesiones: Readonly<Record<string, SesionIa>>,
): GrupoActividad[] {
  const grupos = new Map<string, GrupoActividad>();
  for (const e of vista) {
    const clave = e.sesion ?? "sin-sesion";
    let g = grupos.get(clave);
    if (!g) {
      const viva = e.sesion ? sesiones[e.sesion] : undefined;
      g = { clave, sesion: e.sesion ?? null, tarea: viva?.tarea ?? null, conectada: viva !== undefined, entradas: [] };
      grupos.set(clave, g);
    }
    if (g.tarea === null && e.tarea) g.tarea = e.tarea;
    g.entradas.push(e);
  }
  return [...grupos.values()];
}
