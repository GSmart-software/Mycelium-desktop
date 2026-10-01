/**
 * La lógica **pura** de las herramientas del calendario del MCP de control
 * (`FUN-L-09`, Parte 2; spec en `docs/features/mcp-control.md` § 3.2):
 * validar lo que pide el agente, los colores por nombre, las ocurrencias de un
 * rango, la próxima ocurrencia, el texto del **efecto** y lo que se guarda
 * para **deshacer**. Sin stores ni Tauri, para probarla con
 * `scripts/test-mcp-calendario.mjs`; el cableado está en `lib/mcpCalendario.ts`.
 *
 * > [!important] No duplica reglas del calendario
 * > Fechas, horas, repeticiones, la paleta y las ocurrencias son las de
 * > `lib/recordatorios.ts`, las mismas que usa la UI. Acá solo se decide qué
 * > se le contesta a un agente: qué está mal en sus argumentos y cómo se dice
 * > lo que pasó.
 */
import { distancia, plano, type Referencia } from "@/lib/mcpControlLogica";
import {
  COLORES,
  REPETICIONES,
  aDate,
  claveOcurrencia,
  diasEntre,
  esFechaValida,
  esHoraValida,
  estaCompletada,
  fechaLocal,
  momentoDeOcurrencia,
  ocurreEn,
  ocurrenciasEnRango,
  primerRenglon,
  sumarDias,
  type ArchivoRecordatorios,
  type ColorRecordatorio,
  type EstadoOcurrencia,
  type Recordatorio,
  type Repeticion,
} from "@/lib/recordatorios";

// ── Errores ─────────────────────────────────────────────────────────────────

/** Un error del contrato (spec § 3.1), listo para viajar por el canal. */
export type ErrorCalendario = { codigo: "INVALIDO" | "NO_ENCONTRADO"; mensaje: string; datos: unknown };

export type Validado<T> = { ok: true; valor: T } | { ok: false; error: ErrorCalendario };

const invalido = <T>(campo: string, porque: string): Validado<T> => ({
  ok: false,
  error: { codigo: "INVALIDO", mensaje: `\`${campo}\`: ${porque}`, datos: { campo } },
});

// ── Campos sueltos ──────────────────────────────────────────────────────────

/** Tope de un rango de `mycelium_recordatorios`, en días (inclusive). */
export const TOPE_RANGO_DIAS = 366;

/** Cuánto del detalle va en un listado: el primer renglón, recortado. */
const LARGO_DETALLE = 120;

/** El color por su nombre de la paleta, sin distinguir mayúsculas ni tildes. */
export function colorPorNombre(nombre: string): ColorRecordatorio | null {
  const buscado = plano(nombre.trim());
  return COLORES.find((c) => plano(c.nombre) === buscado)?.valor ?? null;
}

export function nombreDeColor(color: ColorRecordatorio): string {
  return COLORES.find((c) => c.valor === color)?.nombre ?? COLORES[0].nombre;
}

const NOMBRES_COLORES = COLORES.map((c) => c.nombre).join(", ");
const VALORES_REPETICION = REPETICIONES.map((r) => r.valor);

function validarFecha(campo: string, v: unknown): Validado<string> {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
    return invalido(campo, "tiene que ser una fecha AAAA-MM-DD (p. ej. 2026-10-03).");
  }
  const f = v.trim();
  if (!esFechaValida(f)) return invalido(campo, `«${f}» no existe en el calendario.`);
  return { ok: true, valor: f };
}

/** `hora`: `HH:MM` en 24 h; ausente, `null` o vacía = todo el día. */
function validarHora(v: unknown): Validado<string | null> {
  if (v === undefined || v === null || v === "") return { ok: true, valor: null };
  if (typeof v !== "string" || !esHoraValida(v.trim())) {
    return invalido("hora", `«${String(v)}» no es una hora HH:MM de 24 h (p. ej. 09:30); para todo el día, omitila o mandá null.`);
  }
  return { ok: true, valor: v.trim() };
}

function validarTitulo(v: unknown): Validado<string> {
  if (typeof v !== "string" || v.trim() === "") return invalido("titulo", "no puede estar vacío.");
  if (/[\r\n]/.test(v.trim())) return invalido("titulo", "va en una sola línea; lo largo va en `detalle`.");
  return { ok: true, valor: v.trim() };
}

