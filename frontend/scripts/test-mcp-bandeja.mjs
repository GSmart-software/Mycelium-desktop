// Test headless de `mycelium_bandeja` (`FUN-S-40`): la lógica pura
// (`lib/mcpBandejaLogica.ts`) —numerar las entradas con su día, su hora y su
// texto, con el mismo criterio que el contador del explorador; quitar por
// número sin tocar lo demás, y llevarse el encabezado de un día que queda
// vacío; los textos del efecto y el motivo del Deshacer— y que el registro de
// actividad acepte su Deshacer y el objetivo de la Bandeja personal
// (`lib/actividadIa.ts`). Los módulos se transpilan en el momento, como en
// `scripts/test-mcp-archivos.mjs`.
//
//   node --test scripts/test-mcp-bandeja.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

async function fuente(ruta, mapa = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  for (const [especificador, url] of Object.entries(mapa)) {
    outputText = outputText.split(`"${especificador}"`).join(`"${url}"`);
  }
  return aUrl(outputText);
}

const ESTADOS = await fuente("../lib/estadosTarea.ts");
const BANDEJA = await fuente("../lib/bandeja.ts", { "@/lib/estadosTarea": ESTADOS });
const L = await import(await fuente("../lib/mcpBandejaLogica.ts", { "@/lib/estadosTarea": ESTADOS }));
const bandeja = await import(BANDEJA);
const act = await import(await fuente("../lib/actividadIa.ts"));

const EJEMPLO = [
  "## 2026-11-05",
  "- 09:40 La panadería prefiere hablar por la tarde",
  "- [ ] 10:05 Renovar el dominio antes del 15",
  "",
  "## 2026-11-06",
  "- [x] 08:00 Llamar a Marta",
  "",
].join("\n");

// ── Leer ────────────────────────────────────────────────────────────────────

test("las entradas salen numeradas con día, hora, texto y estado de la tarea", () => {
  const e = L.entradasDeBandeja(EJEMPLO);
  assert.deepEqual(
    e.map(({ numero, dia, hora, texto, tarea, debajo }) => ({ numero, dia, hora, texto, tarea, debajo })),
    [
      { numero: 1, dia: "2026-11-05", hora: "09:40", texto: "La panadería prefiere hablar por la tarde", tarea: null, debajo: 0 },
      { numero: 2, dia: "2026-11-05", hora: "10:05", texto: "Renovar el dominio antes del 15", tarea: "pendiente", debajo: 0 },
      { numero: 3, dia: "2026-11-06", hora: "08:00", texto: "Llamar a Marta", tarea: "hecha", debajo: 0 },
    ],
  );
});

test("lo que escribe la captura se lee como una entrada", () => {
  const ahora = new Date(2026, 10, 12, 14, 5);
  const texto = bandeja.agregarEntrada(EJEMPLO, { tipo: "tarea", texto: "Pagar la luz" }, ahora);
  const ultima = L.entradasDeBandeja(texto).at(-1);
  assert.deepEqual([ultima.dia, ultima.hora, ultima.texto, ultima.tarea], ["2026-11-12", "14:05", "Pagar la luz", "pendiente"]);
});

test("no son entradas: el frontmatter, los bloques de código, las reglas ni los sub-ítems", () => {
  const texto = [
    "---",
    "- no: soy entrada",
    "---",
    "- una",
    "  - hija de una",
    "    sigue la hija",
    "```",
    "- dentro del código",
    "```",
    "* * *",
    "- dos",
  ].join("\n");
  const e = L.entradasDeBandeja(texto);
  assert.deepEqual(e.map((x) => [x.numero, x.texto, x.debajo, x.dia]), [[1, "una", 2, null], [2, "dos", 0, null]]);
});

test("cuenta lo mismo que el contador, más las tareas ya procesadas", () => {
  const sinProcesar = L.entradasDeBandeja(EJEMPLO).filter((x) => x.tarea !== "hecha" && x.tarea !== "cancelada");
  assert.equal(sinProcesar.length, bandeja.contarEntradas(EJEMPLO));
});

// ── Quitar ──────────────────────────────────────────────────────────────────

