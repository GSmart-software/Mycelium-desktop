/**
 * Calendario y recordatorios (`FUN-L-22`): el modelo, la repetición y el cálculo
 * de qué hay que avisar. Spec: docs/features/calendario-recordatorios.md.
 *
 * Es **puro y sin imports** a propósito: `scripts/test-recordatorios.mjs` lo
 * transpila y lo prueba con `node:test`, sin app ni Tauri. Nada de acá lee el
 * reloj por su cuenta: quien necesita «ahora» lo recibe como parámetro, que es
 * lo que permite probar «la app estuvo cerrada una semana» sin esperar una
 * semana.
 *
 * **Fechas locales, no instantes.** Un recordatorio guarda su día como
 * `AAAA-MM-DD` y su hora como `HH:MM`, en la hora de donde esté el usuario. Un
 * recordatorio «a las 10» es a las 10 de acá; guardado en UTC cambiaría de hora
 * al viajar o con el horario de verano. Los momentos que sí son instantes (hasta
 * cuándo se pospuso, desde cuándo vale) también se guardan como fecha y hora
 * locales, `AAAA-MM-DDTHH:MM`, para que todo el archivo se lea igual.
 */

// ── Tipos ──────────────────────────────────────────────────────────────────

export type Repeticion = "ninguna" | "dia" | "semana" | "mes" | "anio";

/** Índice de la paleta fija (§ 6 de la spec): del 1 al 8. */
export type ColorRecordatorio = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type Recordatorio = {
  id: string;
  /** Obligatorio, una línea. */
  titulo: string;
  /** El día del recordatorio, o el de su primera vez si se repite. */
  fecha: string;
  /** `HH:MM`, o `null` para «todo el día». */
  hora: string | null;
  repeticion: Repeticion;
  color: ColorRecordatorio;
  /** Markdown libre; puede tener `[[enlaces]]`. */
  detalle: string;
  /**
   * Desde cuándo avisa (`AAAA-MM-DDTHH:MM`). Se fija al crearlo y al cambiarle
   * la fecha, la hora o la repetición: sin esto, crear a las 11 un recordatorio
   * diario «a las 9» avisaría en el acto por la ocurrencia de hoy, que ya pasó
   * antes de que existiera. Opcional para tolerar archivos escritos a mano.
   */
  vigenteDesde?: string;
};

/** Lo que el usuario hizo con una ocurrencia desde la tarjeta de aviso. */
export type EstadoOcurrencia = {
  /** «Listo»: esa ocurrencia no vuelve a avisar. */
  descartada?: boolean;
  /** «Posponer»: vuelve a avisar a partir de este momento (`AAAA-MM-DDTHH:MM`). */
  pospuestaHasta?: string;
};

/** Forma de `.mycelium/recordatorios.json`. */
export type ArchivoRecordatorios = {
  version: number;
  recordatorios: Recordatorio[];
  /** Por clave de ocurrencia (`claveOcurrencia`). */
  ocurrencias: Record<string, EstadoOcurrencia>;
};

/** Una aparición concreta de un recordatorio en un día. */
export type Ocurrencia = {
  recordatorio: Recordatorio;
  fecha: string;
};

/** Una ocurrencia que toca avisar ahora. */
export type Aviso = Ocurrencia & {
  clave: string;
  /** El momento en que tocaba avisar (el pospuesto, si se pospuso). */
  momento: Date;
  /** Si se avisa tarde: venció con la app cerrada. */
  vencida: boolean;
};

export const VERSION_ARCHIVO = 1;

/** Hacia atrás, como mucho (§ 5.1): lo vencido antes no se avisa. */
export const DIAS_HACIA_ATRAS = 30;

/**
 * Cuánto tarde puede llegar un aviso sin contar como vencido. El programador
 * revisa una vez por minuto, así que uno puntual llega con hasta un minuto de
 * atraso; el margen es el doble para no marcar «vencido» por un tic lento.
 */
const MARGEN_PUNTUAL_MS = 2 * 60 * 1000;

// ── La paleta ─────────────────────────────────────────────────────────────

/**
 * Los ocho colores, con su nombre accesible. El valor real es un token por tema
 * y modo (`--mic-recordatorio-N` en styles/tokens.css): un color libre podría
 * quedar ilegible en otro tema, y los temas los define Mycelium.
 */
export const COLORES: { valor: ColorRecordatorio; nombre: string }[] = [
  { valor: 1, nombre: "Hifa" },
  { valor: 2, nombre: "Musgo" },
  { valor: 3, nombre: "Liquen" },
  { valor: 4, nombre: "Yesca" },
  { valor: 5, nombre: "Amanita" },
  { valor: 6, nombre: "Coral" },
  { valor: 7, nombre: "Espora" },
  { valor: 8, nombre: "Bruma" },
];

