// Test de la geometría de las gráficas de la salud del vault (`FUN-L-32`,
// parte C): `lib/graficas.ts` es puro y se transpila sin build. Escalas,
// tramos de las barras (sin ceros, con separación, con mínimo), sectores de
// los anillos (sin ceros, que sumen la vuelta), los `d` de barras y arcos, la
// lista de composición, las carpetas con resto y los textos.
//
//   node --test scripts/test-graficas.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const ESTADISTICAS = await fuente("../lib/estadisticas.ts");
const PALETA = await fuente("../lib/paletaGraficas.ts");
const INFORME = await fuente("../lib/informeSalud.ts", { "@/lib/estadisticas": ESTADISTICAS, "@/lib/paletaGraficas": PALETA });
const G = await import(await fuente("../lib/graficas.ts", { "@/lib/estadisticas": ESTADISTICAS, "@/lib/informeSalud": INFORME }));
const E = await import(ESTADISTICAS);

const MB = 1024 * 1024;
const cerca = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("escala: tope redondo, tres marcas, y lo que pasa del tope no se sale", () => {
  const e = G.escala(392, 130);
  assert.equal(e.tope, 500);
  assert.deepEqual(e.marcas, [0, 250, 500]);
  assert.equal(e.px(500), 130);
  assert.equal(e.px(250), 65);
  assert.equal(e.px(0), 0);
  assert.equal(e.px(-3), 0);
  assert.equal(e.px(9999), 130);
  // Sin datos: tope 1, todo en 0.
  const vacia = G.escala(0, 100);
  assert.equal(vacia.tope, 1);
  assert.equal(vacia.px(0), 0);
});

test("tramos: sin ceros, separados 2 px, y llenan el largo", () => {
  const t = G.tramos(
    [
      { clave: "a", valor: 50 },
      { clave: "b", valor: 0 },
      { clave: "c", valor: 30 },
      { clave: "d", valor: 20 },
    ],
    204,
  );
  assert.deepEqual(t.map((x) => x.clave), ["a", "c", "d"], "el cero no aparece");
  assert.equal(t[0].x, 0);
  for (let i = 1; i < t.length; i++) assert.ok(cerca(t[i].x, t[i - 1].x + t[i - 1].w + 2), "2 px entre tramos");
  const fin = t.at(-1).x + t.at(-1).w;
  assert.ok(cerca(fin, 204), `llena el largo (${fin})`);
  assert.ok(cerca(t[0].w, 100) && cerca(t[1].w, 60) && cerca(t[2].w, 40));
});

test("tramos: lo que casi no hay se ve igual (mínimo), sin pasarse del largo", () => {
  const t = G.tramos(
    [
      { clave: "grande", valor: 10_000 },
      { clave: "nada", valor: 1 },
    ],
    100,
  );
  assert.equal(t.length, 2);
  assert.ok(t[1].w >= 1.5);
  assert.ok(t.at(-1).x + t.at(-1).w <= 100 + 1e-6);
});

test("tramos: con escala de otro total la barra no llena el largo (carpetas)", () => {
  const t = G.tramos([{ clave: "a", valor: 25 }, { clave: "b", valor: 25 }], 102, { escalaDe: 100 });
  const fin = t.at(-1).x + t.at(-1).w;
  assert.ok(cerca(fin, 51), `la mitad del largo (${fin})`);
  assert.deepEqual(G.tramos([], 100), []);
  assert.deepEqual(G.tramos([{ clave: "x", valor: 0 }], 100), []);
});

test("sectores: sin ceros, en orden, con separación, y cubren la vuelta", () => {
  const s = G.sectores(
    [
      { clave: "notas", valor: 1 },
      { clave: "pdf", valor: 0 },
      { clave: "imagenes", valor: 3 },
    ],
    100,
  );
  assert.deepEqual(s.map((x) => x.clave), ["notas", "imagenes"]);
  const medio = 2 / 100 / 2;
  assert.ok(cerca(s[0].a0, medio));
  assert.ok(cerca(s[0].a1, Math.PI / 2 - medio));
  assert.ok(cerca(s[1].a0, Math.PI / 2 + medio));
  assert.ok(cerca(s[1].a1, 2 * Math.PI - medio));
});

