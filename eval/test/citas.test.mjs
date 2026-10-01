import { test } from "node:test";
import assert from "node:assert/strict";
import { extracto, filaConCitaRevisada, notasARevisar, pendientesDeCitas, promptCitas } from "../lib/citas.mjs";

const CLAVE = {
  id: "P1",
  clase: "C3",
  veredicto: "dato",
  pregunta: "¿Cuánto se proyectó?",
  dato: "Más de un billón, rebajado a 877 mil millones.",
  aceptadas: ["877"],
  notas_clave: [["Sintesis", "Informe"]],
};
const C4 = { ...CLAVE, id: "P2", clase: "C4", notas_clave: [["A"], ["B"]] };
const AUS = { ...CLAVE, id: "P3", clase: "C5", veredicto: "ausencia", notas_clave: [] };
const fila = (o) => ({ pregunta: "P1", brazo: "mcp", acierto: 1, acierto_citado: 0, citas: ["Cruda"], descartada: false, ...o });

test("se revisan solo las que aciertan sin cita válida, con un grupo de notas clave", () => {
  const claves = { P1: CLAVE, P2: C4, P3: AUS };
  const filas = [
    fila({}),
    fila({ acierto: 0 }), // no acierta: no hay nada que rescatar
    fila({ acierto_citado: 1 }), // ya tiene la cita
    fila({ descartada: true }),
    fila({ citas: [] }),
    fila({ pregunta: "P2" }), // C4: varios grupos, fuera
    fila({ pregunta: "P3" }), // ausencia: no se cita nada
    fila({ pregunta: "P9" }), // sin clave legible
  ];
  assert.deepEqual(pendientesDeCitas(filas, claves), [filas[0]]);
});

test("las selladas no se revisan sin abrir la reserva", () => {
  assert.deepEqual(pendientesDeCitas([fila({})], { P1: { ...CLAVE, sellada: true } }), []);
});

test("notas a revisar: existen, no son de la clave, sin repetir y en orden", () => {
  const titulos = new Set(["Sintesis", "Cruda", "Ficha"]);
  const f = fila({ citas: ["[[Cruda]]", "Sintesis", "Inventada", "Ficha", "Cruda#s2"] });
  assert.deepEqual(notasARevisar(f, CLAVE, titulos), ["Cruda", "Ficha"]);
});

test("el extracto de una nota larga trae los tramos con el dato", () => {
  const relleno = Array.from({ length: 400 }, (_, i) => `línea de relleno número ${i} sin nada`);
  relleno[300] = "la consultora la rebajó a 877 mil millones en agosto";
  const texto = relleno.join("\n");
  const corto = extracto("nota corta", CLAVE, 1000);
  assert.deepEqual(corto, { texto: "nota corta", extractos: false });
  const e = extracto(texto, CLAVE, 2000, 5);
  assert.equal(e.extractos, true);
  assert.ok(e.texto.includes("877 mil millones"), e.texto);
  assert.ok(e.texto.length <= 2000 + 200);
  assert.ok(e.texto.includes("líneas omitidas"));
});

test("el prompt no lleva la respuesta ni el brazo; la fila rescatada recupera el acierto citado", () => {
  const p = promptCitas(CLAVE, "Cruda", { texto: "texto de la nota", extractos: false });
  assert.ok(p.includes(CLAVE.pregunta) && p.includes(CLAVE.dato) && p.includes("texto de la nota"));
  assert.ok(!/mcp|base|brazo|respuesta a evaluar/i.test(p), p);
  const r = filaConCitaRevisada(fila({ citas_exhaustividad: 0 }), "Cruda", "trae la cifra");
  assert.equal(r.acierto_citado, 1);
  assert.equal(r.citas_exhaustividad, 1);
  assert.equal(r.citas_revisadas[0].nota, "Cruda");
});