/** La variable CSS de un color de la paleta. */
export function varColor(color: ColorRecordatorio): string {
  return `var(--mic-recordatorio-${color})`;
}

export const REPETICIONES: { valor: Repeticion; nombre: string }[] = [
  { valor: "ninguna", nombre: "No se repite" },
  { valor: "dia", nombre: "Cada día" },
  { valor: "semana", nombre: "Cada semana" },
  { valor: "mes", nombre: "Cada mes" },
  { valor: "anio", nombre: "Cada año" },
];

// ── Fechas locales ────────────────────────────────────────────────────────

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RE_MOMENTO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/** `AAAA-MM-DD` de un `Date`, en hora local. */
export function fechaLocal(d: Date): string {
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
}

/** `HH:MM` de un `Date`, en hora local. */
export function horaLocal(d: Date): string {
  return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
}

/** `AAAA-MM-DDTHH:MM` de un `Date`, en hora local. */
export function momentoLocal(d: Date): string {
  return `${fechaLocal(d)}T${horaLocal(d)}`;
}

export function esFechaValida(fecha: string): boolean {
  const m = RE_FECHA.exec(fecha);
  if (!m) return false;
  const [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(a, mes - 1, dia);
  // `Date` acepta el 31 de febrero y lo corre a marzo: si la vuelta no da lo
  // mismo, la fecha no existe.
  return d.getFullYear() === a && d.getMonth() === mes - 1 && d.getDate() === dia;
}

export function esHoraValida(hora: string): boolean {
  return RE_HORA.test(hora);
}

/** Las partes de una fecha `AAAA-MM-DD` (se asume válida). */
function partes(fecha: string): [number, number, number] {
  const [a, m, d] = fecha.split("-").map(Number);
  return [a, m, d];
}

/** Medianoche local de una fecha `AAAA-MM-DD`. */
export function aDate(fecha: string, hora: string | null = null): Date {
  const [a, m, d] = partes(fecha);
  if (hora === null) return new Date(a, m - 1, d);
  const [h, min] = hora.split(":").map(Number);
  return new Date(a, m - 1, d, h, min);
}

/** Un `AAAA-MM-DDTHH:MM` como `Date` local; `null` si no tiene esa forma. */
export function leerMomento(texto: string | undefined): Date | null {
  if (!texto) return null;
  const m = RE_MOMENTO.exec(texto);
  if (!m || !esFechaValida(m[1]) || !esHoraValida(m[2])) return null;
  return aDate(m[1], m[2]);
}

/** Suma días a una fecha, en el calendario (no en milisegundos: el horario de verano no la mueve). */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = partes(fecha);
  return fechaLocal(new Date(a, m - 1, d + dias));
}

/** Suma meses a una fecha; el día se ajusta al último del mes si no existe. */
export function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = partes(fecha);
  const destino = new Date(a, m - 1 + meses, 1);
  const ultimo = diasDelMes(destino.getFullYear(), destino.getMonth() + 1);
  return fechaLocal(new Date(destino.getFullYear(), destino.getMonth(), Math.min(d, ultimo)));
}

/** Días entre dos fechas (`b - a`), contados en el calendario. */
export function diasEntre(a: string, b: string): number {
  const [aa, am, ad] = partes(a);
  const [ba, bm, bd] = partes(b);
  // UTC solo para contar días sin que un cambio de horario deje 23 o 25 horas.
  return Math.round((Date.UTC(ba, bm - 1, bd) - Date.UTC(aa, am - 1, ad)) / 86_400_000);
}

export function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes, 0).getDate();
}

/** Día de la semana con el lunes como primero: 0 = lunes … 6 = domingo. */
export function diaDeSemana(fecha: string): number {
  return (aDate(fecha).getDay() + 6) % 7;
}

// ── La repetición ──────────────────────────────────────────────────────────

/**
 * Si el recordatorio tiene una ocurrencia ese día. Resuelve los casos como
 * Google Calendar (§ 2): cada mes el 31 **no** tiene ocurrencia en los meses sin
 * 31 —no se corre al último día—, cada año el 29 de febrero solo cae en los
 * bisiestos, y nada ocurre antes de la fecha del recordatorio.
 */
