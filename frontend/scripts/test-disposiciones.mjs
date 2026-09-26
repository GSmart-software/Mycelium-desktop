// Test headless (sin navegador ni Tauri) de las disposiciones del grafo
// (`FUN-L-23`). El módulo bajo prueba (`components/graph/disposiciones.ts`) es
// puro —sin imports—, así que se transpila en el momento con el compilador de
// TypeScript (devDep ya instalada) y se importa vía data: URL, igual que
// `scripts/test-esporas.mjs`. No hace falta framework de test ni build previo.
//
// Lo que NO se prueba acá, porque necesita la app: que el menú muestre la
// sección «Disposición», que la preferencia persista en
// `.mycelium/preferencias.json` (pasa por el IPC de Tauri) y el dibujo en sí.
// Eso lo confirma el usuario en la app.
//
//   node --test scripts/test-disposiciones.mjs
//   node scripts/test-disposiciones.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../components/graph/disposiciones.ts", import.meta.url));
const fuente = await readFile(rutaTs, "utf8");
const { outputText } = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const D = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

// ── Un vault de juguete ───────────────────────────────────────────────────────

/** Nota con valores por defecto razonables. */
const nota = (id, extra = {}) => ({
  id,
  titulo: `Nota ${id}`,
  conexiones: 0,
  creadoEn: `2026-01-${String(Number(id.replace(/\D/g, "")) % 28 || 1).padStart(2, "0")}T10:00:00Z`,
  ...extra,
});

/**
 * Un vault determinista: `n` notas repartidas en carpetas, cada una enlaza a
 * una o dos anteriores. Sirve para el anillo, el crecimiento y el sustrato.
 */
function vault(n, carpetas = ["Proyectos", "Personas/Equipo", "", "Ideas"]) {
  const nodos = [];
  const aristas = [];
  for (let i = 0; i < n; i++) {
    const carpeta = carpetas[i % carpetas.length];
    nodos.push(
      nota(`n${i}`, {
        carpeta,
        creadoEn: new Date(Date.UTC(2025, 0, 1) + i * 3_600_000).toISOString(),
      }),
    );
    if (i > 0) aristas.push({ source: `n${i}`, target: `n${Math.floor(i / 2)}` });
    if (i > 3) aristas.push({ source: `n${i}`, target: `n${i - 3}` });
  }
  const grado = new Map();
  for (const a of aristas) {
    grado.set(a.source, (grado.get(a.source) ?? 0) + 1);
    grado.set(a.target, (grado.get(a.target) ?? 0) + 1);
  }
  for (const x of nodos) x.conexiones = grado.get(x.id) ?? 0;
  return { nodos, aristas };
}

const distancia = (pos, a, b) => Math.hypot(pos[a * 2] - pos[b * 2], pos[a * 2 + 1] - pos[b * 2 + 1]);

// ── Índice del grafo ──────────────────────────────────────────────────────────

test("indexarGrafo: las colonias son la carpeta de primer nivel, la raíz se llama «Raíz»", () => {
  const g = D.indexarGrafo(vault(8).nodos, []);
  const nombres = g.colonias.map((c) => c.nombre).sort();
  assert.deepEqual(nombres, ["Ideas", "Personas", "Proyectos", D.COLONIA_RAIZ]);
  // Lo que sigue a la colonia queda como subcarpeta (para ordenar el anillo).
  const i = g.ids.indexOf("n1");
  assert.equal(g.colonias[g.colonia[i]].nombre, "Personas");
  assert.equal(g.subcarpeta[i], "Equipo");
});

test("indexarGrafo: las colonias se ordenan por tamaño y reciben los matices en ese orden", () => {
  const nodos = [
    ...Array.from({ length: 5 }, (_, i) => nota(`a${i}`, { carpeta: "Chica" })),
    ...Array.from({ length: 9 }, (_, i) => nota(`b${i}`, { carpeta: "Grande" })),
    nota("r0"),
  ];
  const g = D.indexarGrafo(nodos, []);
  assert.deepEqual(
    g.colonias.map((c) => [c.nombre, c.tamano, c.matiz]),
    [
      ["Grande", 9, D.MATICES_COLONIA[0]],
      ["Chica", 5, D.MATICES_COLONIA[1]],
      [D.COLONIA_RAIZ, 1, D.MATICES_COLONIA[2]],
    ],
  );
});

