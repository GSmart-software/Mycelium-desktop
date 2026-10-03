// Test headless (sin navegador ni Tauri) de la Parte 3 del MCP de control
// (`FUN-L-09`): la lógica de las herramientas de archivos
// (`lib/mcpArchivosLogica.ts`) —validar argumentos y nombres, resolver el
// objetivo, el destino, el alcance que decide si se pregunta, el texto del
// efecto, deshacer con el estado cambiado, la papelera—, el formato del
// registro para lo nuevo (`lib/actividadIa.ts`) y la **cola de
// confirmaciones** (`stores/confirmarStore.ts`): una pregunta de la IA no
// cancela ni desplaza a una del usuario. Los módulos se transpilan en el
// momento, como en `scripts/test-mcp-control.mjs`.
//
//   node --test scripts/test-mcp-archivos.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;
const ESM = (archivo) =>
  pathToFileURL(fileURLToPath(new URL(`../node_modules/zustand/esm/${archivo}`, import.meta.url))).href;

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

const EXTENSIONES = await fuente("../lib/extensionesDeTipo.ts");
const WIKILINKS = await fuente("../lib/wikilinks.ts", { "@/lib/extensionesDeTipo": EXTENSIONES });
const CONTROL = await fuente("../lib/mcpControlLogica.ts", { "@/lib/wikilinks": WIKILINKS });
const TITULO = await fuente("../lib/tituloEditable.ts");
const arch = await import(
  await fuente("../lib/mcpArchivosLogica.ts", { "@/lib/mcpControlLogica": CONTROL, "@/lib/tituloEditable": TITULO })
);
const act = await import(await fuente("../lib/actividadIa.ts"));
const { useConfirmarStore } = await import(await fuente("../stores/confirmarStore.ts", { zustand: ESM("index.mjs") }));

// Un vault chico: Área/Proyectos/Plan.md, docs/Plan.md (homónima), Suelta.md, y un PDF.
const carpetas = [
  { id: "Área", nombre: "Área", padreId: null },
  { id: "Área/Proyectos", nombre: "Proyectos", padreId: "Área" },
  { id: "docs", nombre: "docs", padreId: null },
  { id: "Suelta", nombre: "Suelta", padreId: null },
];
const nota = (id, carpetaId) => ({ id, carpetaId, titulo: id.slice(id.lastIndexOf("/") + 1).replace(/\.md$/, ""), tipo: "markdown" });
const notas = [nota("Área/Proyectos/Plan.md", "Área/Proyectos"), nota("docs/Plan.md", "docs"), nota("Suelta.md", null), nota("docs/Idea.md", "docs")];
const otros = [{ ruta: "docs/informe.pdf" }];

// ── Argumentos ──────────────────────────────────────────────────────────────

test("renombrar: el nombre pasa por las reglas del título editable", () => {
  assert.deepEqual(arch.validarRenombrar({ objetivo: " Plan ", nombre: " Plan 2026 " }), {
    ok: true,
    valor: { objetivo: "Plan", nombre: "Plan 2026" },
  });
  for (const malo of ["a:b", "a/b", 'dijo "hola"', "x?", "CON", "termina.", ""]) {
    const v = arch.validarRenombrar({ objetivo: "Plan", nombre: malo });
    assert.equal(v.ok, false, malo);
    assert.equal(v.error.codigo, "INVALIDO");
    assert.equal(v.error.datos.campo, "nombre");
  }
  assert.match(arch.validarRenombrar({ objetivo: "Plan", nombre: "a:b" }).error.mensaje, /no puede llevar :/);
  // Un campo de más no pasa en silencio.
  assert.equal(arch.validarRenombrar({ objetivo: "Plan", nombre: "X", titulo: "Y" }).error.datos.campo, "titulo");
});

test("la extensión escrita en el nombre se quita; otra extensión, no", () => {
  assert.equal(arch.nombreSinExtension("Plan 2026.md", ".md"), "Plan 2026");
  assert.equal(arch.nombreSinExtension("Plan 2026.MD", ".md"), "Plan 2026");
  assert.equal(arch.nombreSinExtension("v1.2", ".md"), "v1.2");
  assert.equal(arch.nombreSinExtension(".md", ".md"), ".md");
});