export function ocurreEn(r: Recordatorio, fecha: string): boolean {
  if (fecha < r.fecha) return false; // AAAA-MM-DD se ordena como texto
  if (fecha === r.fecha) return true;
  const [, rm, rd] = partes(r.fecha);
  const [, fm, fd] = partes(fecha);
  switch (r.repeticion) {
    case "ninguna":
      return false;
    case "dia":
      return true;
    case "semana":
      return diasEntre(r.fecha, fecha) % 7 === 0;
    case "mes":
      // Si el mes no tiene ese día, `fd` nunca lo iguala: no hay ocurrencia.
      return fd === rd;
    case "anio":
      // El 29 de febrero solo existe en los bisiestos, así que solo ahí iguala.
      return fm === rm && fd === rd;
  }
}

/** Orden de una lista: por fecha, «todo el día» primero, por hora y por título. */
function compararOcurrencias(a: Ocurrencia, b: Ocurrencia): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  const ha = a.recordatorio.hora ?? "";
  const hb = b.recordatorio.hora ?? "";
  if (ha !== hb) return ha < hb ? -1 : 1;
  return a.recordatorio.titulo.localeCompare(b.recordatorio.titulo, "es");
}

/** Las ocurrencias entre dos fechas, **inclusive**, en orden. */
export function ocurrenciasEnRango(
  recordatorios: Recordatorio[],
  desde: string,
  hasta: string,
): Ocurrencia[] {
  const salida: Ocurrencia[] = [];
  const total = diasEntre(desde, hasta);
  for (let i = 0; i <= total; i++) {
    const fecha = sumarDias(desde, i);
    for (const r of recordatorios) {
      if (ocurreEn(r, fecha)) salida.push({ recordatorio: r, fecha });
    }
  }
  return salida.sort(compararOcurrencias);
}

/** La clave con la que se guarda el estado de una ocurrencia. */
export function claveOcurrencia(recordatorioId: string, fecha: string): string {
  return `${recordatorioId}@${fecha}`;
}

/** El momento de una ocurrencia: su hora, o la medianoche si es de todo el día. */
export function momentoDeOcurrencia(r: Recordatorio, fecha: string): Date {
  return aDate(fecha, r.hora);
}

// ── Qué hay que avisar ─────────────────────────────────────────────────────

/**
 * La ocurrencia **más reciente** que ya llegó, dentro de los últimos
 * `DIAS_HACIA_ATRAS` días. Es la única que puede avisar (§ 5.1): uno diario con
 * la app cerrada una semana avisa una vez, no siete.
 */
export function ocurrenciaMasRecienteVencida(r: Recordatorio, ahora: Date): string | null {
  const hoy = fechaLocal(ahora);
  for (let i = 0; i <= DIAS_HACIA_ATRAS; i++) {
    const fecha = sumarDias(hoy, -i);
    if (fecha < r.fecha) return null; // antes de su fecha no hay nada
    if (ocurreEn(r, fecha) && momentoDeOcurrencia(r, fecha) <= ahora) return fecha;
  }
  return null;
}

/**
 * Los avisos que tocan en este momento. Por recordatorio, a lo sumo uno —el de
 * su ocurrencia más reciente—, y solo si:
 *
 *   - no se descartó («Listo»);
 *   - no está pospuesto a un momento que todavía no llegó;
 *   - no es anterior a que el recordatorio existiera (`vigenteDesde`).
 *
 * Una ocurrencia pospuesta que ya pasó a otra más nueva no se avisa: manda la
 * nueva, que ya dice lo mismo.
 */
export function avisosPendientes(archivo: ArchivoRecordatorios, ahora: Date): Aviso[] {
  const avisos: Aviso[] = [];
  for (const r of archivo.recordatorios) {
    const fecha = ocurrenciaMasRecienteVencida(r, ahora);
    if (fecha === null) continue;
    const original = momentoDeOcurrencia(r, fecha);
    const desde = leerMomento(r.vigenteDesde);
    if (desde !== null && original < desde) continue;

    const clave = claveOcurrencia(r.id, fecha);
    const estado = archivo.ocurrencias[clave];
    if (estado?.descartada) continue;
    const pospuesta = leerMomento(estado?.pospuestaHasta);
    if (pospuesta !== null && pospuesta > ahora) continue;

    const momento = pospuesta ?? original;
    avisos.push({
      recordatorio: r,
      fecha,
      clave,
      momento,
      vencida: esVencida(r, fecha, momento, ahora),
    });
  }
  return avisos.sort((a, b) => a.momento.getTime() - b.momento.getTime());
}

/**
 * Si un aviso llega tarde. Con hora: pasado el margen de un tic. De todo el día:
 * si su día ya no es hoy (el de hoy avisa al abrir la app en cualquier momento
 * del día, y eso es llegar a tiempo).
 */