test("indexarGrafo: el orden de creación va por fecha, las sin fecha al final y desempata por id", () => {
  const nodos = [
    nota("c", { creadoEn: "2026-03-01T00:00:00Z" }),
    nota("z", { creadoEn: undefined }),
    nota("a", { creadoEn: "2026-01-01T00:00:00Z" }),
    nota("b", { creadoEn: "2026-01-01T00:00:00Z" }),
    nota("y", { creadoEn: undefined }),
  ];
  const g = D.indexarGrafo(nodos, []);
  assert.deepEqual(Array.from(g.orden).map((i) => g.ids[i]), ["a", "b", "c", "y", "z"]);
  for (let k = 0; k < g.n; k++) assert.equal(g.rango[g.orden[k]], k);
});

test("indexarGrafo: las aristas que apuntan a nodos ausentes (excluidos) se descartan", () => {
  const g = D.indexarGrafo([nota("a"), nota("b")], [
    { source: "a", target: "b" },
    { source: "a", target: "fantasma" },
  ]);
  assert.equal(g.aristas.length, 1);
  assert.deepEqual(g.salientes[0], [1]);
  assert.deepEqual(g.entrantes[1], [0]);
});

// ── Anillo de colonias ────────────────────────────────────────────────────────

test("layoutAnillo: todos los nodos sobre la circunferencia y cada colonia en un arco contiguo", () => {
  const { nodos, aristas } = vault(40);
  const g = D.indexarGrafo(nodos, aristas);
  const L = D.layoutAnillo(g);
  assert.equal(L.R, D.RADIO_MINIMO_ANILLO, "con pocas notas rige el radio mínimo");
  for (let i = 0; i < g.n; i++) {
    assert.ok(Math.abs(Math.hypot(L.pos[i * 2], L.pos[i * 2 + 1]) - L.R) < 1e-9);
    const a = L.ang[i];
    const arco = L.arcos.find((x) => x.colonia === g.colonia[i]);
    assert.ok(arco && a >= arco.a0 && a <= arco.a1, `el nodo ${g.ids[i]} cae dentro del arco de su colonia`);
  }
  assert.equal(L.arcos.length, g.colonias.length, "un arco por colonia");
  // Los arcos no se pisan y van en el orden de las colonias.
  for (let k = 1; k < L.arcos.length; k++) assert.ok(L.arcos[k].a0 > L.arcos[k - 1].a1);
});

test("layoutAnillo: el radio crece con N para que los nodos no se pisen", () => {
  const { nodos, aristas } = vault(3000, ["A", "B"]);
  const L = D.layoutAnillo(D.indexarGrafo(nodos, aristas));
  assert.ok(L.R > D.RADIO_MINIMO_ANILLO);
  assert.ok(Math.abs(L.R - (3000 * 2.3) / (2 * Math.PI)) < 1e-9);
});

test("layoutAnillo: sin nodos devuelve un anillo vacío sin romper", () => {
  const L = D.layoutAnillo(D.indexarGrafo([], []));
  assert.equal(L.arcos.length, 0);
  assert.equal(L.R, D.RADIO_MINIMO_ANILLO);
});

// ── Crecimiento ───────────────────────────────────────────────────────────────

