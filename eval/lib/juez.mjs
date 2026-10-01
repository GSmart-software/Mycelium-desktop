// El juez LLM (nivel 2 de la § 7, «Quién puntúa») y su validación contra el
// patrón humano. Lógica pura: sin disco, sin red. La prueban
// `eval/test/juez.test.mjs`.
//
// Especificación: docs/arquitectura/"MCP de Mycelium - evaluacion.md" § 3 (la
// clave), § 4 (el ejemplo), § 7 (el juez y la regla que lo invalida) y § 8,
// sesgo 5 (el largo). Lo que la nota no fijaba y se decidió acá está marcado con
// «EXTENSIÓN».

import { validarFila } from "./formato.mjs";

/**
 * Versión del prompt del juez. Sube cuando cambia el texto que ve el juez: un
 * veredicto de otra versión es de otro juez y no se reutiliza (§ 7: «si el modelo
 * del juez cambia, hay que revalidarlo»; el prompt es la mitad del juez).
 */
export const VERSION_JUEZ = "1";

/** Salida forzada del juez (§ 7): `{veredicto, motivo}`. */
export const ESQUEMA_JUEZ = {
  type: "object",
  properties: {
    veredicto: {
      type: "string",
      enum: ["correcto", "incorrecto", "duda"],
      description: "correcto / incorrecto según la clave; duda solo si la clave no alcanza para decidir.",
    },
    motivo: {
      type: "string",
      description: "Una o dos frases: qué elemento de la clave vio o no vio en la respuesta (citá la cadena).",
    },
  },
  required: ["veredicto", "motivo"],
  additionalProperties: false,
};

/**
 * Instrucciones del juez. Van como `--system-prompt`, que REEMPLAZA al del
 * agente: el juez no es un asistente de código ni conoce el proyecto.
 */
export const SISTEMA_JUEZ = [
  "Sos un evaluador. Recibís una pregunta, su clave de respuesta y UNA respuesta a evaluar.",
  "Decidís si la respuesta ACIERTA el dato de la clave. Nada más: no evaluás estilo, largo, tono, citas ni fuentes.",
  "",
  "Reglas:",
  "1. Juzgá SOLO contra la clave. No uses lo que sepas del tema: si la respuesta dice algo cierto que la clave no pide, no suma; si contradice a la clave, está mal aunque a vos te parezca razonable.",
  "2. Acierto (tipo «dato»): la respuesta afirma el dato de la clave. Cuentan los sinónimos y las paráfrasis del mismo contenido; no cuenta una idea vecina ni más vaga. Si la clave trae «elementos obligatorios», TODOS tienen que estar afirmados.",
  "3. Distractores: si la respuesta AFIRMA un distractor como su respuesta, es incorrecta aunque también diga lo correcto. Un distractor mencionado para negarlo o descartarlo («X no alcanzaba», «en vez de X») NO es error.",
  "4. Si la respuesta declara que el vault no contiene el dato, o se niega a contestar, en una pregunta de tipo «dato»: incorrecta.",
  "5. Tipo «ausencia»: la respuesta correcta es decir que el dato NO está. Es correcta solo si lo dice claramente y no inventa una respuesta; afirmar un dato concreto es incorrecto aunque agregue «no estoy seguro».",
  "6. Una respuesta larga, segura o bien redactada no vale más que una corta. Solo importa si el dato está.",
  "7. «duda» es solo para cuando la CLAVE no alcanza para decidir (por ejemplo, la respuesta dice algo que la clave ni acepta ni descarta). No la uses para una respuesta que simplemente es mala o parcial: una respuesta parcial es incorrecta.",
  "",
  "En «motivo» decí qué elemento de la clave encontraste o echaste en falta, citándolo.",
].join("\n");

/** Una cadena de la clave como la ve el juez: los patrones `/regex/` se explican. */
function mostrarPatron(p) {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(p);
  // `\b` (borde de palabra) y los escapes no le dicen nada a quien lee: se quitan.
  return m ? `«${m[1].replace(/\\b/g, "").replace(/\\(.)/g, "$1")}» (patrón: | separa variantes, [..] es uno de esos caracteres, ? hace opcional lo anterior)` : `«${p}»`;
}

/**
 * La clave tal como la leen el juez Y el humano del patrón: los dos tienen que
 * ver exactamente lo mismo, o el desacuerdo mediría la diferencia de lo que
 * vieron y no la del criterio.
 */
export function lineasClave(clave) {
  const l = [];
  l.push(`Tipo: ${clave.veredicto === "ausencia" ? "ausencia (lo correcto es decir que el dato no está)" : "dato"}`);
  l.push(`Dato correcto: ${String(clave.dato ?? "").trim()}`);
  if (Array.isArray(clave.requeridas) && clave.requeridas.length) {
    l.push("Elementos obligatorios (tienen que estar TODOS; dentro de cada uno, cualquiera de las variantes):");
    clave.requeridas.forEach((g, i) => l.push(`  ${i + 1}. ${g.map(mostrarPatron).join(" o ")}`));
  } else if (clave.aceptadas?.length) {
    l.push(`Cadenas que cuentan como acierto (basta una): ${clave.aceptadas.map(mostrarPatron).join(", ")}`);
  }
  l.push(`Distractores (afirmarlos como respuesta es error): ${clave.distractores?.length ? clave.distractores.map(mostrarPatron).join(", ") : "ninguno"}`);
  return l;
}