test("quitar una entrada deja lo demás tal cual", () => {
  const r = L.quitarEntradas(EJEMPLO, [1]);
  assert.equal(r.ok, true);
  assert.equal(
    r.contenido,
    ["## 2026-11-05", "- [ ] 10:05 Renovar el dominio antes del 15", "", "## 2026-11-06", "- [x] 08:00 Llamar a Marta", ""].join("\n"),
  );
  assert.deepEqual(r.diasQuitados, []);
  assert.deepEqual(r.quitadas.map((x) => x.numero), [1]);
});

test("si un día queda vacío se va su encabezado (también el último)", () => {
  let r = L.quitarEntradas(EJEMPLO, [1, 2]);
  assert.equal(r.contenido, "## 2026-11-06\n- [x] 08:00 Llamar a Marta\n");
  assert.deepEqual(r.diasQuitados, ["2026-11-05"]);
  r = L.quitarEntradas(EJEMPLO, [3]);
  assert.equal(r.contenido, "## 2026-11-05\n- 09:40 La panadería prefiere hablar por la tarde\n- [ ] 10:05 Renovar el dominio antes del 15\n");
  assert.deepEqual(r.diasQuitados, ["2026-11-06"]);
  r = L.quitarEntradas(EJEMPLO, [1, 2, 3]);
  assert.equal(r.contenido, "");
});

test("un encabezado que ya estaba vacío, o con texto propio, no se toca", () => {
  const texto = "## Ideas\n\n## 2026-11-05\nUna nota suelta\n- 09:40 algo\n";
  const r = L.quitarEntradas(texto, [1]);
  assert.equal(r.contenido, "## Ideas\n\n## 2026-11-05\nUna nota suelta\n");
  assert.deepEqual(r.diasQuitados, []);
});

test("una entrada se va con sus sub-ítems; respeta CRLF", () => {
  const texto = "## 2026-11-05\r\n- una\r\n  - hija\r\n- dos\r\n";
  const r = L.quitarEntradas(texto, [1]);
  assert.equal(r.contenido, "## 2026-11-05\r\n- dos\r\n");
});

test("un número que no es una entrada no quita nada", () => {
  const r = L.quitarEntradas(EJEMPLO, [2, 7, 9]);
  assert.deepEqual(r, { ok: false, fuera: [7, 9], total: 3 });
});

test("el efecto dice qué se quitó y qué días se fueron", () => {
  const r = L.quitarEntradas(EJEMPLO, [1, 2]);
  assert.equal(
    L.efectoQuitar("personal", r.quitadas, r.diasQuitados),
    "Quité 2 entradas de la Bandeja personal: «La panadería prefiere hablar por la tarde», «Renovar el dominio antes del 15». " +
      "El día 2026-11-05 quedó vacío y se fue su encabezado.",
  );
});

// ── Deshacer y el registro ──────────────────────────────────────────────────

const DESHACER = { tipo: "bandeja_reponer", bandeja: "vault", ruta: "Bandeja.md", antes: EJEMPLO, huella: "h2", cuantas: 2 };

test("deshacer solo si la bandeja sigue como la dejó la IA", () => {
  assert.equal(L.motivoSinDeshacerBandeja(DESHACER, "h2"), null);
  assert.match(L.motivoSinDeshacerBandeja(DESHACER, "otra"), /^La Bandeja del vault cambió después/);
  assert.match(L.motivoSinDeshacerBandeja({ ...DESHACER, bandeja: "personal" }, null), /^La Bandeja personal ya no existe/);
  assert.equal(L.describirDeshacerBandeja(DESHACER), "Volver a poner las 2 entradas quitadas en la Bandeja del vault");
});

test("el registro de actividad lee el Deshacer y el objetivo de la Bandeja personal", () => {
  const renglon = JSON.stringify({
    v: 1, id: "a", momento: "2026-11-12T10:00:00.000Z", op: "bandeja", resultado: "hecho", efecto: "Quité…",
    objetivo: { tipo: "bandeja_personal" }, deshacer: DESHACER,
  });
  const e = act.leerRenglon(renglon);
  assert.deepEqual(e.objetivo, { tipo: "bandeja_personal" });
  assert.deepEqual(e.deshacer, DESHACER);
  assert.equal(act.NOMBRE_OP.bandeja, "Bandeja");
  assert.equal(act.seRegistra("bandeja", "hecho"), true);
  assert.equal(act.seRegistra("dividir", "hecho"), false);
});