test("sectores: uno solo es la vuelta entera; vacío no da nada; uno diminuto queda visible", () => {
  const uno = G.sectores([{ clave: "notas", valor: 7 }, { clave: "otros", valor: 0 }], 100);
  assert.equal(uno.length, 1);
  assert.equal(uno[0].a0, 0);
  assert.ok(cerca(uno[0].a1, 2 * Math.PI));
  assert.deepEqual(G.sectores([{ clave: "x", valor: 0 }], 100), []);
  const chico = G.sectores([{ clave: "a", valor: 1_000_000 }, { clave: "b", valor: 1 }], 100);
  assert.ok(chico[1].a1 - chico[1].a0 >= 0.004 - 1e-9);
});

test("arcoAnillo: un sector es un camino cerrado; la vuelta entera, dos medias vueltas con agujero", () => {
  const d = G.arcoAnillo(100, 100, 50, 80, 0, Math.PI / 2);
  assert.match(d, /^M100,20A80,80 0 0 1 180,100L150,100A50,50 0 0 0 100,50Z$/);
  const grande = G.arcoAnillo(100, 100, 50, 80, 0, Math.PI * 1.5);
  assert.match(grande, /A80,80 0 1 1/, "arco grande");
  const entera = G.arcoAnillo(100, 100, 50, 80, 0, 2 * Math.PI);
  assert.equal((entera.match(/A80,80/g) ?? []).length, 2);
  assert.equal((entera.match(/A50,50 0 1 0/g) ?? []).length, 2, "el agujero va al revés");
  assert.equal(G.arcoAnillo(100, 100, 50, 80, 1, 1), "");
});

test("barras: el extremo del dato redondeado a 4 px, recortado si la barra es chica", () => {
  assert.equal(G.barraHorizontal(10, 0, 100, 18), "M10,0H106Q110,0 110,4V14Q110,18 106,18H10Z");
  assert.equal(G.barraVertical(0, 10, 20, 50), "M0,60V14Q0,10 4,10H16Q20,10 20,14V60Z");
  // 2 px de ancho: radio 1.
  assert.match(G.barraHorizontal(0, 0, 2, 18), /Q2,0 2,1/);
  assert.equal(G.barraHorizontal(0, 0, 0, 18), "");
  assert.equal(G.barraVertical(0, 0, 10, 0), "");
});

test("rotuloExterior: a la derecha empieza, a la izquierda termina, arriba va centrado", () => {
  assert.equal(G.rotuloExterior(0, 0, 100, { a0: Math.PI / 2 - 0.1, a1: Math.PI / 2 + 0.1 }).ancla, "start");
  assert.equal(G.rotuloExterior(0, 0, 100, { a0: 1.5 * Math.PI - 0.1, a1: 1.5 * Math.PI + 0.1 }).ancla, "end");
  assert.equal(G.rotuloExterior(0, 0, 100, { a0: -0.1, a1: 0.1 }).ancla, "middle");
  assert.equal(G.acortar("Notas de campo largas", 10), "Notas de…");
  assert.equal(G.acortar("Corta", 10), "Corta");
});

function composicion() {
  return E.calcularComposicion([
    { ruta: "a.md", bytes: 2 * 1024 },
    { ruta: "Capítulos/b.md", bytes: 3 * 1024 },
    { ruta: "Adjuntos/x.png", bytes: 5 * MB },
    { ruta: "Adjuntos/y.jpg", bytes: 1 * MB },
    { ruta: "Dibujos/d.excalidraw", bytes: 40 * 1024 },
    { ruta: "Dibujos/l.canvas", bytes: 2 * 1024 },
    { ruta: "datos.csv", bytes: 900 },
    { ruta: "LICENSE", bytes: 100 },
  ]);
}