/**
 * El mensaje del juez para una respuesta. CIEGO AL BRAZO por construcción: solo
 * recibe la clave, el texto de la respuesta y su `no_esta`, y un identificador
 * opaco. No recibe la fila (brazo, herramientas, tokens, sesión) ni las citas —la
 * lista de citas vacía delata al brazo ciego, y las citas se puntúan
 * mecánicamente (§ 3)—.
 */
export function promptJuez(clave, salida, idOpaco) {
  const l = [];
  l.push(`Respuesta ${idOpaco}`, "");
  l.push("## Pregunta", "", String(clave.pregunta ?? "").trim(), "");
  l.push("## Clave", "", ...lineasClave(clave));
  l.push("", "## Respuesta a evaluar", "");
  l.push(`Declaró que el vault no contiene el dato: ${salida?.no_esta === true ? "sí" : "no"}`, "");
  l.push(String(salida?.respuesta ?? "(vacía)").trim());
  return l.join("\n");
}

/** Identificador opaco y estable de una sesión: el juez no ve el `session_id`. */
export function idOpaco(sessionId, sal = "juez") {
  let h = 2166136261;
  for (const ch of `${sal}:${sessionId}`) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return `R-${h.toString(36).padStart(7, "0").slice(-7)}`;
}

/**
 * La fila nueva que agrega el veredicto (§ 10: append-only, manda la última de
 * cada sesión). Mismo `session_id` y mismos campos de la corrida; cambian solo
 * `acierto`, `acierto_citado`, `puntuador` y `juez_motivo`. Las citas siguen
 * puntuadas mecánicamente: el juez decide el dato, no las citas.
 *
 * Un veredicto `duda` NO produce fila: la corrida queda `requiere-juez` (su
 * puntaje sigue provisional) y va al árbitro humano (§ 7, nivel 3). Devuelve
 * `null` en ese caso.
 */
export function filaConVeredicto(fila, veredicto, motivo, puntuador = "juez") {
  if (veredicto === "duda") return null;
  if (!["correcto", "incorrecto"].includes(veredicto)) throw new Error(`veredicto inválido: ${veredicto}`);
  const acierto = veredicto === "correcto" ? 1 : 0;
  const nueva = {
    ...fila,
    acierto,
    acierto_citado: acierto === 1 && fila.citas_exhaustividad === 1 ? 1 : 0,
    puntuador,
    juez_motivo: String(motivo ?? "").trim() || null,
  };
  const problemas = validarFila(nueva);
  if (problemas.length) throw new Error(`la fila del juez no cumple la § 10: ${problemas.join("; ")}`);
  return nueva;
}

/** Filas que le tocan al juez: la última de cada sesión, válida y `requiere-juez`. */
export function pendientesDeJuez(ultimas) {
  return ultimas.filter((f) => !f.descartada && f.puntuador === "requiere-juez" && typeof f.respuesta === "string");
}

// ---------------------------------------------------------------------------
// Validación contra el patrón humano (§ 7, «Cómo se valida al juez»)
// ---------------------------------------------------------------------------

/** κ de Cohen para dos puntuadores binarios sobre los mismos casos. */
export function kappa(pares) {
  const n = pares.length;
  if (!n) return NaN;
  let acuerdo = 0;
  let h1 = 0;
  let j1 = 0;
  for (const { humano, juez } of pares) {
    if (humano === juez) acuerdo++;
    h1 += humano;
    j1 += juez;
  }
  const po = acuerdo / n;
  const pe = (h1 / n) * (j1 / n) + (1 - h1 / n) * (1 - j1 / n);
  if (pe === 1) return po === 1 ? 1 : NaN; // los dos dijeron siempre lo mismo: κ no está definido
  return (po - pe) / (1 - pe);
}

/** Intervalo de Wilson del 95 % para una proporción. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [NaN, NaN];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const r = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - r), Math.min(1, c + r)];
}

const A_BIN = { correcto: 1, incorrecto: 0 };

/**
 * Acuerdo juez-humano sobre el patrón. `items`: `{humano, juez, brazo?}` con los
 * veredictos en texto. EXTENSIÓN (la nota no dice qué hacer con las dudas):
 *  - si el HUMANO dijo `duda`, el caso sale de la cuenta —no hay patrón contra el
 *    cual medir— y se reporta: casi siempre es una clave floja (§ 7);
 *  - si el JUEZ dijo `duda`, tampoco es un desacuerdo —la duda va al humano, que
 *    la arbitra, así que no produce un puntaje equivocado—, pero se reporta su
 *    tasa: un juez que duda de todo no se equivoca y tampoco sirve.
 */