function esVencida(r: Recordatorio, fecha: string, momento: Date, ahora: Date): boolean {
  if (r.hora === null && momento.getTime() === aDate(fecha).getTime()) {
    return fecha < fechaLocal(ahora);
  }
  return ahora.getTime() - momento.getTime() > MARGEN_PUNTUAL_MS;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** «12 de septiembre». */
export function fechaLarga(fecha: string): string {
  const [, m, d] = partes(fecha);
  return `${d} de ${MESES[m - 1]}`;
}

export function nombreDelMes(mes: number): string {
  return MESES[mes - 1];
}

/**
 * La marca de un aviso vencido (§ 5.1): «Era a las 10:00», «Era ayer», «Era
 * ayer a las 10:00», «Era el 12 de septiembre». `null` si no está vencido.
 */
export function describirVencimiento(aviso: Aviso, ahora: Date): string | null {
  if (!aviso.vencida) return null;
  const dia = fechaLocal(aviso.momento);
  const conHora =
    aviso.recordatorio.hora !== null || aviso.momento.getHours() + aviso.momento.getMinutes() > 0;
  const hora = conHora ? ` a las ${horaLocal(aviso.momento)}` : "";
  const atras = diasEntre(dia, fechaLocal(ahora));
  if (atras <= 0) return `Era${hora}`;
  if (atras === 1) return `Era ayer${hora}`;
  return `Era el ${fechaLarga(dia)}${hora}`;
}

// ── Lo que se hace con una ocurrencia ─────────────────────────────────────

/** «Listo»: la ocurrencia no vuelve a avisar, ni al reabrir la app. */
export function descartar(archivo: ArchivoRecordatorios, clave: string): ArchivoRecordatorios {
  return { ...archivo, ocurrencias: { ...archivo.ocurrencias, [clave]: { descartada: true } } };
}

/** «Posponer»: vuelve a avisar en `hasta`, aunque la app se cierre entre medio. */
export function posponer(
  archivo: ArchivoRecordatorios,
  clave: string,
  hasta: Date,
): ArchivoRecordatorios {
  return {
    ...archivo,
    ocurrencias: { ...archivo.ocurrencias, [clave]: { pospuestaHasta: momentoLocal(hasta) } },
  };
}

/** Las tres opciones de «Posponer» (§ 5.2). */
export function opcionesPosponer(ahora: Date): { etiqueta: string; hasta: Date }[] {
  const manana = new Date(ahora);
  manana.setDate(manana.getDate() + 1);
  return [
    { etiqueta: "10 minutos", hasta: new Date(ahora.getTime() + 10 * 60_000) },
    { etiqueta: "1 hora", hasta: new Date(ahora.getTime() + 60 * 60_000) },
    { etiqueta: "Mañana a esta hora", hasta: manana },
  ];
}

/**
 * Tira el estado que ya no puede servir: el de recordatorios borrados y el de
 * ocurrencias más viejas que el tope hacia atrás, que ya no avisarían igual.
 * Sin esto, un recordatorio diario sumaría una entrada por día para siempre.
 */
export function limpiarOcurrencias(
  archivo: ArchivoRecordatorios,
  ahora: Date,
): ArchivoRecordatorios {
  const ids = new Set(archivo.recordatorios.map((r) => r.id));
  const tope = sumarDias(fechaLocal(ahora), -(DIAS_HACIA_ATRAS + 1));
  const ocurrencias: Record<string, EstadoOcurrencia> = {};
  for (const [clave, estado] of Object.entries(archivo.ocurrencias)) {
    const i = clave.lastIndexOf("@");
    const id = clave.slice(0, i);
    const fecha = clave.slice(i + 1);
    const pospuesta = leerMomento(estado.pospuestaHasta);
    // Una pospuesta a futuro se conserva aunque su día sea viejo.
    if (ids.has(id) && (fecha >= tope || (pospuesta !== null && pospuesta > ahora))) {
      ocurrencias[clave] = estado;
    }
  }
  return { ...archivo, ocurrencias };
}

// ── Las vistas ─────────────────────────────────────────────────────────────

export type Periodo = "dia" | "semana" | "mes";

/**
 * El rango de fechas de un período alrededor de un día. La semana empieza el
 * lunes, como en el calendario que usa la gente de habla hispana.
 */
export function rangoDePeriodo(fecha: string, periodo: Periodo): { desde: string; hasta: string } {
  if (periodo === "dia") return { desde: fecha, hasta: fecha };
  if (periodo === "semana") {
    const desde = sumarDias(fecha, -diaDeSemana(fecha));
    return { desde, hasta: sumarDias(desde, 6) };
  }
  const [a, m] = partes(fecha);
  return {
    desde: `${a}-${dosDigitos(m)}-01`,
    hasta: `${a}-${dosDigitos(m)}-${dosDigitos(diasDelMes(a, m))}`,
  };
}

/**
 * Las semanas que muestra la grilla de un mes: de lunes a domingo, desde la que
 * contiene el día 1 hasta la que contiene el último. Cuatro a seis filas.
 */
export function semanasDelMes(anio: number, mes: number): string[][] {
  const primero = `${anio}-${dosDigitos(mes)}-01`;
  const ultimo = `${anio}-${dosDigitos(mes)}-${dosDigitos(diasDelMes(anio, mes))}`;
  let dia = sumarDias(primero, -diaDeSemana(primero));
  const fin = sumarDias(ultimo, 6 - diaDeSemana(ultimo));
  const semanas: string[][] = [];
  while (dia <= fin) {
    const semana: string[] = [];
    for (let i = 0; i < 7; i++) {
      semana.push(dia);
      dia = sumarDias(dia, 1);
    }
    semanas.push(semana);
  }
  return semanas;
}

// ── El archivo ─────────────────────────────────────────────────────────────

export function archivoVacio(): ArchivoRecordatorios {
  return { version: VERSION_ARCHIVO, recordatorios: [], ocurrencias: {} };
}

const REPETICIONES_VALIDAS = new Set<string>(["ninguna", "dia", "semana", "mes", "anio"]);

/** Un recordatorio leído del disco, o `null` si no se puede usar. */
function leerRecordatorio(x: unknown): Recordatorio | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id === "") return null;
  if (typeof o.titulo !== "string") return null;
  if (typeof o.fecha !== "string" || !esFechaValida(o.fecha)) return null;
  const hora = typeof o.hora === "string" && esHoraValida(o.hora) ? o.hora : null;
  const repeticion =
    typeof o.repeticion === "string" && REPETICIONES_VALIDAS.has(o.repeticion)
      ? (o.repeticion as Repeticion)
      : "ninguna";
  const color =
    typeof o.color === "number" && Number.isInteger(o.color) && o.color >= 1 && o.color <= 8
      ? (o.color as ColorRecordatorio)
      : 1;
  const r: Recordatorio = {
    id: o.id,
    titulo: o.titulo,
    fecha: o.fecha,
    hora,
    repeticion,
    color,
    detalle: typeof o.detalle === "string" ? o.detalle : "",
  };
  if (typeof o.vigenteDesde === "string") r.vigenteDesde = o.vigenteDesde;
  return r;
}

