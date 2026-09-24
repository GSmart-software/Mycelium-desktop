// Puntuación mecánica (nivel 1) de una corrida contra la clave de su pregunta.
// Lógica pura: sin disco, sin red. La prueban `eval/test/puntuacion.test.mjs`.
//
// Especificación: docs/arquitectura/"MCP de Mycelium - evaluacion.md" § 3 y § 7
// («Quién puntúa»). Lo que la nota no fijaba y se decidió acá está marcado con
// «EXTENSIÓN».

import { compilarPatron, contiene, normalizar, normalizarCita } from "./texto.mjs";

/** Vocabulario cerrado de negación (§ 4, «El único punto donde hace falta juicio»). */
export const NEGACIONES = [
  "no alcanz",
  "no basta",
  "no sirv",
  "insuficiente",
  "en vez de",
  "no es",
  "descartad",
];

/** Cómo dice en prosa una respuesta que el dato no está en el vault (§ 3, regla 1). */
const PROSA_AUSENCIA = [
  "no esta",
  "no figura",
  "no aparece",
  "no encontr",
  "no hay ",
  "no se menciona",
  "no menciona",
  "no lo dice",
  "no registra",
  "no se registr",
  "no documenta",
  "no se document",
  "no contiene",
  "no tengo informacion",
  "no existe",
  "sin informacion",
  "no consta",
  "no se encuentra",
  "no dice",
  "no trata",
  "no cubre",
  "no recoge",
];

/**
 * Clases cuyo acierto es prosa y va al juez LLM (§ 7, nivel 2). El puntaje
 * mecánico de esas clases queda como provisional.
 */
export const CLASES_JUEZ = new Set(["C2", "C3"]);

/**
 * Parte en frases: lo que responde es la frase, no el párrafo (§ 4). Un punto
 * pegado a lo que sigue (`2.1.0`, `lib.ts`) no corta la frase.
 */
function frases(textoNormalizado) {
  const out = [];
  const re = /(?:[^.;!?\n]|[.;!?](?=\S))+/g;
  let m;
  while ((m = re.exec(textoNormalizado))) out.push({ ini: m.index, fin: m.index + m[0].length, t: m[0] });
  return out;
}

/**
 * Cada aparición de un distractor, clasificada: `afirmado` si su frase no trae
 * ninguna marca de negación, `negado` si la trae. Un negado NO se resuelve solo:
 * se manda al juez (§ 4).
 */
export function analizarDistractores(textoNormalizado, distractores = []) {
  const partes = frases(textoNormalizado);
  const afirmados = [];
  const negados = [];
  for (const d of distractores) {
    for (const hit of compilarPatron(d).buscar(textoNormalizado)) {
      const f = partes.find((p) => hit.i >= p.ini && hit.i < p.fin);
      const frase = f ? f.t : textoNormalizado;
      (NEGACIONES.some((n) => frase.includes(n)) ? negados : afirmados).push(d);
    }
  }
  return { afirmados: [...new Set(afirmados)], negados: [...new Set(negados)] };
}

/**
 * ¿La respuesta contiene el dato? EXTENSIÓN: además de `aceptadas` (basta una),
 * una clave puede traer `requeridas`: grupos de alternativas que tienen que
 * aparecer TODOS. Es lo que necesitan las enumeraciones (C6) y las preguntas de
 * dos partes: con «basta una» se aceptaría una lista a la que le faltan cuatro.
 */
export function contieneDato(textoNormalizado, clave) {
  if (Array.isArray(clave.requeridas) && clave.requeridas.length) {
    const faltan = clave.requeridas.filter((g) => !g.some((alt) => contiene(textoNormalizado, alt)));
    return { ok: faltan.length === 0, faltan };
  }
  const ok = (clave.aceptadas ?? []).some((a) => contiene(textoNormalizado, a));
  return { ok, faltan: ok ? [] : [clave.aceptadas ?? []] };
}

function aplanar(notasClave) {
  return notasClave.flatMap((n) => (Array.isArray(n) ? n : [n]));
}

/** Nombre base de un archivo de código tal como se lo compara con una cita. */
function baseCodigo(ruta) {
  return String(ruta).replace(/\\/g, "/").split("/").pop();
}