export function acuerdo(items) {
  const pares = [];
  let dudasHumano = 0;
  let dudasJuez = 0;
  let sinJuez = 0;
  let sinHumano = 0;
  for (const it of items) {
    if (it.humano == null) {
      sinHumano++;
      continue;
    }
    if (it.juez == null) {
      sinJuez++;
      continue;
    }
    if (it.humano === "duda") {
      dudasHumano++;
      continue;
    }
    if (it.juez === "duda") {
      dudasJuez++;
      continue;
    }
    pares.push({ humano: A_BIN[it.humano], juez: A_BIN[it.juez], brazo: it.brazo });
  }
  const desacuerdos = pares.filter((p) => p.humano !== p.juez).length;
  const n = pares.length;
  return {
    n,
    desacuerdos,
    tasa: n ? desacuerdos / n : NaN,
    ic: wilson(desacuerdos, n),
    kappa: kappa(pares),
    // A favor del «correcto»: el juez da por buena una que el humano no. Es el
    // sesgo que fabrica ventajas (§ 8, sesgo 5).
    juezGeneroso: pares.filter((p) => p.juez === 1 && p.humano === 0).length,
    juezSevero: pares.filter((p) => p.juez === 0 && p.humano === 1).length,
    dudasHumano,
    dudasJuez,
    sinJuez,
    sinHumano,
  };
}

export const KAPPA_MINIMO = 0.8; // § 7: κ ≥ 0,8 para usarlo sin supervisión

/**
 * ¿Puede el juez decidir una comparación? § 7, las dos reglas:
 *  - κ ≥ 0,8 para usarlo sin supervisión;
 *  - y la que manda: si la tasa de desacuerdo es MAYOR que la diferencia que se
 *    mide, no puede decidirla.
 *
 * `diferenciaPts`: la diferencia que se mide, en puntos porcentuales (se toma su
 * valor absoluto). La regla compara la tasa PUNTUAL, como está escrita; el techo
 * del intervalo de Wilson se devuelve aparte como advertencia, no decide.
 */
export function juezPuedeDecidir(ac, diferenciaPts) {
  if (!ac || !ac.n) return { puede: false, motivo: "el patrón no está puntuado (o no tiene casos decididos por los dos)" };
  const tasaPts = ac.tasa * 100;
  const dif = Math.abs(diferenciaPts);
  if (!Number.isFinite(dif)) return { puede: false, motivo: "no hay diferencia medida" };
  if (!(ac.kappa >= KAPPA_MINIMO)) return { puede: false, motivo: `κ = ${fmt(ac.kappa)} < ${KAPPA_MINIMO}: no se lo puede usar sin supervisión` };
  if (tasaPts > dif) return { puede: false, motivo: `desacuerdo ${fmt(tasaPts, 1)} pts > diferencia ${fmt(dif, 1)} pts` };
  const techo = ac.ic[1] * 100;
  return {
    puede: true,
    motivo: `desacuerdo ${fmt(tasaPts, 1)} pts ≤ diferencia ${fmt(dif, 1)} pts y κ = ${fmt(ac.kappa)}`,
    advertencia: techo > dif ? `el techo del IC 95 % del desacuerdo (${fmt(techo, 1)} pts) supera la diferencia: con este patrón no se descarta que el juez se equivoque más que el efecto` : null,
  };
}

function fmt(x, d = 2) {
  return Number.isFinite(x) ? x.toFixed(d) : "—";
}

// ---------------------------------------------------------------------------
// § 8, sesgo 5: ¿el veredicto correlaciona con el largo de la respuesta?
// ---------------------------------------------------------------------------

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export const CORRELACION_FUERTE = 0.5;

/**
 * Correlación (punto-biserial) entre el veredicto del juez (1/0) y el largo de la
 * respuesta en caracteres, sobre las filas puntuadas por el juez. Dos lecturas:
 *
 *  - `global`: la cruda. Está confundida por la pregunta y por el brazo —una
 *    respuesta que dice «no tengo acceso» es corta y mala—, así que sola no
 *    prueba nada.
 *  - `intra`: EXTENSIÓN. Con el largo y el veredicto centrados por pregunta y
 *    brazo: ¿dentro de la MISMA pregunta y el mismo brazo, la respuesta más larga
 *    sale mejor puntuada? Es la que delata a un juez que puntúa estilo. (El brazo
 *    lo usa este cálculo, nunca el juez.)
 */
export function correlacionLargo(filas) {
  const js = filas.filter((f) => f.puntuador === "juez" && typeof f.respuesta === "string");
  const global = pearson(js.map((f) => f.respuesta.length), js.map((f) => f.acierto));
  const porQ = {};
  for (const f of js) (porQ[`${f.pregunta}|${f.brazo}`] ??= []).push(f);
  const xs = [];
  const ys = [];
  for (const g of Object.values(porQ)) {
    if (g.length < 2) continue;
    const mx = g.reduce((a, f) => a + f.respuesta.length, 0) / g.length;
    const my = g.reduce((a, f) => a + f.acierto, 0) / g.length;
    for (const f of g) {
      xs.push(f.respuesta.length - mx);
      ys.push(f.acierto - my);
    }
  }
  const intra = pearson(xs, ys);
  return { n: js.length, global, intra, fuerte: Math.abs(intra) >= CORRELACION_FUERTE };
}