test("mover: la carpeta vacía o con barra es la raíz; papelera: listar por defecto", () => {
  assert.equal(arch.validarMover({ objetivo: "Plan", carpeta: "/" }).valor.carpeta, "");
  assert.equal(arch.validarMover({ objetivo: "Plan", carpeta: "\\docs\\" }).valor.carpeta, "docs");
  assert.equal(arch.validarMover({ objetivo: "Plan" }).ok, false);
  assert.deepEqual(arch.validarPapelera({}).valor, { accion: "listar" });
  assert.equal(arch.validarPapelera({ accion: "restaurar" }).error.datos.campo, "id");
  assert.equal(arch.validarPapelera({ accion: "vaciar" }).ok, false, "no hay borrado permanente");
});

// ── El objetivo ─────────────────────────────────────────────────────────────

test("una nota por ruta o título único; homónimas → AMBIGUO con las rutas", () => {
  assert.equal(arch.resolverAfectado("docs/Plan.md", notas, carpetas, otros).valor.nota.id, "docs/Plan.md");
  assert.equal(arch.resolverAfectado("Idea", notas, carpetas, otros).valor.nota.id, "docs/Idea.md");
  const amb = arch.resolverAfectado("Plan", notas, carpetas, otros);
  assert.equal(amb.error.codigo, "AMBIGUO");
  assert.deepEqual(amb.error.datos.rutas, ["docs/Plan.md", "Área/Proyectos/Plan.md"]);
  assert.equal(arch.resolverAfectado("Proyectos/Plan", notas, carpetas, otros).valor.nota.id, "Área/Proyectos/Plan.md");
});

test("una carpeta por ruta, por nombre único o con barra final; nota y carpeta homónimas → AMBIGUO", () => {
  assert.equal(arch.resolverAfectado("Área/Proyectos", notas, carpetas, otros).valor.carpeta.id, "Área/Proyectos");
  assert.equal(arch.resolverAfectado("proyectos", notas, carpetas, otros).valor.carpeta.id, "Área/Proyectos");
  // `Suelta` es una nota (Suelta.md) y una carpeta.
  const amb = arch.resolverAfectado("Suelta", notas, carpetas, otros);
  assert.equal(amb.error.codigo, "AMBIGUO");
  assert.deepEqual(amb.error.datos.rutas, ["Suelta.md", "Suelta/"]);
  assert.equal(arch.resolverAfectado("Suelta/", notas, carpetas, otros).valor.clase, "carpeta");
  assert.equal(arch.resolverAfectado("Suelta.md", notas, carpetas, otros).valor.clase, "nota");
});

test("el grafo, el calendario y lo no indexado no se operan; lo que no existe trae candidatas", () => {
  assert.equal(arch.resolverAfectado("grafo", notas, carpetas, otros).error.codigo, "INVALIDO");
  assert.match(arch.resolverAfectado("docs/informe.pdf", notas, carpetas, otros).error.mensaje, /no es una nota/);
  const nada = arch.resolverAfectado("Ideas", notas, carpetas, otros);
  assert.equal(nada.error.codigo, "NO_ENCONTRADO");
  assert.ok(nada.error.datos.candidatas.some((c) => c.ruta === "docs/Idea.md"));
});

test("el destino de mover tiene que existir (no se crean carpetas)", () => {
  assert.deepEqual(arch.resolverDestino("", carpetas), { ok: true, valor: null });
  assert.equal(arch.resolverDestino("área/proyectos", carpetas).valor.id, "Área/Proyectos");
  const no = arch.resolverDestino("Area/Proyecto", carpetas);
  assert.equal(no.error.codigo, "NO_ENCONTRADO");
  assert.match(no.error.mensaje, /no crea carpetas/);
  assert.ok(no.error.datos.candidatas.some((c) => c.ruta === "Área/Proyectos/"));
});

test("ruta ocupada sin distinguir mayúsculas, salvo el propio archivo (renombrar solo de mayúsculas)", () => {
  assert.equal(arch.rutaOcupada("DOCS/plan.md", ["docs/Plan.md"]), true);
  assert.equal(arch.rutaOcupada("docs/PLAN.md", ["docs/Plan.md"], "docs/Plan.md"), false);
});

// ── El alcance ──────────────────────────────────────────────────────────────

test("pregunta solo si reescribe enlaces en MÁS de 5 notas; borrar carpeta siempre, nota nunca", () => {
  assert.equal(arch.UMBRAL_CONFIRMAR, 5);
  assert.equal(arch.pidePermiso("renombrar", "nota", 5), false);
  assert.equal(arch.pidePermiso("renombrar", "nota", 6), true);
  assert.equal(arch.pidePermiso("mover", "carpeta", 0), false);
  assert.equal(arch.pidePermiso("mover", "carpeta", 6), true);
  assert.equal(arch.pidePermiso("borrar", "nota", 100), false);
  assert.equal(arch.pidePermiso("borrar", "carpeta", 0), true);
});

