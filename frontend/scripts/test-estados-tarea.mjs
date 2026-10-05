// Test headless de los estados de tarea (`FUN-S-01`): la lógica pura
// (`lib/estadosTarea.ts`), el parser de la vista en vivo (`lib/editor/tareas.ts`,
// sobre `@lezer/markdown`) y el HTML REAL de la vista de lectura
// (`lib/markdown.ts`).
//
// Las dos vistas tienen que reconocer las MISMAS tareas: si una línea es tarea
// en vivo y texto al leer, la casilla aparece y desaparece al cambiar de vista.
// Por eso se prueban juntas, con los mismos casos.
//
// Mismo arnés que `scripts/test-embeds.mjs`: los módulos se transpilan a una
// carpeta temporal DENTRO de `frontend/` para que resuelvan `node_modules`.
//
//   node --test scripts/test-estados-tarea.mjs
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(AQUI, "..");
const TMP = join(FRONTEND, ".tmp-test-estados-tarea");

const MODULOS = [
  "lib/estadosTarea.ts",
  "lib/editor/tareas.ts",
  "lib/markdown.ts",
  "lib/frontmatter.ts",
  "lib/wikilinks.ts",
  "lib/drawio.ts",
  "lib/extensionesDeTipo.ts",
  "lib/editor/wikilink.ts",
  "lib/video.ts",
  "lib/imagenes.ts",
];

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
await writeFile(
  join(TMP, "vaultStore.mjs"),
  "export const useVaultStore = { getState: () => ({ notas: [], carpetas: [] }) };\n",
);
for (const rel of MODULOS) {
  const fuente = await readFile(join(FRONTEND, rel), "utf8");
  const { outputText } = ts.transpileModule(fuente, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const js = outputText
    .replace(/(["'])@\/lib\/(?:[A-Za-z0-9_-]+\/)*([A-Za-z0-9_-]+)\1/g, '"./$2.mjs"')
    .replace(/(["'])@\/stores\/([A-Za-z0-9_-]+)\1/g, '"./$2.mjs"');
  await writeFile(join(TMP, `${rel.split("/").pop().replace(/\.ts$/, "")}.mjs`), js);
}

const cargar = (nombre) => import(pathToFileURL(join(TMP, `${nombre}.mjs`)).href);
const est = await cargar("estadosTarea");
const { GFM_MYCELIUM } = await cargar("tareas");
const { renderNota } = await cargar("markdown");
const { parser } = await import("@lezer/markdown");
const parserVivo = parser.configure(GFM_MYCELIUM);

after(async () => {
  await rm(TMP, { recursive: true, force: true });
});

/** Las tareas que ve la vista en vivo: `[desde, símbolo]` de cada `TaskMarker`. */
function tareasEnVivo(texto) {
  const salida = [];
  parserVivo.parse(texto).iterate({
    enter(n) {
      if (n.name === "TaskMarker") salida.push([n.from, texto[n.from + 1]]);
    },
  });
  return salida;
}

/** Las casillas de la vista de lectura: `[data-task-pos, data-task, data-estado]`. */
function casillasEnLectura(texto) {
  const html = renderNota(texto);
  // Los valores van entre comillas y pueden traer un `>` (el de pospuesta).
  return [...html.matchAll(/<input (?:[^>"]|"[^"]*")*>/g)].map((m) => {
    const a = (n) => m[0].match(new RegExp(`${n}="([^"]*)"`))?.[1];
    return [Number(a("data-task-pos")), a("data-task"), a("data-estado")];
  });
}

// ── Lógica pura ─────────────────────────────────────────────────────────────

test("cada símbolo da su estado; X mayúscula es hecha; uno desconocido se ve como hecha", () => {
  const casos = {
    " ": "pendiente",
    x: "hecha",
    X: "hecha",
    "-": "cancelada",
    "*": "destacada",
    "+": "agregada",
    "/": "en-curso",
    ">": "pospuesta",
    "?": "pregunta",
    "!": "importante",
    k: "hecha",
    "¿": "hecha",
  };
  for (const [s, id] of Object.entries(casos)) assert.equal(est.estadoDeSimbolo(s).id, id, `[${s}]`);
});

test("el menú lista los nueve estados, cada uno con un símbolo distinto", () => {
  assert.equal(est.ESTADOS_TAREA.length, 9);
  assert.equal(new Set(est.ESTADOS_TAREA.map((e) => e.simbolo)).size, 9);
  for (const e of est.ESTADOS_TAREA) assert.equal(est.estadoDeSimbolo(e.simbolo).id, e.id);
});

test("el clic alterna como Obsidian: pendiente → hecha, cualquier otro → pendiente", () => {
  assert.equal(est.simboloAlClic(" "), "x");
  for (const s of ["x", "X", "-", "*", "+", "/", ">", "?", "!", "k"]) assert.equal(est.simboloAlClic(s), " ", s);
});

test("solo hecha y cancelada cambian el texto", () => {
  assert.equal(est.estiloDeTexto("x"), "hecha");
  assert.equal(est.estiloDeTexto("k"), "hecha");
  assert.equal(est.estiloDeTexto("-"), "cancelada");
  for (const s of [" ", "*", "+", "/", ">", "?", "!"]) assert.equal(est.estiloDeTexto(s), null, s);
});

test("cambiarSimboloEn escribe el símbolo nuevo y se niega si ya no hay marcador", () => {
  const t = "- [ ] uno\n- [x] dos\n";
  assert.equal(est.cambiarSimboloEn(t, 2, "-"), "- [-] uno\n- [x] dos\n");
  assert.equal(est.cambiarSimboloEn(t, 12, " "), "- [ ] uno\n- [ ] dos\n");
  assert.equal(est.cambiarSimboloEn(t, 3, "x"), null, "posición corrida");
  assert.equal(est.cambiarSimboloEn(t, 2, "]"), null, "símbolo inválido");
  assert.equal(est.cambiarSimboloEn(t, 2, "xx"), null, "más de un carácter");
});

test("qué cuenta como marcador: un carácter, sin corchetes, barra invertida ni tabulador", () => {
  for (const ok of ["[ ]", "[x]", "[-]", "[?]", "[ñ]"]) assert.ok(est.esMarcadorDeTarea(ok), ok);
  for (const no of ["[]", "[xx]", "[[]", "[]]", "[\\]", "[\t]", "(x)"]) assert.ok(!est.esMarcadorDeTarea(no), no);
});

// ── Las dos vistas reconocen las mismas tareas ─────────────────────────────

const DOCUMENTO = [
  "- [ ] pendiente",
  "- [x] hecha",
  "- [-] cancelada",
  "  - [ ] subtarea",
  "1. [/] en curso numerada",
  "> - [?] dentro de una cita",
  "> [!note] Callout",
  "> - [!] dentro de un callout",
  "- [*] destacada *con énfasis*",
  "- [>] pospuesta",
  "- [+] agregada",
  "- [k] desconocida",
  "- [] no es tarea",
  "- [xx] tampoco",
  "texto [x] suelto, no es tarea",
  "",
  "```",
  "- [ ] dentro de código, no es tarea",
  "```",
].join("\n");

test("vivo y lectura encuentran las mismas tareas, en la misma posición", () => {
  const vivo = tareasEnVivo(DOCUMENTO);
  const lectura = casillasEnLectura(DOCUMENTO).map(([pos, simbolo]) => [pos, simbolo]);
  assert.equal(vivo.length, 11);
  assert.deepEqual(lectura, vivo);
  // Y cada posición apunta de verdad a un marcador del documento.
  for (const [pos, simbolo] of vivo) assert.equal(DOCUMENTO.slice(pos, pos + 3), `[${simbolo}]`);
});

test("la posición es la del DOCUMENTO aunque haya frontmatter, y con CRLF", () => {
  const conFm = "---\ntitulo: x\n---\n- [-] tarea\n";
  const [[pos, simbolo]] = casillasEnLectura(conFm);
  assert.equal(conFm.slice(pos, pos + 3), "[-]");
  assert.equal(simbolo, "-");

  // CodeMirror normaliza los saltos a `\n`: la posición tiene que ser la de esa
  // versión del texto, que es la que va a editar.
  const crlf = "---\r\ntitulo: x\r\n---\r\nuno\r\n- [?] tarea\r\n";
  const [[posCrlf]] = casillasEnLectura(crlf);
  const normalizado = crlf.replace(/\r\n/g, "\n");
  assert.equal(normalizado.slice(posCrlf, posCrlf + 3), "[?]");
});

// ── HTML de lectura ─────────────────────────────────────────────────────────

test("la casilla lleva el símbolo, el estado y no está deshabilitada", () => {
  const html = renderNota("- [-] cancelada\n");
  assert.match(html, /<li class="task-list-item is-checked" data-task="-" data-estado="cancelada">/);
  assert.match(html, /<input type="checkbox" checked class="mic-task-check" data-task="-" data-estado="cancelada" data-task-pos="2" title="Cancelada">/);
  assert.ok(!/disabled/.test(html));
  // El marcador no queda escrito en el texto.
  assert.ok(!html.includes("[-]"), html);
});

test("una pendiente no está marcada y su texto no lleva estilo propio del <li>", () => {
  const html = renderNota("- [ ] algo\n");
  assert.match(html, /<li class="task-list-item" data-task=" " data-estado="pendiente">/);
  assert.match(html, /<input type="checkbox" class="mic-task-check"/);
});

test("el texto propio va en span.mic-tarea-texto y las subtareas quedan afuera", () => {
  const html = renderNota("- [x] madre [[Nota]]\n  - [ ] hija\n");
  const madre = html.match(/<li class="task-list-item is-checked"[^>]*>([\s\S]*?)<ul/)[1];
  assert.match(madre, /<span class="mic-tarea-texto">madre <a[^>]*mic-wikilink[^>]*>Nota<\/a><\/span>/);
  // La hija no está dentro del span de la madre: el span se cierra antes de la
  // sublista, así que no hereda el tachado.
  assert.ok(!/<span class="mic-tarea-texto">[^<]*(<a[^>]*>[^<]*<\/a>)?[^<]*<ul/.test(html), html);
  assert.match(html, /data-estado="pendiente"[^>]*><input[^>]*> <span class="mic-tarea-texto">hija<\/span>/);
});

test("lista espaciada: la casilla va dentro del <p> y también recibe el estado", () => {
  const html = renderNota("- [/] uno\n\n- [>] dos\n");
  assert.match(html, /<p><input type="checkbox" checked class="mic-task-check" data-task="\/" data-estado="en-curso"[^>]*> ?<span class="mic-tarea-texto">uno<\/span><\/p>/);
  assert.match(html, /data-estado="pospuesta"/);
});

test("un símbolo que el parser lee como sintaxis se quita igual del texto", () => {
  // `[*] algo*`: el `*` del marcador y el del final pueden formar énfasis.
  const html = renderNota("- [*] algo*\n");
  assert.match(html, /data-estado="destacada"/);
  assert.ok(!html.includes("[*"), html);
  assert.ok(!html.includes("<em>"), html);
});

test("dentro de un callout la tarea también se reconoce", () => {
  const html = renderNota("> [!note] Título\n> - [!] importante\n");
  assert.match(html, /data-estado="importante"/);
});

test("lo que no es tarea queda como texto", () => {
  const html = renderNota("- [] nada\n- [xx] nada\n\n```\n- [ ] código\n```\n");
  assert.ok(!/<input/.test(html), html);
  assert.ok(html.includes("[] nada") && html.includes("[xx] nada"));
});
