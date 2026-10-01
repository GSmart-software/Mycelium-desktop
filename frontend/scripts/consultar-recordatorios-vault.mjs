#!/usr/bin/env node
// Consulta el calendario de recordatorios de un vault de Mycelium (`FUN-L-26`,
// skill `mycelium-calendario`). SOLO LEE `.mycelium/recordatorios.json`.
// Sin dependencias: viaja con la skill como `.claude/skills/mycelium-calendario/consultar.mjs`.
//
// Replica las reglas de `lib/recordatorios.ts` (qué descarta la app, cómo se
// expanden las repeticiones, el orden de la lista). No lo importa porque en el
// vault del usuario no hay TypeScript: `scripts/test-consultar-recordatorios-vault.mjs`
// compara los dos en miles de casos para que no diverjan.
//
// Desde la raíz del vault:
//
//   node consultar.mjs --hoy                    (o --dia AAAA-MM-DD)
//   node consultar.mjs --semana [AAAA-MM-DD]    (lunes a domingo; sin fecha, la de hoy)
//   node consultar.mjs --mes [AAAA-MM-DD]       (del 1 al último; sin fecha, el de hoy)
//   node consultar.mjs --desde AAAA-MM-DD --hasta AAAA-MM-DD
//   node consultar.mjs --proximas N [--desde AAAA-MM-DD]   (las N siguientes, sin tope de fecha)
//
// Opciones: --buscar <texto> (solo los recordatorios cuyo título lo contiene, sin
// distinguir mayúsculas ni tildes) · --fecha-hoy AAAA-MM-DD (fija «hoy» en vez de
// tomarlo del reloj) · --vault <carpeta> (por defecto, la actual) · --json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RE_MOMENTO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
const REPETICIONES = new Set(["ninguna", "dia", "semana", "mes", "anio"]);
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const CADA = { dia: "cada día", semana: "cada semana", mes: "cada mes", anio: "cada año" };
const dd = (n) => String(n).padStart(2, "0");
const partes = (f) => f.split("-").map(Number);

// ── Fechas (todas en el calendario, sin horas: UTC solo para contar) ─────────

export function esFechaValida(f) {
  const m = RE_FECHA.exec(typeof f === "string" ? f : "");
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const aUtc = (f) => {
  const [a, m, d] = partes(f);
  const x = new Date(Date.UTC(2000, m - 1, d));
  x.setUTCFullYear(a); // años < 100 sin el corrimiento de Date.UTC
  return x;
};
const deUtc = (x) => `${String(x.getUTCFullYear()).padStart(4, "0")}-${dd(x.getUTCMonth() + 1)}-${dd(x.getUTCDate())}`;

export function sumarDias(f, n) {
  const x = aUtc(f);
  x.setUTCDate(x.getUTCDate() + n);
  return deUtc(x);
}

export const diasEntre = (a, b) => Math.round((aUtc(b) - aUtc(a)) / 864e5);
/** 0 = lunes … 6 = domingo. */
export const diaDeSemana = (f) => (aUtc(f).getUTCDay() + 6) % 7;
const diasDelMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();

export function rangoDePeriodo(f, periodo) {
  if (periodo === "dia") return { desde: f, hasta: f };
  if (periodo === "semana") {
    const desde = sumarDias(f, -diaDeSemana(f));
    return { desde, hasta: sumarDias(desde, 6) };
  }
  const [a, m] = partes(f);
  const pre = `${String(a).padStart(4, "0")}-${dd(m)}`;
  return { desde: `${pre}-01`, hasta: `${pre}-${dd(diasDelMes(a, m))}` };
}

/** Hoy según el reloj local de este proceso (obedece a la variable TZ). */
export function hoyLocal(d = new Date()) {
  return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
}

// ── El archivo (lo mismo que descarta y normaliza la app) ────────────────────

function leerRecordatorio(o) {
  if (typeof o !== "object" || o === null) return null;
  if (typeof o.id !== "string" || o.id === "") return null;
  if (typeof o.titulo !== "string") return null;
  if (!esFechaValida(o.fecha)) return null;
  return {
    id: o.id,
    titulo: o.titulo,
    fecha: o.fecha,
    hora: typeof o.hora === "string" && RE_HORA.test(o.hora) ? o.hora : null,
    repeticion: typeof o.repeticion === "string" && REPETICIONES.has(o.repeticion) ? o.repeticion : "ninguna",
    color: Number.isInteger(o.color) && o.color >= 1 && o.color <= 8 ? o.color : 1,
    detalle: typeof o.detalle === "string" ? o.detalle : "",
  };
}

const momentoValido = (t) => {
  const m = RE_MOMENTO.exec(typeof t === "string" ? t : "");
  return !!m && esFechaValida(m[1]) && RE_HORA.test(m[2]);
};

/** El JSON interpretado como la app, o `null` si no tiene la forma de un calendario. */
export function leerArchivo(json) {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  if (!Array.isArray(json.recordatorios)) return null;
  const recordatorios = json.recordatorios.map(leerRecordatorio).filter(Boolean);
  const ocurrencias = {};
  if (typeof json.ocurrencias === "object" && json.ocurrencias !== null) {
    for (const [clave, e] of Object.entries(json.ocurrencias)) {
      if (typeof e !== "object" || e === null || !clave.includes("@")) continue;
      const estado = {};
      if (e.descartada === true) estado.descartada = true;
      if (momentoValido(e.pospuestaHasta)) estado.pospuestaHasta = e.pospuestaHasta;
      if (e.completada === true) estado.completada = true;
      if (Object.keys(estado).length) ocurrencias[clave] = estado;
    }
  }
  return { recordatorios, ocurrencias };
}

// ── La repetición ────────────────────────────────────────────────────────────

/** Como Google Calendar: el 31 no cae en meses sin 31, el 29/02 solo en bisiestos, nada antes de `fecha`. */
export function ocurreEn(r, f) {
  if (f < r.fecha) return false;
  if (f === r.fecha) return true;
  const [, rm, rd] = partes(r.fecha);
  const [, fm, fd] = partes(f);
  switch (r.repeticion) {
    case "dia": return true;
    case "semana": return diasEntre(r.fecha, f) % 7 === 0;
    case "mes": return fd === rd;
    case "anio": return fm === rm && fd === rd;
    default: return false;
  }
}

/** Orden de la lista de la app: fecha, «todo el día» primero, hora, título. */
function comparar(a, b) {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  const ha = a.recordatorio.hora ?? "";
  const hb = b.recordatorio.hora ?? "";
  if (ha !== hb) return ha < hb ? -1 : 1;
  return a.recordatorio.titulo.localeCompare(b.recordatorio.titulo, "es");
}

/** Las ocurrencias entre `desde` y `hasta`, inclusive, en orden: `{ recordatorio, fecha }`. */
export function ocurrenciasEnRango(recordatorios, desde, hasta) {
  const salida = [];
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    for (const r of recordatorios) if (ocurreEn(r, f)) salida.push({ recordatorio: r, fecha: f });
  }
  return salida.sort(comparar);
}