/**
 * Puntúa las citas (§ 3, reglas 2 y 3, y el aviso de citas inventadas).
 *
 * EXTENSIÓN: un elemento de `notas_clave` puede ser una lista de alternativas
 * («cualquiera de estas sostiene la respuesta»). Este vault repite mucho —la
 * misma decisión está en la spec, en la nota de versión y en el BACKLOG— y exigir
 * una en particular castigaría al que citó otra igual de legítima.
 *
 * `ctx.titulos`: títulos de las notas del vault. `ctx.archivos`: nombres base de
 * los demás archivos del corpus; citar uno que existe no es inventar, aunque no
 * cuente como admisible salvo que esté en `fuentes_codigo` (clase C7).
 */
export function puntuarCitas(citasCrudas, clave, ctx) {
  const citas = [...new Set((citasCrudas ?? []).map(normalizarCita).filter(Boolean))];
  const clavesNota = clave.notas_clave ?? [];
  const admisibles = new Set([
    ...aplanar(clavesNota),
    ...(clave.notas_admisibles ?? []),
    ...(clave.fuentes_codigo ?? []).map(baseCodigo),
  ]);
  const inventadas = citas.filter((c) => !ctx.titulos.has(c) && !ctx.archivos?.has(c));
  const precision = citas.length === 0 ? null : citas.filter((c) => admisibles.has(c)).length / citas.length;
  const cubiertas = clavesNota.filter((n) => (Array.isArray(n) ? n : [n]).some((alt) => citas.includes(alt)));
  const exhaustividad = clavesNota.length === 0 ? 1 : cubiertas.length / clavesNota.length;
  return { citas, precision, exhaustividad, inventadas };
}

function proseDiceAusencia(textoNormalizado) {
  return PROSA_AUSENCIA.some((p) => textoNormalizado.includes(p));
}

/**
 * Puntúa una salida `{respuesta, citas, no_esta}` contra su clave.
 *
 * Devuelve los campos de § 10 (`acierto`, `distractor`, `citas_precision`,
 * `citas_exhaustividad`, `citas_inventadas`, `acierto_citado`, `puntuador`) más
 * `motivo`, que explica el 0 cuando lo hay y no va a la fila.
 */
export function puntuar(clave, salida, ctx) {
  const texto = normalizar(salida?.respuesta ?? "");
  const noEsta = salida?.no_esta === true;
  const c = puntuarCitas(salida?.citas, clave, ctx);
  const d = analizarDistractores(texto, clave.distractores ?? []);
  const motivos = [];
  let acierto = 0;
  let puntuador = CLASES_JUEZ.has(clave.clase) || clave.puntuador === "juez" ? "requiere-juez" : "mecanico";

  if (clave.veredicto === "ausencia") {
    // § 3, regla 1: `no_esta` true Y dicho en prosa; inventar una fuente es error.
    const prosa = proseDiceAusencia(texto);
    if (!noEsta) motivos.push("no_esta no es true");
    if (!prosa) motivos.push("la prosa no dice que no está");
    if (c.inventadas.length) motivos.push(`cita inventada: ${c.inventadas.join(", ")}`);
    if (d.afirmados.length) motivos.push(`afirma un distractor: ${d.afirmados.join(", ")}`);
    acierto = noEsta && prosa && !c.inventadas.length && !d.afirmados.length ? 1 : 0;
  } else {
    const dato = contieneDato(texto, clave);
    if (noEsta) motivos.push("dijo que no está");
    if (!dato.ok) motivos.push(`falta el dato: ${dato.faltan.map((g) => g.join(" | ")).join(" ; ")}`);
    if (d.afirmados.length) motivos.push(`afirma un distractor: ${d.afirmados.join(", ")}`);
    acierto = !noEsta && dato.ok && !d.afirmados.length ? 1 : 0;
    if (acierto && d.negados.length) {
      // El distractor aparece solo negado: puede ser un acierto que lo descarta o
      // un error dicho con rodeos. No se decide en silencio (§ 4).
      puntuador = "requiere-juez";
      motivos.push(`distractor negado (va al juez): ${d.negados.join(", ")}`);
    }
  }

  return {
    acierto,
    distractor: d.afirmados.length ? 1 : 0,
    citas_precision: c.precision,
    citas_exhaustividad: c.exhaustividad,
    citas_inventadas: c.inventadas.length,
    acierto_citado: acierto === 1 && c.exhaustividad === 1 ? 1 : 0,
    puntuador,
    motivo: motivos.length ? motivos.join(" · ") : null,
    citas: c.citas,
  };
}
