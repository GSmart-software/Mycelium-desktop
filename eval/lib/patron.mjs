// El patrón humano del juez (§ 7, «Cómo se valida al juez»): qué respuestas se
// le dan al usuario para puntuar a mano, la planilla en que las puntúa y cómo se
// la lee de vuelta. Lógica pura. La prueban `eval/test/juez.test.mjs`.

import { contiene, normalizar } from "./texto.mjs";
import { lineasClave } from "./juez.mjs";
import { CLASES_JUEZ, analizarDistractores } from "./puntuacion.mjs";
import { prng } from "./regla.mjs";

/**
 * Tamaño y composición del patrón. EXTENSIÓN: la nota pide «~60 respuestas» sin
 * decir cuáles. El reparto sale de a quién va a juzgar el juez de verdad:
 *  - `juez`: TODAS las respuestas del brazo base en las clases que van al juez
 *    (C2, C3). Son las difíciles y las que deciden: es la población del juez.
 *  - `dudoso`: respuestas (no ciegas) de las clases mecánicas con alguna señal de que la
 *    regla de cadenas pudo equivocarse (distractor negado, dato a medias,
 *    ausencia dicha a medias, respuesta con reservas). Son las que el nivel 1
 *    marcaría ambiguas y le mandaría al juez.
 *  - `facil`: respuestas del brazo ciego en C2/C3, casi siempre «no tengo
 *    acceso». Anclan la escala; son pocas a propósito, porque inflan el acuerdo.
 *  - `control`: el resto, al azar entre las mecánicas del brazo base.
 */
export const COMPOSICION = Object.freeze({ total: 60, facil: 6, dudoso: 18, maxPorPregunta: 3 });

const RESERVAS = ["no estoy segur", "probablemente", "posiblemente", "creo que", "podria ser", "no puedo confirmar", "no queda claro"];
const PROSA_AUSENCIA = ["no esta", "no figura", "no aparece", "no encontr", "no hay ", "no se menciona", "no contiene", "no tengo informacion", "no consta", "no se encuentra"];

/**
 * Cuán dudosa es la puntuación mecánica de una fila (0 = nada). Solo mira la
 * respuesta y la clave: NUNCA el veredicto del juez, que no puede influir en qué
 * casos se usan para validarlo.
 */
export function puntajeDuda(fila, clave) {
  const t = normalizar(fila.respuesta ?? "");
  let s = 0;
  const d = analizarDistractores(t, clave.distractores ?? []);
  if (d.negados.length) s += 3;
  if (d.afirmados.length && fila.acierto === 0) s += 1;
  if (clave.veredicto === "ausencia") {
    const prosa = PROSA_AUSENCIA.some((p) => t.includes(p));
    if (prosa !== (fila.no_esta === true)) s += 3; // lo dice en prosa pero no en el campo, o al revés
  } else if (Array.isArray(clave.requeridas) && clave.requeridas.length > 1 && fila.acierto === 0) {
    const cubiertos = clave.requeridas.filter((g) => g.some((alt) => contiene(t, alt))).length;
    if (cubiertos > 0) s += 2; // tiene parte del dato: ¿le falta de verdad o lo dijo con otras palabras?
  }
  if (fila.acierto === 1 && RESERVAS.some((r) => t.includes(r))) s += 1;
  if (fila.acierto === 1 && fila.no_esta === true) s += 2;
  return s;
}

function barajar(xs, r) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(r() * (i + 1));
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a;
}

/**
 * Elige el patrón entre las filas válidas (última de cada sesión) de una tanda.
 * Determinista con la semilla. Devuelve `[{id, session_id, tanda, pregunta,
 * estrato, humano: null, humano_comentario: null}]` barajado.
 */