/**
 * Las `n` ocurrencias siguientes desde `desde` (inclusive). Una serie que se
 * repite vuelve a ocurrir en menos de 9 años (el hueco más largo es un 29 de
 * febrero que saltea un año como 2100), así que no hace falta buscar más allá.
 */
export function proximas(recordatorios, desde, n) {
  const salida = [];
  if (recordatorios.length === 0 || n <= 0) return salida;
  let tope = desde;
  for (const r of recordatorios) {
    const fin = r.repeticion === "ninguna" ? r.fecha : sumarDias(r.fecha > desde ? r.fecha : desde, 366 * 9 * n);
    if (fin > tope) tope = fin;
  }
  for (let f = desde; f <= tope && salida.length < n; f = sumarDias(f, 1)) {
    const delDia = recordatorios.filter((r) => ocurreEn(r, f)).map((r) => ({ recordatorio: r, fecha: f }));
    salida.push(...delDia.sort(comparar));
  }
  return salida.slice(0, n);
}

const sinTildes = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const filtrarTitulo = (recordatorios, texto) =>
  recordatorios.filter((r) => sinTildes(r.titulo).includes(sinTildes(texto)));

// ── Salida ───────────────────────────────────────────────────────────────────

/** Cada ocurrencia con su estado, lista para mostrar o para `--json`. */
export function describir(archivo, ocurrencias) {
  return ocurrencias.map(({ recordatorio: r, fecha }) => {
    const e = archivo.ocurrencias[`${r.id}@${fecha}`] ?? {};
    return {
      fecha,
      dia: DIAS[diaDeSemana(fecha)],
      hora: r.hora,
      titulo: r.titulo,
      repeticion: r.repeticion,
      completada: e.completada === true,
      avisoDescartado: e.descartada === true,
      avisoPospuestoHasta: e.pospuestaHasta ?? null,
      enlaces: r.detalle.match(/\[\[[^\]]+\]\]/g) ?? [],
      detalle: r.detalle,
    };
  });
}

