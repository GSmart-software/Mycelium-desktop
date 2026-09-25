// Escribe `eval/preguntas.jsonl` desde un borrador en claro: las de desarrollo
// quedan legibles y las de reserva, selladas (ver `lib/sello.mjs`).
//
//   node eval/sellar.mjs --desde <borrador.json>        # crea la clave si no existe
//   node eval/sellar.mjs --comprobar                     # abre cada sellada y verifica su SHA-256, sin mostrarla
//
// El borrador en claro NO va al repo: se escribe fuera (p. ej. en un temporal) y
// se borra después de sellar. Abrir la reserva para leerla es `cargarPreguntas`
// con `abrirReserva`, y solo el día de la decisión (§ 2).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { leerJsonl } from "./lib/preguntas.mjs";
import { abrir, leerClave, rutaClave, sellar } from "./lib/sello.mjs";
import { OPCION_VAULT, vaultDeArgs } from "./lib/vault.mjs";

// Con `--vault <json>`, las preguntas y la clave del sello son las de ese vault.
const VAULT = vaultDeArgs();
const DESTINO = VAULT.preguntas;

const ORDEN = [
  "id", "clase", "conjunto", "sellada", "quemada", "retirada", "pregunta", "fuente", "veredicto", "dato",
  "aceptadas", "requeridas", "distractores", "notas_clave", "notas_admisibles", "secciones_clave",
  "fuentes_codigo", "prueba_fuera_indice", "no_debe_aparecer",
];

function ordenar(p) {
  const out = {};
  for (const k of ORDEN) if (p[k] !== undefined) out[k] = p[k];
  for (const k of Object.keys(p)) if (!(k in out)) out[k] = p[k];
  return out;
}

function principal() {
  const { values: v } = parseArgs({ options: { ...OPCION_VAULT, desde: { type: "string" }, comprobar: { type: "boolean", default: false } } });
  if (v.comprobar) {
    const clave = leerClave({ ruta: VAULT.sello });
    let n = 0;
    for (const l of leerJsonl(DESTINO)) if (l.sellada) (abrir(l, clave), n++);
    console.log(`${n} preguntas selladas: todas abren y coinciden con su compromiso.`);
    return;
  }
  if (!v.desde) throw new Error("Falta --desde <borrador.json>.");
  const borrador = JSON.parse(readFileSync(resolve(v.desde), "utf8"));
  const clave = leerClave({ crear: true, ruta: VAULT.sello });
  const lineas = borrador.map((p) => {
    const q = ordenar({ ...p, sellada: false, quemada: false, retirada: false });
    return p.conjunto === "reserva" ? sellar(q, clave) : q;
  });
  writeFileSync(DESTINO, lineas.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const r = lineas.filter((l) => l.sellada).length;
  console.log(`${lineas.length} preguntas en ${DESTINO}: ${lineas.length - r} de desarrollo, ${r} selladas. Clave: ${rutaClave(VAULT.sello)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (e) {
    console.error(`FALLO: ${e.message}`);
    process.exit(1);
  }
}