test("layoutCrecimiento: es determinista (el mismo vault da el mismo dibujo)", () => {
  const { nodos, aristas } = vault(200);
  const a = D.layoutCrecimiento(D.indexarGrafo(nodos, aristas)).pos;
  const b = D.layoutCrecimiento(D.indexarGrafo(nodos, aristas)).pos;
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("layoutCrecimiento: no depende del orden en que llegan los nodos", () => {
  const { nodos, aristas } = vault(120);
  const g1 = D.layoutCrecimiento(D.indexarGrafo(nodos, aristas));
  const alReves = D.indexarGrafo([...nodos].reverse(), aristas);
  const g2 = D.layoutCrecimiento(alReves);
  const idx = new Map(alReves.ids.map((id, i) => [id, i]));
  nodos.forEach((n, i) => {
    const j = idx.get(n.id);
    assert.ok(Math.abs(g1.pos[i * 2] - g2.pos[j * 2]) < 1e-9 && Math.abs(g1.pos[i * 2 + 1] - g2.pos[j * 2 + 1]) < 1e-9);
  });
});

test("layoutCrecimiento: agregar una nota nueva no mueve a las existentes y la nueva brota junto a la enlazada", () => {
  const { nodos, aristas } = vault(150);
  const antes = D.layoutCrecimiento(D.indexarGrafo(nodos, aristas)).pos;
  // Una nota nueva (posterior a todas) que enlaza a la n10.
  const nueva = nota("nueva", { carpeta: "Proyectos", creadoEn: "2027-01-01T00:00:00Z", conexiones: 1 });
  const g2 = D.indexarGrafo([...nodos, nueva], [...aristas, { source: "nueva", target: "n10" }]);
  const despues = D.layoutCrecimiento(g2).pos;
  for (let i = 0; i < nodos.length; i++) {
    assert.equal(despues[i * 2], antes[i * 2]);
    assert.equal(despues[i * 2 + 1], antes[i * 2 + 1]);
  }
  const iNueva = g2.indice.get("nueva");
  const iVecina = g2.indice.get("n10");
  const d = distancia(despues, iNueva, iVecina);
  // Brota a 26–56 unidades de su vecina; si el sitio está ocupado (este vault
  // de juguete es denso alrededor de `n10`), la espiral la corre hacia afuera
  // en saltos de 12, hasta 40 veces.
  assert.ok(d >= 26 - 1e-9 && d < 56 + 12 * 40, `distancia a la vecina: ${d}`);
});

test("layoutCrecimiento: dos notas nunca quedan a menos de la distancia mínima (salvo agotar los intentos)", () => {
  const { nodos, aristas } = vault(300);
  const g = D.indexarGrafo(nodos, aristas);
  const { pos } = D.layoutCrecimiento(g);
  let muyCerca = 0;
  for (let i = 0; i < g.n; i++) for (let j = i + 1; j < g.n; j++) if (distancia(pos, i, j) < 14) muyCerca++;
  assert.ok(muyCerca <= 3, `pares a menos de 14 unidades: ${muyCerca}`);
});

test("layoutCrecimiento: una nota sin enlaces ni compañeras de carpeta cae en la frontera", () => {
  const g = D.indexarGrafo(
    [nota("a", { carpeta: "X", creadoEn: "2026-01-01T00:00:00Z" }), nota("b", { carpeta: "Y", creadoEn: "2026-01-02T00:00:00Z" })],
    [],
  );
  const { pos } = D.layoutCrecimiento(g);
  // La primera cae en la frontera inicial (30 + 20); la segunda, más afuera.
  assert.ok(Math.abs(Math.hypot(pos[0], pos[1]) - 50) < 1e-9);
  assert.ok(Math.hypot(pos[2], pos[3]) >= 50);
});

// ── Sustrato ──────────────────────────────────────────────────────────────────

test("siembraSustrato: determinista y a 80–460 unidades del centro", () => {
  const { nodos, aristas } = vault(50);
  const g = D.indexarGrafo(nodos, aristas);
  const a = D.siembraSustrato(g);
  const b = D.siembraSustrato(g);
  assert.deepEqual(Array.from(a), Array.from(b));
  for (let i = 0; i < g.n; i++) {
    const r = Math.hypot(a[i * 2], a[i * 2 + 1]);
    assert.ok(r >= 80 && r <= 460);
  }
});

// ── Utilidades ────────────────────────────────────────────────────────────────

test("limitesDe ignora las notas sueltas si hay enlazadas, y no si todas están sueltas", () => {
  const g = D.indexarGrafo([nota("a", { conexiones: 1 }), nota("b", { conexiones: 0 })], []);
  const pos = Float64Array.from([0, 0, 1000, 1000]);
  assert.deepEqual(D.limitesDe(g, pos), { minX: 0, minY: 0, maxX: 0, maxY: 0 });
  const g2 = D.indexarGrafo([nota("a"), nota("b")], []);
  assert.deepEqual(D.limitesDe(g2, pos), { minX: 0, minY: 0, maxX: 1000, maxY: 1000 });
});

test("hubsDe: los más conectados (≥ 12), a lo sumo 24, de mayor a menor", () => {
  const nodos = Array.from({ length: 60 }, (_, i) => nota(`h${i}`, { conexiones: i }));
  const g = D.indexarGrafo(nodos, []);
  const hubs = D.hubsDe(g);
  assert.equal(hubs.length, 24);
  assert.equal(g.conexiones[hubs[0]], 59);
  assert.ok(hubs.every((i) => g.conexiones[i] >= 12));
});

test("tinteColonia y el azar determinista", () => {
  assert.equal(D.tinteColonia(158, 62, 0.5), "hsla(158,34%,62%,0.5)");
  assert.equal(D.mulberry32(7)(), D.mulberry32(7)());
  assert.equal(D.hashCadena("nota"), D.hashCadena("nota"));
  assert.notEqual(D.hashCadena("nota"), D.hashCadena("Nota"));
});

test("rendimiento: con 3.000 notas el anillo y el crecimiento tardan menos de un segundo", () => {
  const { nodos, aristas } = vault(3000, ["A", "B/uno", "C", "", "D", "E/dos"]);
  const t0 = performance.now();
  const g = D.indexarGrafo(nodos, aristas);
  D.layoutAnillo(g);
  D.layoutCrecimiento(g);
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `tardó ${Math.round(ms)} ms`);
});