export function formatear(o) {
  const p = [`${o.fecha} ${o.dia}`, o.hora ?? "todo el día", o.titulo];
  if (CADA[o.repeticion]) p.push(`(${CADA[o.repeticion]})`);
  if (o.completada) p.push("✓ hecha");
  if (o.avisoPospuestoHasta) p.push(`[aviso pospuesto hasta ${o.avisoPospuestoHasta.replace("T", " ")}]`);
  if (o.enlaces.length) p.push(`→ ${o.enlaces.join(" ")}`);
  return p.join("  ");
}

/** Marcas de hecha en días del rango en que ese recordatorio NO ocurre (la app no las muestra). */
export function marcasHuerfanas(archivo, desde, hasta) {
  const avisos = [];
  for (const [clave, e] of Object.entries(archivo.ocurrencias)) {
    const i = clave.lastIndexOf("@");
    const f = clave.slice(i + 1);
    const r = archivo.recordatorios.find((x) => x.id === clave.slice(0, i));
    if (r && e.completada && f >= desde && f <= hasta && !ocurreEn(r, f)) {
      avisos.push(`Aviso: «${r.titulo}» tiene una marca de hecha el ${f}, pero ese día no ocurre: se ignora.`);
    }
  }
  return avisos;
}

function main(args) {
  const opt = (n) => {
    const i = args.indexOf(n);
    return i === -1 ? undefined : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
  };
  const fechaHoy = opt("--fecha-hoy");
  if (fechaHoy !== undefined && !esFechaValida(fechaHoy)) return uso("--fecha-hoy necesita AAAA-MM-DD");
  const hoy = fechaHoy ?? hoyLocal();
  let desde, hasta, n;
  if (args.includes("--hoy")) ({ desde, hasta } = rangoDePeriodo(hoy, "dia"));
  else if (opt("--dia") !== undefined) desde = hasta = opt("--dia");
  else if (opt("--semana") !== undefined) ({ desde, hasta } = rangoDePeriodo(opt("--semana") ?? hoy, "semana"));
  else if (opt("--mes") !== undefined) ({ desde, hasta } = rangoDePeriodo(opt("--mes") ?? hoy, "mes"));
  else if (opt("--proximas") !== undefined) {
    n = Number(opt("--proximas"));
    if (!Number.isInteger(n) || n < 1) return uso("--proximas necesita un entero positivo");
    desde = opt("--desde") ?? hoy;
  } else ({ desde, hasta } = { desde: opt("--desde"), hasta: opt("--hasta") });
  if (!esFechaValida(desde) || (n === undefined && (!esFechaValida(hasta) || hasta < desde))) {
    return uso("fechas inválidas");
  }

  const ruta = path.join(opt("--vault") ?? ".", ".mycelium", "recordatorios.json");
  let archivo = null;
  try {
    archivo = leerArchivo(JSON.parse(fs.readFileSync(ruta, "utf8")));
  } catch {}
  if (archivo === null) {
    console.log(`Sin calendario: ${ruta} no existe o no se puede leer.`);
    return 0;
  }
  const buscar = opt("--buscar");
  const recs = buscar ? filtrarTitulo(archivo.recordatorios, buscar) : archivo.recordatorios;
  const lista = describir(archivo, n === undefined ? ocurrenciasEnRango(recs, desde, hasta) : proximas(recs, desde, n));
  if (n !== undefined) hasta = lista.at(-1)?.fecha ?? desde;
  const avisos = marcasHuerfanas({ ...archivo, recordatorios: recs }, desde, hasta);

  if (args.includes("--json")) {
    console.log(JSON.stringify({ hoy, desde, hasta, ocurrencias: lista, avisos }, null, 2));
    return 0;
  }
  const ahora = new Date();
  const reloj = `${dd(ahora.getHours())}:${dd(ahora.getMinutes())}, reloj de este proceso`;
  console.log(`Hoy: ${hoy} ${DIAS[diaDeSemana(hoy)]}${fechaHoy ? "" : ` (${reloj})`}`);
  if (!fechaHoy && process.env.TZ) console.log(`Ojo: TZ=${process.env.TZ}; si no es la zona del usuario, pasá --fecha-hoy.`);
  const que = buscar ? ` que contienen «${buscar}»` : "";
  if (n !== undefined) console.log(`Las próximas ${n} desde el ${desde}${que}: ${lista.length}`);
  else console.log(`Del ${desde} al ${hasta}${que}: ${lista.length} ocurrencia(s)`);
  for (const o of lista) console.log(formatear(o));
  for (const a of avisos) console.log(a);
  return 0;
}

function uso(motivo) {
  console.error(`Error: ${motivo}.`);
  console.error(
    "Uso: node consultar.mjs (--hoy | --dia F | --semana [F] | --mes [F] | --desde F --hasta F | --proximas N [--desde F])" +
      " [--buscar texto] [--fecha-hoy F] [--vault carpeta] [--json]",
  );
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
