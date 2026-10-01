// La revisión de citas (tesina, pre-registrada el 2026-09-25 antes de la tanda
// de decisión): una respuesta que ACIERTA pero cita una nota que no está en la
// clave no pierde el acierto citado si esa nota sostiene el dato. Lógica pura:
// sin disco, sin red. La prueba `eval/test/citas.test.mjs`.
//
// Por qué existe: en la tanda de desarrollo de la tesina el MCP contestaba bien
// citando la fuente cruda (la página web guardada, el informe crudo de una
// investigación, la ficha del paper) y la clave solo aceptaba las notas de
// síntesis. En las preguntas de desarrollo se corrigió la clave a mano (T10b,
// T11b…); en las selladas no se puede sin leerlas.
//
// Por qué es parejo por construcción: el juez decide sobre el par (pregunta,
// nota) y NO ve la respuesta ni el brazo. Un veredicto vale para toda fila de
// cualquier brazo que haya citado esa nota en esa pregunta.

import { compilarPatron, normalizar, normalizarCita, palabrasDeContenido } from "./texto.mjs";

/** Versión del prompt del revisor: un veredicto de otra versión no se reutiliza. */
export const VERSION_CITAS = "1";

export const ESQUEMA_CITAS = {
  type: "object",
  properties: {
    veredicto: {
      type: "string",
      enum: ["sostiene", "no_sostiene", "duda"],
      description: "sostiene: el texto de la nota contiene el dato de la clave. no_sostiene: no lo contiene, o solo algo vecino. duda: no alcanza para decidir.",
    },
    motivo: { type: "string", description: "Una o dos frases: qué pasaje de la nota contiene el dato (citalo) o qué le falta." },
  },
  required: ["veredicto", "motivo"],
  additionalProperties: false,
};

export const SISTEMA_CITAS = [
  "Sos un evaluador. Recibís una pregunta, el dato que la responde (la clave) y el texto de UNA nota.",
  "Decidís si esa nota SOSTIENE el dato: si alguien que solo leyera esta nota encontraría ahí el dato de la clave.",
  "",
  "Reglas:",
  "1. Juzgá solo con el texto de la nota que recibís. No uses lo que sepas del tema.",
  "2. «sostiene» exige que el dato esté en la nota, dicho con esas u otras palabras. Si la clave tiene varias partes, tienen que estar las partes centrales; un detalle accesorio que falte no la invalida.",
  "3. Una nota que trata el mismo tema pero no trae el dato NO lo sostiene. Tampoco una que solo enlaza a otra nota donde estaría.",
  "4. Si el texto viene en extractos (una nota muy larga), juzgá lo que ves; si el dato podría estar en lo que no ves, «duda».",
  "",
  "En «motivo» citá el pasaje que contiene el dato, o decí qué falta.",
].join("\n");

/**
 * Las filas que se revisan: aciertan (`acierto = 1`) pero no tienen el acierto
 * citado porque sus citas no cubren la clave, en una pregunta con UN solo grupo
 * de notas clave. Las de varios grupos (C4: la respuesta tiene que venir de
 * varias notas) quedan afuera: una nota que sostiene «el dato» no dice qué parte
 * cubre.
 */
export function pendientesDeCitas(filas, claves) {
  return filas.filter((f) => {
    const c = claves[f.pregunta];
    return (
      c &&
      !c.sellada &&
      !f.descartada &&
      f.acierto === 1 &&
      f.acierto_citado === 0 &&
      c.veredicto !== "ausencia" &&
      Array.isArray(c.notas_clave) &&
      c.notas_clave.length === 1 &&
      (f.citas ?? []).length > 0
    );
  });
}

/**
 * Las notas citadas que vale la pena revisar: existen en el vault (una cita
 * inventada no se rescata) y no son ya de la clave. En el orden en que se citaron.
 */
export function notasARevisar(fila, clave, titulos) {
  const grupo = new Set((Array.isArray(clave.notas_clave[0]) ? clave.notas_clave[0] : [clave.notas_clave[0]]).map(normalizarCita));
  const vistas = new Set();
  const out = [];
  for (const c of fila.citas ?? []) {
    const t = normalizarCita(c);
    if (!titulos.has(t) || grupo.has(t) || vistas.has(t)) continue;
    vistas.add(t);
    out.push(t);
  }
  return out;
}

/**
 * El texto de la nota que ve el revisor. Entera si entra en `tope`; si no, los
 * tramos de ±`radio` líneas alrededor de las líneas que más palabras del dato (o
 * patrones de la clave) tienen, de mayor a menor, hasta llenar el tope.
 */
export function extracto(texto, clave, tope = 40000, radio = 30) {
  if (texto.length <= tope) return { texto, extractos: false };
  const lineas = texto.split("\n");
  const palabras = [...palabrasDeContenido(clave.dato ?? "")];
  const patrones = [...(clave.aceptadas ?? []), ...(clave.requeridas ?? []).flat()].map(compilarPatron);
  const puntaje = lineas.map((l) => {
    const n = normalizar(l);
    return palabras.filter((w) => n.includes(w)).length + 3 * patrones.filter((p) => p.buscar(n).length).length;
  });
  const orden = puntaje.map((p, i) => [p, i]).filter(([p]) => p > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const elegidas = new Set();
  let largo = 0;
  for (const [, i] of orden) {
    const tramo = [];
    for (let k = Math.max(0, i - radio); k <= Math.min(lineas.length - 1, i + radio); k++) if (!elegidas.has(k)) tramo.push(k);
    const extra = tramo.reduce((s, k) => s + lineas[k].length + 1, 0);
    if (largo + extra > tope) break;
    tramo.forEach((k) => elegidas.add(k));
    largo += extra;
  }
  const idx = [...elegidas].sort((a, b) => a - b);
  let out = "";
  let prev = -2;
  for (const k of idx) {
    if (k !== prev + 1) out += `\n[… líneas omitidas; sigue en la línea ${k + 1} …]\n`;
    out += lineas[k] + "\n";
    prev = k;
  }
  return { texto: out || texto.slice(0, tope), extractos: true };
}

export function promptCitas(clave, titulo, nota) {
  const partes = [
    `PREGUNTA:\n${clave.pregunta}`,
    `DATO DE LA CLAVE:\n${clave.dato}`,
    `NOTA «${titulo}»${nota.extractos ? " (en extractos: es muy larga)" : ""}:\n<<<\n${nota.texto}\n>>>`,
  ];
  return partes.join("\n\n");
}

/** La fila corregida: el acierto citado se recupera por la nota que sostiene el dato. */
export function filaConCitaRevisada(f, titulo, motivo) {
  return {
    ...f,
    citas_exhaustividad: 1,
    acierto_citado: 1,
    citas_revisadas: [{ nota: titulo, veredicto: "sostiene", motivo, version: VERSION_CITAS }],
  };
}