test("la pregunta dice qué pidió la IA y su alcance", () => {
  const reescribe = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"];
  const p = arch.preguntaConfirmacion("renombrar", "nota", { ruta: "docs/Plan.md", nombreNuevo: "Plan 2026", reescribe });
  assert.equal(p.boton, "Renombrar");
  assert.match(p.mensaje, /^Claude Code pide renombrar la nota «Plan» a «Plan 2026»\./);
  assert.match(p.mensaje, /reescribe enlaces en 7 notas: a, b, c, d, e y 2 más\./);
  const b = arch.preguntaConfirmacion("borrar", "carpeta", { ruta: "Área/Proyectos", reescribe: [], notasCarpeta: 12 });
  assert.equal(b.boton, "Eliminar");
  assert.match(b.mensaje, /eliminar la carpeta «Área\/Proyectos»\. Manda 12 notas a la papelera/);
  const m = arch.preguntaConfirmacion("mover", "nota", { ruta: "Plan.md", carpetaNueva: null, reescribe });
  assert.match(m.mensaje, /mover la nota «Plan» en la raíz del vault/);
});

test("RECHAZADO es una respuesta: lo dice el mensaje, y distingue el silencio", () => {
  assert.match(arch.mensajeRechazo("renombrar «Plan»", false), /dijo que no.*no lo vuelvas a pedir.*\(mv, rm\)/s);
  assert.match(arch.mensajeRechazo("renombrar «Plan»", true), /no contestó a tiempo/);
});

test("el efecto dice cuántas notas y cuáles (hasta 10), y las que quedaron sin reparar", () => {
  assert.equal(arch.efectoEnlaces([], []), "No había enlaces que reparar.");
  const doce = Array.from({ length: 12 }, (_, i) => `n${i}.md`);
  assert.match(arch.efectoEnlaces(doce, []), /en 12 notas: n0, n1, .* n9 y 2 más\.$/);
  assert.match(arch.efectoEnlaces(["a.md"], ["b.md"]), /en 1 nota: a; una nota quedó con el enlace viejo .*b\.md.*arreglalas a mano\./);
});

// ── Deshacer con el estado cambiado ─────────────────────────────────────────

const estado = (n, c, p = []) => ({ notas: new Set(n), carpetas: new Set(c), papelera: new Set(p) });

test("deshacer renombrar/mover: solo si sigue donde lo dejó la operación y su lugar de antes está libre", () => {
  const d = { tipo: "archivo_renombrar", clase: "nota", ruta: "docs/Plan 2026.md", rutaAntes: "docs/Plan.md", nombre: "Plan" };
  assert.deepEqual(arch.puedeDeshacerArchivos(estado(["docs/Plan 2026.md"], ["docs"]), d), { ok: true });
  // Se volvió a renombrar después: no se toca.
  const r = arch.puedeDeshacerArchivos(estado(["docs/Plan final.md"], ["docs"]), d);
  assert.equal(r.ok, false);
  assert.match(r.porque, /^cambió después/);
  // Alguien ocupó el nombre viejo.
  assert.match(arch.puedeDeshacerArchivos(estado(["docs/Plan 2026.md", "docs/plan.md"], ["docs"]), d).porque, /ocupada/);
  const m = { tipo: "archivo_mover", clase: "carpeta", ruta: "Archivo/Proyectos", rutaAntes: "Área/Proyectos", carpeta: "Área" };
  assert.equal(arch.puedeDeshacerArchivos(estado([], ["Archivo", "Archivo/Proyectos", "Área"]), m).ok, true);
  assert.match(arch.puedeDeshacerArchivos(estado([], ["Archivo", "Archivo/Proyectos"]), m).porque, /«Área» ya no existe/);
});

test("deshacer borrar: tiene que seguir en la papelera; restaurado a mano, cambió después", () => {
  const d = { tipo: "archivo_restaurar", clase: "nota", ruta: "docs/Plan.md", notas: ["docs/Plan.md"] };
  assert.equal(arch.puedeDeshacerArchivos(estado([], ["docs"], ["docs/Plan.md"]), d).ok, true);
  assert.match(arch.puedeDeshacerArchivos(estado(["docs/Plan.md"], ["docs"], []), d).porque, /^cambió después/);
  // Papelera sin leer: no se puede saber, se intenta (y el repo dirá).
  assert.equal(arch.puedeDeshacerArchivos({ ...estado([], []), papelera: null }, d).ok, true);
});

