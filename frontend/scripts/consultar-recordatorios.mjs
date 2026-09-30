// Lista las ocurrencias del calendario de un vault en un rango de fechas, para
// probar la skill `mycelium-calendario` (`FUN-L-26`). SOLO LEE
// `.mycelium/recordatorios.json`.
//
// Usa el MISMO modelo que la app (`lib/recordatorios.ts`, transpilado en el
// momento): `leerArchivo` descarta lo que la app descarta y
// `ocurrenciasEnRango` expande las repeticiones igual —el 31 no cae en meses
// sin 31, el 29 de febrero solo en bisiestos—. Así la respuesta de referencia
// contra la que se compara a la IA no es una segunda implementación.
//
//   node scripts/consultar-recordatorios.mjs --vault <carpeta> --desde AAAA-MM-DD --hasta AAAA-MM-DD [--json]
//   node scripts/consultar-recordatorios.mjs --vault <carpeta> --semana AAAA-MM-DD   (lunes a domingo)
//   node scripts/consultar-recordatorios.mjs --vault <carpeta> --mes AAAA-MM-DD
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { importarTs } from "./lib-vault-fixture.mjs";

export const R = await importarTs("lib/recordatorios.ts");

const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const REPE = { ninguna: "", dia: "cada día", semana: "cada semana", mes: "cada mes", anio: "cada año" };

/** Lee y valida `.mycelium/recordatorios.json`; `null` si no existe o no tiene la forma. */
export async function leerRecordatorios(vault) {
  let texto;
  try {
    texto = await readFile(join(vault, ".mycelium", "recordatorios.json"), "utf8");
  } catch {
    return null;
  }
  return R.leerArchivo(JSON.parse(texto));
}

/**
 * Las ocurrencias entre `desde` y `hasta` (inclusive), en el orden de la app
 * (fecha, «todo el día» primero, hora, título), con su estado.
 */
export function consultar(archivo, desde, hasta) {
  return R.ocurrenciasEnRango(archivo.recordatorios, desde, hasta).map((o) => {
    const clave = R.claveOcurrencia(o.recordatorio.id, o.fecha);
    const estado = archivo.ocurrencias[clave] ?? {};
    return {
      fecha: o.fecha,
      dia: DIAS[R.diaDeSemana(o.fecha)],
      hora: o.recordatorio.hora,
      titulo: o.recordatorio.titulo,
      repeticion: o.recordatorio.repeticion,
      color: o.recordatorio.color,
      completada: estado.completada === true,
      descartada: estado.descartada === true,
      pospuestaHasta: estado.pospuestaHasta ?? null,
      enlaces: [...o.recordatorio.detalle.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`),
      detalle: o.recordatorio.detalle,
    };
  });
}

/** Una línea legible por ocurrencia. */
export function formatear(o) {
  const partes = [
    `${o.fecha} ${o.dia}`,
    o.hora ?? "todo el día",
    o.titulo,
  ];
  if (REPE[o.repeticion]) partes.push(`(${REPE[o.repeticion]})`);
  if (o.completada) partes.push("[completada]");
  if (o.enlaces.length) partes.push(`→ ${o.enlaces.join(" ")}`);
  return partes.join("  ");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const opt = (n) => {
    const i = args.indexOf(n);
    return i === -1 ? null : args[i + 1];
  };
  const vault = opt("--vault") ?? ".";
  let desde = opt("--desde");
  let hasta = opt("--hasta");
  if (opt("--semana")) ({ desde, hasta } = R.rangoDePeriodo(opt("--semana"), "semana"));
  if (opt("--mes")) ({ desde, hasta } = R.rangoDePeriodo(opt("--mes"), "mes"));
  if (opt("--dia")) desde = hasta = opt("--dia");
  if (!desde || !hasta || !R.esFechaValida(desde) || !R.esFechaValida(hasta)) {
    console.error("Uso: --vault <carpeta> (--desde AAAA-MM-DD --hasta AAAA-MM-DD | --semana F | --mes F | --dia F) [--json]");
    process.exit(2);
  }
  const archivo = await leerRecordatorios(vault);
  if (archivo === null) {
    console.log("El vault no tiene calendario (.mycelium/recordatorios.json no existe o no se puede leer).");
    process.exit(0);
  }
  const ocurrencias = consultar(archivo, desde, hasta);
  if (args.includes("--json")) console.log(JSON.stringify({ desde, hasta, ocurrencias }, null, 2));
  else {
    console.log(`Del ${desde} al ${hasta}: ${ocurrencias.length} ocurrencia(s)`);
    for (const o of ocurrencias) console.log(`  ${formatear(o)}`);
  }
}