function validarRepeticion(v: unknown): Validado<Repeticion> {
  if (v === undefined || v === null || v === "") return { ok: true, valor: "ninguna" };
  const r = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!(VALORES_REPETICION as string[]).includes(r)) {
    return invalido("repeticion", `«${String(v)}» no es una repetición; usá ${VALORES_REPETICION.join(", ")}.`);
  }
  return { ok: true, valor: r as Repeticion };
}

function validarColor(v: unknown): Validado<ColorRecordatorio> {
  if (v === undefined || v === null || v === "") return { ok: true, valor: COLORES[0].valor };
  const c = typeof v === "string" ? colorPorNombre(v) : null;
  if (c === null) return invalido("color", `«${String(v)}» no está en la paleta; los colores son ${NOMBRES_COLORES}.`);
  return { ok: true, valor: c };
}

function validarDetalle(v: unknown): Validado<string> {
  if (v === undefined || v === null) return { ok: true, valor: "" };
  if (typeof v !== "string") return invalido("detalle", "es texto markdown.");
  return { ok: true, valor: v };
}

function validarId(v: unknown): Validado<string> {
  if (typeof v !== "string" || v.trim() === "") {
    return invalido("id", "falta el id del recordatorio (lo da mycelium_recordatorios).");
  }
  return { ok: true, valor: v.trim() };
}

/** Rechaza las claves que la herramienta no conoce: un typo no debe pasar en silencio. */
function clavesConocidas(args: Record<string, unknown>, conocidas: string[]): Validado<null> {
  const extra = Object.keys(args).find((k) => !conocidas.includes(k));
  return extra === undefined
    ? { ok: true, valor: null }
    : invalido(extra, `no es un campo de esta herramienta (son: ${conocidas.join(", ")}).`);
}

// ── Lo que pide cada herramienta ────────────────────────────────────────────

/** Los campos editables de un recordatorio, ya validados. */
export type CamposRecordatorio = Pick<Recordatorio, "titulo" | "fecha" | "hora" | "repeticion" | "color" | "detalle">;

const CAMPOS = ["titulo", "fecha", "hora", "repeticion", "color", "detalle"] as const;

/** Un validador por campo (todos aceptan «ausente» salvo título y fecha, que se chequean aparte). */
const VALIDADORES: { [K in keyof CamposRecordatorio]: (v: unknown) => Validado<CamposRecordatorio[K]> } = {
  titulo: validarTitulo,
  fecha: (v) => validarFecha("fecha", v),
  hora: validarHora,
  repeticion: validarRepeticion,
  color: validarColor,
  detalle: validarDetalle,
};

export function validarRango(args: Record<string, unknown>): Validado<{ desde: string; hasta: string }> {
  const k = clavesConocidas(args, ["desde", "hasta"]);
  if (!k.ok) return k;
  const desde = validarFecha("desde", args.desde);
  if (!desde.ok) return desde;
  const hasta = validarFecha("hasta", args.hasta);
  if (!hasta.ok) return hasta;
  const dias = diasEntre(desde.valor, hasta.valor);
  if (dias < 0) return invalido("hasta", "es anterior a `desde`.");
  if (dias + 1 > TOPE_RANGO_DIAS) {
    return invalido("hasta", `el rango es de ${dias + 1} días y el tope es ${TOPE_RANGO_DIAS}: partilo en varias llamadas.`);
  }
  return { ok: true, valor: { desde: desde.valor, hasta: hasta.valor } };
}

export function validarCrear(args: Record<string, unknown>): Validado<CamposRecordatorio> {
  const k = clavesConocidas(args, [...CAMPOS]);
  if (!k.ok) return k;
  const salida: Partial<CamposRecordatorio> = {};
  for (const campo of CAMPOS) {
    const v = VALIDADORES[campo](args[campo]);
    if (!v.ok) return v;
    (salida as Record<string, unknown>)[campo] = v.valor;
  }
  return { ok: true, valor: salida as CamposRecordatorio };
}