test("restaurar: por id, por carpeta borrada, por título; las carpetas que faltan, de arriba abajo", () => {
  const items = [
    { notaId: "Viejo/A.md", titulo: "A", rutaOriginal: "/Viejo", eliminadoEn: "x" },
    { notaId: "Viejo/Sub/B.md", titulo: "B", rutaOriginal: "/Viejo/Sub", eliminadoEn: "x" },
    { notaId: "C.md", titulo: "C", rutaOriginal: "/", eliminadoEn: "x" },
  ];
  assert.deepEqual(arch.aRestaurar("C.md", items).valor, { clase: "nota", ids: ["C.md"] });
  assert.deepEqual(arch.aRestaurar("C", items).valor, { clase: "nota", ids: ["C.md"] });
  assert.deepEqual(arch.aRestaurar("Viejo/", items).valor, { clase: "carpeta", ids: ["Viejo/A.md", "Viejo/Sub/B.md"] });
  assert.equal(arch.aRestaurar("Nada", items).error.codigo, "NO_ENCONTRADO");
  assert.deepEqual(arch.carpetasQueFaltan(["Viejo/A.md", "Viejo/Sub/B.md", "C.md"], new Set()), ["Viejo", "Viejo/Sub"]);
  assert.deepEqual(arch.carpetasQueFaltan(["Viejo/Sub/B.md"], new Set(["Viejo"])), ["Viejo/Sub"]);
});

// ── El registro ─────────────────────────────────────────────────────────────

test("el registro lee lo nuevo: deshacer de archivos, objetivo carpeta y papelera", () => {
  const renglon = {
    v: 1,
    id: "e1",
    momento: "2026-10-01T12:00:00.000Z",
    op: "renombrar",
    resultado: "hecho",
    efecto: "Renombré…",
    objetivo: { tipo: "carpeta", ruta: "Área/Nuevo" },
    deshacer: { tipo: "archivo_renombrar", clase: "carpeta", ruta: "Área/Nuevo", rutaAntes: "Área/Viejo", nombre: "Viejo" },
  };
  const e = act.leerRenglon(JSON.stringify(renglon));
  assert.deepEqual(e.objetivo, renglon.objetivo);
  assert.deepEqual(e.deshacer, renglon.deshacer);
  const roto = act.leerRenglon(JSON.stringify({ ...renglon, deshacer: { tipo: "archivo_mover", ruta: "x" } }));
  assert.equal(roto.deshacer, undefined, "un deshacer incompleto no se ofrece");
  assert.deepEqual(act.leerRenglon(JSON.stringify({ ...renglon, objetivo: { tipo: "papelera" } })).objetivo, { tipo: "papelera" });
  assert.equal(act.seRegistra("confirmacion", "hecho"), false);
  assert.equal(act.seRegistra("confirmacion_retirar", "rechazado"), false);
  assert.equal(act.seRegistra("renombrar", "rechazado"), true);
});

// ── La cola de confirmaciones ───────────────────────────────────────────────

test("una pregunta de la IA no cancela ni desplaza a la del usuario: espera detrás", async () => {
  const s = useConfirmarStore;
  const usuario = s.getState().preguntar("¿Eliminar la carpeta?", "Eliminar");
  const ia = s.getState().encolar("Claude Code pide renombrar…", "Renombrar", "ia");
  assert.equal(s.getState().pendiente.origen, "usuario", "en pantalla sigue la del usuario");
  s.getState().responder(true);
  assert.equal(await usuario, true, "la del usuario no se canceló");
  assert.equal(s.getState().pendiente.origen, "ia", "después aparece la de la IA");
  s.getState().responder(false);
  assert.equal(await ia.respuesta, false);
  assert.equal(s.getState().pendiente, null);
});

test("una pregunta del usuario pasa adelante de la de la IA; entre las del usuario, la nueva reemplaza", async () => {
  const s = useConfirmarStore;
  const ia = s.getState().encolar("IA", "Mover", "ia");
  const u1 = s.getState().preguntar("Usuario 1", "Eliminar");
  assert.equal(s.getState().pendiente.mensaje, "Usuario 1");
  const u2 = s.getState().preguntar("Usuario 2", "Eliminar");
  assert.equal(await u1, false, "la anterior del usuario se cancela, como antes");
  assert.deepEqual(s.getState().cola.map((p) => p.mensaje), ["Usuario 2", "IA"]);
  s.getState().responder(true);
  assert.equal(await u2, true);
  assert.equal(s.getState().pendiente.mensaje, "IA", "la de la IA sigue ahí");
  s.getState().retirar(ia.id);
  assert.equal(await ia.respuesta, false, "retirarla cuenta como no");
  assert.equal(s.getState().pendiente, null);
});