test("filasComposicion: los cinco grupos en orden, con los tipos que hay y porcentajes que cierran", () => {
  const a = composicion();
  const filas = G.filasComposicion(a, "bytes");
  assert.deepEqual(filas.map((f) => f.grupo), ["notas", "imagenes", "pdf", "visuales", "otros"]);
  assert.equal(filas[0].detalle, ".md");
  assert.equal(filas[1].detalle, ".png .jpg");
  assert.equal(filas[2].valor, 0);
  assert.equal(filas[2].detalle, "ninguno");
  assert.equal(filas[2].porcentaje, "0 %");
  assert.equal(filas[3].detalle, "dibujos, lienzos");
  assert.equal(filas[4].detalle, ".csv sin extensión");
  assert.equal(filas.reduce((s, f) => s + f.valor, 0), a.total.bytes, "la suma es el total");
  const porCantidad = G.filasComposicion(a, "cantidad");
  assert.equal(porCantidad.reduce((s, f) => s + f.valor, 0), 8);
  assert.equal(porCantidad[0].texto, "2");
});

test("tiposOrdenados: sin los tipos con cero, de mayor a menor según la medida", () => {
  const a = composicion();
  const porPeso = G.tiposOrdenados(a, "bytes").map((t) => t.extension);
  assert.equal(porPeso[0], "png");
  assert.ok(!porPeso.includes("pdf"), "pdf tiene 0 archivos");
  assert.ok(!porPeso.includes("base"));
  const porCantidad = G.tiposOrdenados(a, "cantidad");
  assert.equal(porCantidad[0].extension, "md");
  assert.equal(G.nombreDeExtension(""), "Otros");
  assert.equal(G.rotuloExtension(""), "sin extensión");
  assert.equal(G.rotuloExtension("png"), ".png");
});

test("carpetasConResto: con más carpetas que el tope, el resto se suma en la última fila", () => {
  const archivos = Array.from({ length: 12 }, (_, i) => ({ ruta: `C${i}/n.md`, bytes: (12 - i) * 1000 }));
  const a = E.calcularComposicion(archivos);
  const filas = G.carpetasConResto(a.carpetas, 8);
  assert.equal(filas.length, 8);
  assert.equal(filas.at(-1).resto, true);
  assert.equal(filas.at(-1).carpeta, "Otras 5 carpetas");
  assert.equal(filas.reduce((s, c) => s + c.bytes, 0), a.total.bytes, "las filas suman lo mismo que las carpetas");
  assert.equal(filas.reduce((s, c) => s + c.cantidad, 0), 12);
  assert.equal(filas.at(-1).porGrupo.notas.cantidad, 5);
  assert.equal(G.carpetasConResto(a.carpetas.slice(0, 3), 8).length, 3);
});

test("textos: meses, cuándo se revisó y cuánto tardó", () => {
  assert.equal(G.mesCorto("2026-03"), "mar");
  assert.equal(G.mesLargo("2026-11"), "noviembre de 2026");
  const ahora = new Date(2026, 10, 2, 15, 0);
  assert.equal(G.cuandoSeReviso(new Date(2026, 10, 2, 14, 5).toISOString(), ahora), "a las 14:05");
  assert.equal(G.cuandoSeReviso(new Date(2026, 10, 1, 9, 7).toISOString(), ahora), "ayer a las 9:07");
  assert.equal(G.cuandoSeReviso(new Date(2026, 9, 20, 9, 7).toISOString(), ahora), "el 20 de octubre a las 9:07");
  assert.equal(G.cuandoSeReviso("no es una fecha", ahora), "");
  assert.equal(G.duracionLegible(420), "420 ms");
  assert.equal(G.duracionLegible(1400), "1,4 s");
  assert.equal(G.duracionLegible(12_300), "12 s");
  assert.equal(G.textoDe(1642, "cantidad"), "1.642");
  assert.equal(G.textoDe(312 * MB, "bytes"), "312 MB");
  assert.equal(G.plural(1, "nota", "notas"), "1 nota");
  assert.equal(G.formaValida("barras"), "barras");
  assert.equal(G.formaValida("torta"), "anillos");
  assert.equal(G.formaValida(undefined), "anillos");
});