/** Lo que cambia en una edición: solo los campos presentes. */
export function validarEditar(
  args: Record<string, unknown>,
): Validado<{ id: string; cambios: Partial<CamposRecordatorio> }> {
  const k = clavesConocidas(args, ["id", ...CAMPOS]);
  if (!k.ok) return k;
  const id = validarId(args.id);
  if (!id.ok) return id;
  const cambios: Partial<CamposRecordatorio> = {};
  for (const campo of CAMPOS) {
    if (!(campo in args)) continue;
    // `hora: null` es un cambio (pasa a todo el día); en los demás, null no cambia nada.
    if (args[campo] === null && campo !== "hora" && campo !== "detalle") continue;
    const v = VALIDADORES[campo](args[campo]);
    if (!v.ok) return v;
    (cambios as Record<string, unknown>)[campo] = v.valor;
  }
  if (Object.keys(cambios).length === 0) {
    return invalido("id", `no hay nada que cambiar: mandá al menos uno de ${CAMPOS.join(", ")}.`);
  }
  return { ok: true, valor: { id: id.valor, cambios } };
}

export function validarCompletar(
  args: Record<string, unknown>,
): Validado<{ id: string; fecha: string; completado: boolean }> {
  const k = clavesConocidas(args, ["id", "fecha", "completado"]);
  if (!k.ok) return k;
  const id = validarId(args.id);
  if (!id.ok) return id;
  const fecha = validarFecha("fecha", args.fecha);
  if (!fecha.ok) return fecha;
  const c = args.completado;
  if (c !== undefined && c !== null && typeof c !== "boolean") return invalido("completado", "es true o false.");
  return { ok: true, valor: { id: id.valor, fecha: fecha.valor, completado: c !== false } };
}

export function validarBorrar(args: Record<string, unknown>): Validado<{ id: string }> {
  const k = clavesConocidas(args, ["id"]);
  if (!k.ok) return k;
  const id = validarId(args.id);
  return id.ok ? { ok: true, valor: { id: id.valor } } : id;
}

// ── Buscar por id ───────────────────────────────────────────────────────────

/**
 * El recordatorio con ese id, o `NO_ENCONTRADO` con los más parecidos por
 * título: el agente a veces manda el título en vez del id, y así corrige en la
 * misma vuelta.
 */
export function buscarRecordatorio(archivo: ArchivoRecordatorios, id: string): Validado<Recordatorio> {
  const r = archivo.recordatorios.find((x) => x.id === id);
  if (r) return { ok: true, valor: r };
  return {
    ok: false,
    error: {
      codigo: "NO_ENCONTRADO",
      mensaje: `No hay ningún recordatorio con id «${id}». Los ids los da mycelium_recordatorios.`,
      datos: { candidatas: recordatoriosParecidos(archivo.recordatorios, id) },
    },
  };
}

/** Hasta cinco recordatorios cuyo título se parece a `texto`, con su id. */
export function recordatoriosParecidos(recordatorios: readonly Recordatorio[], texto: string, max = 5): Referencia[] {
  const buscado = plano(texto.trim());
  if (buscado === "") return [];
  return recordatorios
    .map((r) => {
      const t = plano(r.titulo);
      let p = 1 - distancia(buscado, t) / Math.max(buscado.length, t.length, 1);
      if (t.includes(buscado) || buscado.includes(t)) p = Math.max(p, 0.6) + 0.2;
      return { r, p };
    })
    .filter((x) => x.p >= 0.5)
    .sort((a, b) => b.p - a.p || a.r.titulo.localeCompare(b.r.titulo, "es"))
    .slice(0, max)
    .map(({ r }) => ({ titulo: r.titulo, ruta: `id ${r.id}` }));
}

// ── Fechas para leer ────────────────────────────────────────────────────────

const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** «viernes 3 de octubre» (y el año si no es el de `hoy`). */
export function diaLegible(fecha: string, hoy: string): string {
  const d = aDate(fecha);
  const anio = fecha.slice(0, 4) === hoy.slice(0, 4) ? "" : ` de ${d.getFullYear()}`;
  return `${DIAS[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MESES[d.getMonth()]}${anio}`;
}

/** «el viernes 3 de octubre a las 10:00», «hoy, todo el día», «mañana a las 9:00». */
export function cuandoLegible(fecha: string, hora: string | null, hoy: string): string {
  const dias = diasEntre(hoy, fecha);
  const dia = dias === 0 ? "hoy" : dias === 1 ? "mañana" : `el ${diaLegible(fecha, hoy)}`;
  return hora === null ? `${dia}, todo el día` : `${dia} a las ${hora}`;
}