export function seleccionarPatron(filas, claves, { semilla = 20260924, composicion = COMPOSICION } = {}) {
  const r = prng(semilla);
  const validas = filas.filter((f) => !f.descartada && typeof f.respuesta === "string" && claves[f.pregunta] && !claves[f.pregunta].sellada);
  const usadas = new Set();
  const porPregunta = {};
  const elegidas = [];
  const tomar = (f, estrato, tope = Infinity) => {
    if (usadas.has(f.session_id) || (porPregunta[f.pregunta] ?? 0) >= tope) return false;
    usadas.add(f.session_id);
    porPregunta[f.pregunta] = (porPregunta[f.pregunta] ?? 0) + 1;
    elegidas.push({ f, estrato });
    return true;
  };
  const deJuez = (f) => CLASES_JUEZ.has(f.clase);

  for (const f of validas) if (deJuez(f) && f.brazo !== "ciego") tomar(f, "juez");
  let n = 0;
  for (const f of barajar(validas.filter((f) => deJuez(f) && f.brazo === "ciego"), r)) if (n < composicion.facil && tomar(f, "facil")) n++;
  const conDuda = barajar(validas.filter((f) => !deJuez(f) && f.brazo !== "ciego"), r)
    .map((f) => ({ f, s: puntajeDuda(f, claves[f.pregunta]) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  n = 0;
  for (const { f } of conDuda) if (n < composicion.dudoso && tomar(f, "dudoso", composicion.maxPorPregunta)) n++;
  for (const f of barajar(validas.filter((f) => !deJuez(f) && f.brazo !== "ciego"), r)) {
    if (elegidas.length >= composicion.total) break;
    tomar(f, "control", composicion.maxPorPregunta);
  }
  return barajar(elegidas, r).map(({ f, estrato }, i) => ({
    id: `J-${String(i + 1).padStart(2, "0")}`,
    session_id: f.session_id,
    tanda: f.tanda,
    pregunta: f.pregunta,
    estrato,
    humano: null,
    humano_comentario: null,
  }));
}

export const VEREDICTOS = ["correcto", "incorrecto", "duda"];

export const GUIA = `> [!important] Cómo puntuar (leé esto una vez, son dos minutos)
> Para cada respuesta marcá **una** casilla: \`correcto\`, \`incorrecto\` o \`duda\`.
> Clic en la casilla, o cambiá \`[ ]\` por \`[x]\`. Nada más que tocar.
>
> **La única pregunta es: ¿la respuesta dice el dato de la clave?**
>
> - **correcto** — afirma el dato. Con otras palabras vale. Si la clave tiene
>   *elementos obligatorios* numerados, tienen que estar **todos**.
> - **incorrecto** — le falta algún elemento obligatorio; o afirma un
>   **distractor** como su respuesta; o dice que no sabe o que el vault no lo tiene
>   (en una pregunta de tipo *dato*); o, en una de tipo *ausencia*, afirma un dato
>   en vez de decir que no está. Una respuesta a medias es **incorrecta**.
> - **duda** — solo cuando **la clave** no te alcanza para decidir: la respuesta
>   dice algo que la clave ni acepta ni descarta. Escribí por qué en *Comentario*:
>   casi siempre quiere decir que hay que afinar la clave.
>
> Lo que **no** cuenta:
> - El estilo, el largo, la seguridad con que está escrita. Una respuesta corta
>   con el dato es tan correcta como una larga.
> - Las citas y las fuentes: se puntúan solas, aparte.
> - Lo que vos sabés del proyecto. Si la respuesta dice algo cierto que la clave no
>   pide, no suma; juzgá contra la clave, aunque creas que la clave está mal (en
>   ese caso, \`duda\` y comentario).
> - Un distractor **mencionado para descartarlo** («unicode11 no alcanzaba») no es
>   error.
>
> Las respuestas vienen de distintas configuraciones, mezcladas y sin decir cuál
> es cuál. No intentes adivinarlo. Están agrupadas por pregunta: leé la clave una
> vez y puntuá las que tiene debajo.
>
> Cuando termines: \`node eval/patron.mjs validar\`. Podés dejarla a medias y
> seguir otro día: lo que no está marcado no cuenta.`;

function cita(texto) {
  return String(texto ?? "(vacía)")
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
}

/**
 * La planilla en Markdown: se abre en Mycelium, que muestra las casillas. Sin
 * brazo, sin veredicto del juez, sin puntaje mecánico, sin citas.
 */
export function planillaMarkdown(items, claves, filasPorSesion) {
  const out = [];
  out.push("# Patrón del juez — planilla", "");
  out.push(`${items.length} respuestas para puntuar a mano. Es la vara contra la que se mide al juez automático de la evaluación del MCP ([[MCP de Mycelium - evaluacion]], § 7).`, "");
  out.push(GUIA, "");
  const grupos = new Map();
  for (const it of items) {
    if (!grupos.has(it.pregunta)) grupos.set(it.pregunta, []);
    grupos.get(it.pregunta).push(it);
  }
  for (const [q, its] of grupos) {
    const c = claves[q];
    out.push("---", "", `## ${q}`, "", `**Pregunta.** ${String(c.pregunta ?? "").trim()}`, "");
    out.push("**Clave.**", "", "```", ...lineasClave(c), "```", "");
    for (const it of its) {
      const f = filasPorSesion.get(it.session_id);
      out.push(`### ${it.id}`, "");
      out.push(`*Declaró que el vault no contiene el dato:* **${f?.no_esta === true ? "sí" : "no"}**`, "");
      out.push(cita(f?.respuesta), "");
      for (const v of VEREDICTOS) out.push(`- [${it.humano === v ? "x" : " "}] ${v}`);
      out.push("", `Comentario: ${it.humano_comentario ?? ""}`, "");
    }
  }
  return out.join("\n");
}

/**
 * Lee la planilla puntuada. Devuelve `{veredictos: Map(id → {humano,
 * comentario}), problemas: [...]}`. Una respuesta sin marcar no cuenta; una con
 * dos marcas es un problema, no se adivina cuál quiso.
 */
export function leerPlanilla(md) {
  const veredictos = new Map();
  const problemas = [];
  let actual = null;
  const cerrar = () => {
    if (!actual) return;
    if (actual.marcas.length > 1) problemas.push(`${actual.id}: marcó ${actual.marcas.join(" y ")}; tiene que ser una sola`);
    else if (actual.marcas.length === 1) veredictos.set(actual.id, { humano: actual.marcas[0], comentario: actual.comentario || null });
    actual = null;
  };
  for (const linea of String(md).split(/\r?\n/)) {
    const h = /^###\s+(J-\d+)\s*$/.exec(linea);
    if (h) {
      cerrar();
      actual = { id: h[1], marcas: [], comentario: "" };
      continue;
    }
    if (/^##?\s/.test(linea)) {
      cerrar();
      continue;
    }
    if (!actual) continue;
    const m = /^\s*[-*]\s+\[([ xX])\]\s+(correcto|incorrecto|duda)\s*$/.exec(linea);
    if (m && m[1] !== " ") actual.marcas.push(m[2]);
    const c = /^Comentario:\s*(.*)$/.exec(linea);
    if (c) actual.comentario = c[1].trim();
  }
  cerrar();
  return { veredictos, problemas };
}

/**
 * Junta patrón, juicios y filas en los pares que mide `acuerdo` (lib/juez.mjs).
 * El veredicto del juez es el último no descartado de ESE juez (modelo + versión
 * del prompt) para la sesión. `mecanico`: el acierto de la primera fila de la
 * sesión, la que puntuó la regla de cadenas antes que nadie.
 */
export function paresPatron(patron, juicios, primeraPorSesion, { modelo, version }) {
  const ultimoJuicio = new Map();
  for (const j of juicios) if (!j.descartado && j.modelo_juez === modelo && j.version_juez === version) ultimoJuicio.set(j.session_id, j.veredicto);
  return patron.map((it) => {
    const f = primeraPorSesion.get(it.session_id);
    return {
      id: it.id,
      estrato: it.estrato,
      pregunta: it.pregunta,
      brazo: f?.brazo ?? null,
      humano: it.humano ?? null,
      juez: ultimoJuicio.get(it.session_id) ?? null,
      mecanico: f ? (f.acierto === 1 ? "correcto" : "incorrecto") : null,
    };
  });
}