/**
 * Interpreta el JSON de `recordatorios.json`. Tolera campos faltantes o raros
 * —el archivo es texto y alguien lo puede tocar a mano— descartando lo que no
 * se pueda usar en vez de rechazar todo. Devuelve `null` solo si no tiene la
 * forma de un archivo de recordatorios: ahí quien lo lee NO debe sobrescribirlo
 * (§ 3), para no perder lo que se pueda recuperar a mano.
 */
export function leerArchivo(json: unknown): ArchivoRecordatorios | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.recordatorios)) return null;
  const recordatorios = o.recordatorios
    .map(leerRecordatorio)
    .filter((r): r is Recordatorio => r !== null);
  const ocurrencias: Record<string, EstadoOcurrencia> = {};
  if (typeof o.ocurrencias === "object" && o.ocurrencias !== null) {
    for (const [clave, v] of Object.entries(o.ocurrencias as Record<string, unknown>)) {
      if (typeof v !== "object" || v === null || !clave.includes("@")) continue;
      const e = v as Record<string, unknown>;
      const estado: EstadoOcurrencia = {};
      if (e.descartada === true) estado.descartada = true;
      if (typeof e.pospuestaHasta === "string" && leerMomento(e.pospuestaHasta)) {
        estado.pospuestaHasta = e.pospuestaHasta;
      }
      if (estado.descartada || estado.pospuestaHasta) ocurrencias[clave] = estado;
    }
  }
  return {
    version: typeof o.version === "number" ? o.version : VERSION_ARCHIVO,
    recordatorios,
    ocurrencias,
  };
}

/** El primer renglón con texto de un detalle, sin marcas de markdown: para la notificación. */
export function primerRenglon(detalle: string): string {
  for (const linea of detalle.split(/\r?\n/)) {
    const limpia = linea
      .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    if (limpia !== "") return limpia;
  }
  return "";
}
