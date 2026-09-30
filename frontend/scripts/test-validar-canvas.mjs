// Test headless del validador de lienzos (`FUN-L-26`, parte B): los fixtures
// buenos —uno por receta de la skill `mycelium-canvas`— pasan sin errores NI
// avisos, y cada fixture malo falla por el motivo que lo hace malo.
//
// Además compara la geometría copiada en el validador con la de `lib/canvas.ts`,
// que es la que dibuja Mycelium: si una cambia y la otra no, este test lo dice.
//
//   node --test scripts/test-validar-canvas.mjs
//   node scripts/test-validar-canvas.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  altoNecesario,
  anclaDe,
  controlesArista,
  ladosAutomaticos,
  validarCanvas,
} from "./validar-canvas.mjs";

const DIR = fileURLToPath(new URL("./fixtures/ia/canvas/", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./validar-canvas.mjs", import.meta.url));

const validar = (nombre) =>
  validarCanvas(readFileSync(`${DIR}${nombre}`, "utf8"), { vault: DIR });
const codigos = (lista) => [...new Set(lista.map((x) => x.codigo))].sort();

// ── Buenos ────────────────────────────────────────────────────────────────────

const buenos = readdirSync(DIR).filter((f) => f.startsWith("bueno-") && f.endsWith(".canvas"));

test("hay un fixture bueno por receta", () => {
  assert.deepEqual(buenos.sort(), [
    "bueno-arbol.canvas",
    "bueno-linea-de-tiempo.canvas",
    "bueno-mapa-radial.canvas",
    "bueno-notas-relacionadas.canvas",
    "bueno-tablero-columnas.canvas",
  ]);
});

for (const f of buenos) {
  test(`${f}: sin errores ni avisos`, () => {
    const { errores, avisos } = validar(f);
    assert.deepEqual(errores, []);
    assert.deepEqual(avisos, []);
  });
}

// ── Malos: cada uno por su motivo ─────────────────────────────────────────────

const MALOS = {
  "mal-superposicion.canvas": { errores: ["SUPERPOSICION"], avisos: [] },
  "mal-aristas.canvas": {
    errores: ["ARISTA_SIN_NODO", "ID_DUPLICADO", "LADO_INVALIDO", "PUNTA_INVALIDA"],
    avisos: ["ARISTA_DUPLICADA"],
  },
  "mal-grupos.canvas": { errores: ["GRUPO_PARCIAL", "GRUPO_TAPA_NODOS"], avisos: [] },
  "mal-texto.canvas": { errores: ["TEXTO_NO_CABE"], avisos: [] },
  "mal-archivos.canvas": {
    errores: ["ARCHIVO_NO_DIBUJABLE", "ARCHIVO_NO_EXISTE", "RUTA_INVALIDA"],
    avisos: [],
  },
  "mal-json.canvas": { errores: ["JSON_INVALIDO"], avisos: [] },
  // Solo avisos: el archivo es válido, pero se ve mal.
  "mal-lados.canvas": {
    errores: [],
    avisos: ["ARISTA_CRUZA_NODO", "ETIQUETA_ARISTA_NO_DIBUJADA", "FUERA_DE_VISTA", "LADO_OPUESTO"],
  },
};

for (const [f, esperado] of Object.entries(MALOS)) {
  test(`${f}: falla por ${[...esperado.errores, ...esperado.avisos].join(", ")}`, () => {
    const { errores, avisos } = validar(f);
    assert.deepEqual(codigos(errores), esperado.errores.sort());
    assert.deepEqual(codigos(avisos), esperado.avisos.sort());
  });
}

test("mal-archivos: la ruta con otras mayúsculas se reporta como tal", () => {
  const { errores } = validar("mal-archivos.canvas");
  assert.ok(errores.some((e) => e.mensaje.includes("OTRAS mayúsculas") && e.mensaje.includes("notas/glosario.md")));
});

test("sin --vault no se comprueba la existencia de las notas", () => {
  const { errores } = validarCanvas(readFileSync(`${DIR}mal-archivos.canvas`, "utf8"));
  assert.deepEqual(codigos(errores), ["ARCHIVO_NO_DIBUJABLE", "RUTA_INVALIDA"]);
});

// ── Casos puntuales ───────────────────────────────────────────────────────────

const canvas = (nodes, edges = [], extra = {}) => JSON.stringify({ nodes, edges, ...extra });
const t = (id, x, y, w = 260, h = 110, text = "Hola") => ({ id, type: "text", text, x, y, width: w, height: h });

test("un grupo anidado dentro de otro, con los grupos primero, es válido", () => {
  const r = validarCanvas(
    canvas([
      { id: "g", type: "group", label: "Afuera", x: 0, y: 0, width: 700, height: 400 },
      { id: "h", type: "group", label: "Adentro", x: 20, y: 44, width: 340, height: 200 },
      t("a", 40, 90),
      t("b", 400, 90),
    ]),
  );
  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.avisos, []);
});

test("claves desconocidas en la raíz y en los nodos: la raíz avisa, el nodo no", () => {
  const r = validarCanvas(
    canvas([{ ...t("a", 0, 0), extensionDeOtraApp: 1 }], [], { metadata: { v: 1 } }),
  );
  assert.deepEqual(r.errores, []);
  assert.deepEqual(codigos(r.avisos), ["CLAVE_RAIZ"]);
});

test("una etiqueta de arista y un color de arista avisan que no se dibujan", () => {
  const r = validarCanvas(
    canvas(
      [t("a", 0, 0), t("b", 400, 0)],
      [{ id: "e", fromNode: "a", toNode: "b", label: "sí", color: "2" }],
    ),
  );
  assert.deepEqual(r.errores, []);
  assert.deepEqual(codigos(r.avisos), ["COLOR_ARISTA_NO_DIBUJADO", "ETIQUETA_ARISTA_NO_DIBUJADA"]);
});

test("tipo inventado, color inválido y geometría faltante son errores", () => {
  const r = validarCanvas(
    canvas([{ id: "x", type: "sticky", x: 0, y: 0, width: 200 }, { ...t("y", 400, 0), color: "rojo" }]),
  );
  assert.deepEqual(codigos(r.errores), ["COLOR_INVALIDO", "GEOMETRIA_INVALIDA", "TIPO_INVALIDO"]);
});

test("flecha a sí mismo es error; flecha demasiado corta, aviso", () => {
  const r = validarCanvas(
    canvas([t("a", 0, 0), t("b", 290, 0)], [
      { id: "e1", fromNode: "a", toNode: "a" },
      { id: "e2", fromNode: "a", toNode: "b" },
    ]),
  );
  assert.deepEqual(codigos(r.errores), ["ARISTA_A_SI_MISMO"]);
  assert.deepEqual(codigos(r.avisos), ["FLECHA_CORTA"]);
});

test("altoNecesario: una línea corta entra en los 110 de la regla de la skill; el texto largo pide más al angostar", () => {
  assert.ok(altoNecesario("Una idea", 260) <= 110);
  const largo = "palabra ".repeat(40).trim();
  assert.ok(altoNecesario(largo, 200) > altoNecesario(largo, 400));
});

// ── La geometría es la de Mycelium ────────────────────────────────────────────

test("anclas, lados automáticos y trazo coinciden con lib/canvas.ts", async (t) => {
  // `typescript` está en las dependencias del frontend; sin `npm ci` no hay con qué
  // transpilar, y el resto del test no lo necesita.
  let ts;
  try {
    ts = (await import("typescript")).default;
  } catch {
    t.skip("sin node_modules: no se puede transpilar lib/canvas.ts");
    return;
  }
  const rutaTs = fileURLToPath(new URL("../lib/canvas.ts", import.meta.url));
  const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  const lib = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
  const aNodo = (n) => ({ ...lib.nodoTexto(n.id, n.x, n.y), ancho: n.width, alto: n.height });

  let semilla = 7;
  const azar = () => {
    semilla = (semilla * 16807) % 2147483647;
    return semilla / 2147483647;
  };
  for (let i = 0; i < 200; i++) {
    const a = { id: "a", x: Math.round(azar() * 2000 - 1000), y: Math.round(azar() * 2000 - 1000), width: 120 + Math.round(azar() * 300), height: 60 + Math.round(azar() * 300) };
    const b = { id: "b", x: Math.round(azar() * 2000 - 1000), y: Math.round(azar() * 2000 - 1000), width: 120 + Math.round(azar() * 300), height: 60 + Math.round(azar() * 300) };
    const auto = ladosAutomaticos(a, b);
    assert.deepEqual(auto, lib.ladosAutomaticos(aNodo(a), aNodo(b)));
    for (const lado of ["top", "right", "bottom", "left"]) {
      assert.deepEqual(anclaDe(a, lado), lib.anclaDe(aNodo(a), lado));
    }
    const [p1, c1, c2, p2] = controlesArista(a, auto.desde, b, auto.hasta);
    const d = lib.trazoArista(aNodo(a), auto.desde, aNodo(b), auto.hasta).d;
    assert.equal(d, `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`);
  }
});

// ── Línea de comandos ─────────────────────────────────────────────────────────

test("CLI: exit 0 con los buenos, 1 con un malo, 1 con avisos y --estricto", () => {
  const correr = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  const bien = correr("--estricto", "--vault", DIR, ...buenos.map((f) => `${DIR}${f}`));
  assert.equal(bien.status, 0, bien.stdout);
  const mal = correr("--vault", DIR, `${DIR}mal-superposicion.canvas`);
  assert.equal(mal.status, 1);
  assert.match(mal.stdout, /ERROR \[SUPERPOSICION\]/);
  assert.equal(correr(`${DIR}mal-lados.canvas`).status, 0);
  assert.equal(correr("--estricto", `${DIR}mal-lados.canvas`).status, 1);
  assert.equal(correr().status, 2);
});