function repeticionLegible(r: Recordatorio): string | null {
  const d = aDate(r.fecha);
  switch (r.repeticion) {
    case "ninguna":
      return null;
    case "dia":
      return "se repite cada día";
    case "semana":
      return `se repite cada ${DIAS[(d.getDay() + 6) % 7]}`;
    case "mes":
      return `se repite cada mes, el día ${d.getDate()}`;
    case "anio":
      return `se repite cada año, el ${d.getDate()} de ${MESES[d.getMonth()]}`;
  }
}

// ── Las ocurrencias de un rango ─────────────────────────────────────────────

/** Una ocurrencia como la recibe el servidor para redactarla. */
export type OcurrenciaIa = {
  id: string;
  titulo: string;
  fecha: string;
  /** «vie 3 oct», para leer sin calcular el día de la semana. */
  dia: string;
  hora: string | null;
  color: string;
  repeticion: Repeticion;
  completada: boolean;
  /** El primer renglón del detalle, sin marcas y recortado. */
  detalle: string;
};

const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function diaCorto(fecha: string): string {
  const d = aDate(fecha);
  return `${DIAS_CORTOS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

function abreviar(detalle: string): string {
  const linea = primerRenglon(detalle);
  return linea.length > LARGO_DETALLE ? `${linea.slice(0, LARGO_DETALLE - 1)}…` : linea;
}

/** Las ocurrencias entre dos fechas, en el orden de la lista de la app. */
export function ocurrenciasParaIa(archivo: ArchivoRecordatorios, desde: string, hasta: string): OcurrenciaIa[] {
  return ocurrenciasEnRango(archivo.recordatorios, desde, hasta).map(({ recordatorio: r, fecha }) => ({
    id: r.id,
    titulo: r.titulo,
    fecha,
    dia: diaCorto(fecha),
    hora: r.hora,
    color: nombreDeColor(r.color),
    repeticion: r.repeticion,
    completada: estaCompletada(archivo, claveOcurrencia(r.id, fecha)),
    detalle: abreviar(r.detalle),
  }));
}

// ── La próxima ocurrencia y si va a avisar ──────────────────────────────────

/** Hasta dónde se busca la próxima: ocho años cubren un 29 de febrero anual. */
const HORIZONTE_DIAS = 8 * 366;

/**
 * La próxima ocurrencia desde `ahora` —la de hoy cuenta si es de todo el día
 * o su hora no pasó— y la primera que **va a avisar**: la que cae a partir de
 * ahora, porque un recordatorio no avisa por ocurrencias anteriores a su
 * `vigenteDesde` (`lib/recordatorios.ts`). Las dos difieren en uno de todo el
 * día para hoy: se ve hoy, pero su momento (la medianoche) ya pasó.
 */
export function proximaOcurrencia(
  r: Recordatorio,
  ahora: Date,
): { proxima: string | null; avisa: string | null } {
  const hoy = fechaLocal(ahora);
  const minuto = new Date(ahora);
  minuto.setSeconds(0, 0);
  let proxima: string | null = null;
  const inicio = r.fecha > hoy ? r.fecha : hoy;
  for (let i = 0; i <= HORIZONTE_DIAS; i++) {
    const fecha = sumarDias(inicio, i);
    if (!ocurreEn(r, fecha)) continue;
    const momento = momentoDeOcurrencia(r, fecha);
    if (proxima === null && (r.hora === null || momento >= minuto)) proxima = fecha;
    if (momento >= minuto) return { proxima, avisa: fecha };
    if (r.repeticion === "ninguna") break;
  }
  return { proxima, avisa: null };
}

/** «Va a avisar.», o por qué no / cuándo sí. */
function fraseAviso(r: Recordatorio, ahora: Date): string {
  const hoy = fechaLocal(ahora);
  const { proxima, avisa } = proximaOcurrencia(r, ahora);
  if (proxima === null) return "No va a avisar: su fecha ya pasó (queda en el calendario como pasado).";
  if (avisa === proxima) return "Va a avisar.";
  if (avisa === null) return "Se ve hoy en el calendario, pero no va a avisar: es de todo el día y el día ya empezó.";
  return `Hoy no avisa (es de todo el día y el día ya empezó); va a avisar ${cuandoLegible(avisa, r.hora, hoy)}.`;
}

// ── El efecto, en palabras ──────────────────────────────────────────────────

function cuandoDe(r: Recordatorio, ahora: Date): string {
  const hoy = fechaLocal(ahora);
  const { proxima } = proximaOcurrencia(r, ahora);
  const base = cuandoLegible(r.fecha, r.hora, hoy);
  const rep = repeticionLegible(r);
  if (rep === null) return base;
  const prox = proxima !== null && proxima !== r.fecha ? `; la próxima, ${cuandoLegible(proxima, r.hora, hoy)}` : "";
  return `${base} (${rep}${prox})`;
}

export function efectoCrear(r: Recordatorio, ahora: Date): string {
  return `Creé «${r.titulo}» para ${cuandoDe(r, ahora)}, color ${nombreDeColor(r.color)}. ${fraseAviso(r, ahora)}`;
}

const ETIQUETA_CAMPO: Record<keyof CamposRecordatorio, string> = {
  titulo: "título",
  fecha: "fecha",
  hora: "hora",
  repeticion: "repetición",
  color: "color",
  detalle: "detalle",
};

function valorLegible(campo: keyof CamposRecordatorio, r: Recordatorio): string {
  switch (campo) {
    case "titulo":
      return `«${r.titulo}»`;
    case "fecha":
      return r.fecha;
    case "hora":
      return r.hora ?? "todo el día";
    case "repeticion":
      return REPETICIONES.find((x) => x.valor === r.repeticion)?.nombre.toLowerCase() ?? r.repeticion;
    case "color":
      return nombreDeColor(r.color);
    case "detalle":
      return r.detalle.trim() === "" ? "vacío" : "nuevo texto";
  }
}

/** Los campos que de verdad cambian entre `antes` y `despues`. */
export function camposCambiados(antes: Recordatorio, despues: Recordatorio): (keyof CamposRecordatorio)[] {
  return CAMPOS.filter((c) => antes[c] !== despues[c]);
}

export function efectoEditar(antes: Recordatorio, despues: Recordatorio, ahora: Date): string {
  const cambiados = camposCambiados(antes, despues);
  if (cambiados.length === 0) return `«${despues.titulo}» ya estaba así: no cambié nada.`;
  const lista = cambiados
    .map((c) => (c === "detalle" ? "el detalle" : `${ETIQUETA_CAMPO[c]} ${valorLegible(c, antes)} → ${valorLegible(c, despues)}`))
    .join(", ");
  const cuando = cambiados.some((c) => c === "fecha" || c === "hora" || c === "repeticion")
    ? ` Queda para ${cuandoDe(despues, ahora)}. ${fraseAviso(despues, ahora)}`
    : "";
  return `Edité «${antes.titulo}»: ${lista}.${cuando}`;
}

export function efectoCompletar(r: Recordatorio, fecha: string, completado: boolean, previo: boolean, ahora: Date): string {
  const cuando = cuandoLegible(fecha, r.hora, fechaLocal(ahora));
  if (previo === completado) {
    return `«${r.titulo}» de ${cuando} ya estaba ${completado ? "completado" : "sin completar"}: no cambié nada.`;
  }
  return completado
    ? `Marqué como completado «${r.titulo}» de ${cuando}. Esa ocurrencia ya no avisa.`
    : `Desmarqué «${r.titulo}» de ${cuando}: vuelve a estar pendiente.`;
}

export function efectoBorrar(r: Recordatorio, ahora: Date): string {
  const serie = r.repeticion === "ninguna" ? "" : " (la serie entera)";
  return `Borré «${r.titulo}»${serie}, que era para ${cuandoDe(r, ahora)}. El usuario lo puede deshacer desde el registro de actividad de Mycelium.`;
}

/** Si `fecha` no es una ocurrencia de `r`: el error, con las ocurrencias vecinas. */
export function comprobarOcurrencia(r: Recordatorio, fecha: string): Validado<null> {
  if (ocurreEn(r, fecha)) return { ok: true, valor: null };
  if (r.repeticion === "ninguna") return invalido("fecha", `«${r.titulo}» no ocurre el ${fecha}: es solo el ${r.fecha}.`);
  let antes: string | null = null;
  let despues: string | null = null;
  for (let i = 1; i <= HORIZONTE_DIAS && (antes === null || despues === null); i++) {
    const atras = sumarDias(fecha, -i);
    const adelante = sumarDias(fecha, i);
    if (antes === null && atras >= r.fecha && ocurreEn(r, atras)) antes = atras;
    if (despues === null && ocurreEn(r, adelante)) despues = adelante;
  }
  const vecinas = [antes, despues].filter((x): x is string => x !== null);
  const pista = vecinas.length ? ` Las más cercanas: ${vecinas.join(" y ")}.` : "";
  return invalido("fecha", `«${r.titulo}» no ocurre el ${fecha}.${pista}`);
}

// ── Deshacer ────────────────────────────────────────────────────────────────

/**
 * Lo que hace falta para deshacer una operación del calendario: se guarda en
 * el registro de actividad (`.mycelium/actividad.jsonl`) junto a la operación.
 *
 * > [!important] Cada uno guarda también **cómo lo dejó** la operación
 * > (`despues`, o el `completado` que fijó). Deshacer solo se aplica si el
 * > recordatorio sigue así: si el usuario —o el agente— lo cambió después,
 * > volver a «lo de antes» pisaría ese cambio posterior sin decir nada. Los
 * > renglones escritos antes de este campo no lo traen; con ellos no se puede
 * > comprobar, y se deshace como antes.
 */
export type DeshacerCalendario =
  /** Deshacer un crear. `despues`: cómo quedó creado. */
  | { tipo: "borrar"; id: string; despues?: Recordatorio }
  /** Deshacer un borrar: el recordatorio entero y el estado de sus ocurrencias. */
  | { tipo: "restaurar"; recordatorio: Recordatorio; ocurrencias: Record<string, EstadoOcurrencia> }
  /** Deshacer un editar: los valores de antes, y cómo quedó (`despues`). */
  | { tipo: "reponer"; recordatorio: Recordatorio; despues?: Recordatorio }
  /** Deshacer un completar: cómo estaba la ocurrencia (la operación la dejó en `!completado`). */
  | { tipo: "completar"; id: string; fecha: string; completado: boolean };

/** El texto del botón y de la confirmación, por tipo. */
export function describirDeshacer(d: DeshacerCalendario): string {
  switch (d.tipo) {
    case "borrar":
      return "borrar el recordatorio creado";
    case "restaurar":
      return `restaurar «${d.recordatorio.titulo}»`;
    case "reponer":
      return `volver «${d.recordatorio.titulo}» a como estaba`;
    case "completar":
      return d.completado ? "volver a marcarlo completado" : "desmarcarlo";
  }
}

/** Lo que cambia el usuario de un recordatorio: si esto es igual, sigue como estaba. */
const CAMPOS_VISIBLES = ["titulo", "fecha", "hora", "repeticion", "color", "detalle"] as const;

export function mismoRecordatorio(a: Recordatorio, b: Recordatorio): boolean {
  return CAMPOS_VISIBLES.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/** El motivo cuando lo que dejó la operación ya no está como lo dejó. */
export const CAMBIO_DESPUES = "cambió después";

/**
 * Si se puede deshacer contra el calendario de hoy: lo creado tiene que
 * seguir existiendo para borrarlo, lo borrado no tiene que haber vuelto, y
 * —lo que importa— **nada cambió después**: lo editado, creado o completado
 * tiene que estar todavía como lo dejó la operación. Si no, deshacer pisaría
 * la edición posterior, así que se niega con el motivo.
 */
export function puedeDeshacer(archivo: ArchivoRecordatorios, d: DeshacerCalendario): { ok: true } | { ok: false; porque: string } {
  const buscar = (id: string) => archivo.recordatorios.find((r) => r.id === id);
  const cambio = { ok: false as const, porque: CAMBIO_DESPUES };
  switch (d.tipo) {
    case "restaurar":
      return buscar(d.recordatorio.id) ? { ok: false, porque: "ya está otra vez en el calendario" } : { ok: true };
    case "borrar": {
      const actual = buscar(d.id);
      if (!actual) return { ok: false, porque: "el recordatorio ya no existe" };
      return d.despues && !mismoRecordatorio(actual, d.despues) ? cambio : { ok: true };
    }
    case "reponer": {
      const actual = buscar(d.recordatorio.id);
      if (!actual) return { ok: false, porque: "el recordatorio ya no existe" };
      return d.despues && !mismoRecordatorio(actual, d.despues) ? cambio : { ok: true };
    }
    case "completar": {
      if (!buscar(d.id)) return { ok: false, porque: "el recordatorio ya no existe" };
      // La operación dejó la ocurrencia en `!completado`; si ya no está así, cambió después.
      return estaCompletada(archivo, claveOcurrencia(d.id, d.fecha)) === !d.completado ? { ok: true } : cambio;
    }
  }
}
