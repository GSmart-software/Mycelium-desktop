// Test de las macros (`FUN-XL-04`, Parte 6): leer lo guardado con datos
// inválidos, validar (pasos, comandos que existen, ciclos), las variables, la
// ejecución en orden con un registro simulado (espera de promesas, parada en el
// fallo, macros dentro de macros, recursión), las de fábrica y restaurarlas,
// la grabación (`pasoDeInvocacion`) y que el comando `macro.<id>` herede los
// atajos, los conflictos y las reservadas del registro.
//
// Los módulos se transpilan en el momento, como en `scripts/test-atajos.mjs`.
//
//   node --test scripts/test-macros.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const aUrl = (codigo) => `data:text/javascript,${encodeURIComponent(codigo)}`;

const FALSO = `
const falso = new Proxy(function () {}, {
  get: (_, k) => (k === Symbol.toPrimitive ? () => "falso" : k === "then" ? undefined : falso),
  apply: () => falso,
  construct: () => falso,
});`;

function moduloFalso(nombres) {
  const lineas = [FALSO];
  for (const n of nombres) lineas.push(n === "default" ? "export default falso;" : `export const ${n} = falso;`);
  return aUrl(lineas.join("\n"));
}

async function fuente(ruta, mapa = {}, { falsos = false } = {}) {
  const texto = await readFile(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");
  let { outputText } = ts.transpileModule(texto, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  outputText = outputText.replace(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)";/g, (todo, lista, esp) => {
    if (mapa[esp]) return `import {${lista}} from "${mapa[esp]}";`;
    if (!falsos) return todo;
    const nombres = lista
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    return `import {${lista}} from "${moduloFalso(nombres)}";`;
  });
  return aUrl(outputText);
}

const MODO_DEV = await fuente("../lib/modoDev.ts");
const ESPORAS = await fuente("../lib/esporas.ts");
const ATAJOS = await fuente("../lib/comandos/atajos.ts");
const PERSONALIZAR = await fuente("../lib/comandos/personalizar.ts", { "./atajos": ATAJOS });
const REGISTRO = await fuente("../lib/comandos/registro.ts", {
  "@/lib/modoDev": MODO_DEV,
  "./atajos": ATAJOS,
  "./personalizar": PERSONALIZAR,
});
const MACROS = await fuente("../lib/comandos/macros.ts", { "@/lib/esporas": ESPORAS });
const ATMOSFERAS = await fuente("../lib/atmosferas.ts");
const NUEVO = await fuente("../lib/comandos/nuevo.ts");
const APP = await fuente(
  "../lib/comandos/comandosApp.ts",
  { "@/lib/modoDev": MODO_DEV, "@/lib/atmosferas": ATMOSFERAS, "./nuevo": NUEVO },
  { falsos: true },
);
const COMANDOS_MACROS = await fuente(
  "../lib/comandos/comandosMacros.ts",
  { "@/lib/esporas": ESPORAS, "./macros": MACROS, "./registro": REGISTRO },
  { falsos: true },
);

const mac = await import(MACROS);
const reg = await import(REGISTRO);
const per = await import(PERSONALIZAR);
const { COMANDOS_APP } = await import(APP);
const cm = await import(COMANDOS_MACROS);

const ctx = { navegar: () => {}, dev: false };
const tecla = (code, mods = {}) => ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

// ── leer lo guardado ───────────────────────────────────────────────────────

test("normalizarMacros descarta lo inválido y lo avisa", () => {
  const { macros, descartes } = mac.normalizarMacros({
    version: 1,
    macros: [
      { id: "buena", nombre: "Buena", pasos: [{ tipo: "comando", comando: "nota.nueva" }, { tipo: "volar" }] },
      { id: "Mala Id", nombre: "Mala", pasos: [] },
      { id: "sin-nombre", nombre: "  ", pasos: [] },
      { id: "buena", nombre: "Repetida", pasos: [] },
      "no es un objeto",
      {
        id: "pasos",
        nombre: "Pasos",
        pasos: [
          { tipo: "texto", texto: "hola {{fecha}}" },
          { tipo: "texto" },
          { tipo: "abrir", nota: "Diario/{{fecha}}", crear: true, contenido: "# {{titulo}}" },
          { tipo: "abrir", nota: "" },
          { tipo: "espora", espora: "Reunión", carpeta: "Actas" },
          { tipo: "esperar", ms: 999999 },
          { tipo: "esperar", ms: "mucho" },
          { tipo: "comando", comando: "nota.abrir", args: { nota: "X", crear: true } },
          { tipo: "comando", comando: "nota.abrir", args: { nota: { anidado: 1 } } },
          { tipo: "comando", comando: "NO VALIDO" },
        ],
      },
    ],
  });
  assert.deepEqual(
    macros.map((m) => m.id),
    ["buena", "pasos"],
  );
  assert.equal(macros[0].pasos.length, 1);
  const pasos = macros[1].pasos;
  assert.deepEqual(pasos.map((p) => p.tipo), ["texto", "abrir", "espora", "esperar", "comando"]);
  assert.equal(pasos[3].ms, mac.ESPERA_MAXIMA_MS, "la espera se limita al tope");
  assert.deepEqual(pasos[4].args, { nota: "X", crear: true });
  assert.ok(descartes.length >= 5, descartes.join("\n"));
  assert.ok(descartes.some((d) => d.includes("«Buena»") && d.includes("un paso inválido")));
  assert.ok(descartes.some((d) => d.includes("repite")));
});

test("normalizarMacros con basura no rompe", () => {
  for (const crudo of [null, undefined, 3, "x", [], { macros: "no" }]) {
    const r = mac.normalizarMacros(crudo);
    assert.deepEqual(r.macros, []);
  }
  assert.deepEqual(mac.normalizarMacros(undefined).descartes, []);
  assert.equal(mac.normalizarMacros({ macros: "no" }).descartes.length, 1);
});

test("normalizarMacros conserva un comando que todavía no está registrado", () => {
  const { macros } = mac.normalizarMacros({ macros: [{ id: "a", nombre: "A", pasos: [{ tipo: "comando", comando: "explorador.futuro" }] }] });
  assert.equal(macros[0].pasos.length, 1);
});

// ── validar y ciclos ───────────────────────────────────────────────────────

const m = (id, ...llamadas) => ({
  id,
  nombre: id.toUpperCase(),
  pasos: llamadas.map((x) => ({ tipo: "comando", comando: x.includes(".") ? x : `macro.${x}` })),
});

test("cicloDesde encuentra ciclos directos e indirectos", () => {
  assert.deepEqual(mac.cicloDesde("a", [m("a", "a")]), ["a", "a"]);
  assert.deepEqual(mac.cicloDesde("a", [m("a", "b"), m("b", "c"), m("c", "a")]), ["a", "b", "c", "a"]);
  assert.equal(mac.cicloDesde("a", [m("a", "b"), m("b", "c"), m("c", "nota.nueva")]), null);
  // Un ciclo al que se llega desde a (aunque a no esté en él) también cuenta.
  assert.deepEqual(mac.cicloDesde("a", [m("a", "b"), m("b", "c"), m("c", "b")]), ["b", "c", "b"]);
  // Llamar dos veces a la misma macro no es un ciclo.
  assert.equal(mac.cicloDesde("a", [m("a", "b", "b"), m("b", "nota.nueva")]), null);
});

test("llamadaCreaCiclo: a sí misma y a una que la llama", () => {
  const macros = [m("a", "b"), m("b", "nota.nueva"), m("c", "a")];
  assert.equal(mac.llamadaCreaCiclo("a", "a", macros), true);
  assert.equal(mac.llamadaCreaCiclo("b", "a", macros), true);
  assert.equal(mac.llamadaCreaCiclo("b", "c", macros), true);
  assert.equal(mac.llamadaCreaCiclo("c", "b", macros), false);
});

test("validarMacro: comandos que no existen, macros que no existen, ciclos, vacíos", () => {
  const existe = (id) => ["nota.nueva", "panel.dividir-derecha"].includes(id);
  const macros = [m("a", "nota.nueva", "fantasma.comando", "zzz"), m("b", "c"), m("c", "b")];
  const p = mac.validarMacro(macros[0], { existe, macros });
  assert.ok(p.some((x) => x.startsWith("Paso 2") && x.includes("fantasma.comando")));
  assert.ok(p.some((x) => x.startsWith("Paso 3") && x.includes("«zzz» no existe")));
  assert.ok(mac.validarMacro(macros[1], { existe, macros }).some((x) => x.includes("B → C → B")));
  assert.ok(mac.validarMacro({ id: "v", nombre: "", pasos: [] }, { existe, macros }).length === 2);
  assert.deepEqual(mac.validarMacro(m("ok", "nota.nueva"), { existe, macros }), []);
  const malos = { id: "x", nombre: "X", pasos: [{ tipo: "texto", texto: "" }, { tipo: "abrir", nota: " " }] };
  assert.equal(mac.validarMacro(malos, { existe, macros }).length, 2);
});

// ── ids, nombres, variables ────────────────────────────────────────────────

test("idParaNombre y nombreLibre", () => {
  assert.equal(mac.idParaNombre("Nota del día", []), "nota-del-dia");
  assert.equal(mac.idParaNombre("Nota del día", ["nota-del-dia"]), "nota-del-dia-2");
  assert.equal(mac.idParaNombre("¡¡!!", []), "macro");
  assert.match(mac.idDeComandoMacro(mac.idParaNombre("Ñandú Rápido 3", [])), /^macro\.[a-z0-9-]+$/);
  assert.equal(mac.nombreLibre("Macro nueva", [{ nombre: "macro nueva" }, { nombre: "Macro nueva 2" }]), "Macro nueva 3");
});

test("expandirVariables: las de las Esporas", () => {
  const ahora = new Date(2026, 10, 6, 9, 5);
  assert.equal(
    mac.expandirVariables("{{fecha}} {{hora}} {{fecha:DD/MM/AAAA}} {{titulo}} {{otra}}", { titulo: "Idea", ahora }),
    "2026-11-06 09:05 06/11/2026 Idea {{otra}}",
  );
  assert.equal(mac.expandirVariables("# {{titulo}}", { ahora }), "# ");
});

test("invocacionDePaso y pasoDeInvocacion son inversas", () => {
  const pasos = [
    { tipo: "comando", comando: "nota.nueva" },
    { tipo: "comando", comando: "x.y", args: { a: 1 } },
    { tipo: "texto", texto: "hola" },
    { tipo: "abrir", nota: "Diario/{{fecha}}", crear: true, contenido: "# {{titulo}}" },
    { tipo: "abrir", nota: "Ideas" },
    { tipo: "espora", espora: "Reunión", carpeta: "Actas" },
  ];
  for (const p of pasos) {
    const inv = mac.invocacionDePaso(p);
    assert.deepEqual(mac.pasoDeInvocacion(inv.comando, inv.args), p);
  }
  assert.equal(mac.invocacionDePaso({ tipo: "esperar", ms: 10 }), null);
  assert.equal(mac.invocacionDePaso({ tipo: "texto", texto: "x" }).comando, "editor.insertar-texto");
});

test("moverPaso", () => {
  const p = [1, 2, 3];
  assert.deepEqual(mac.moverPaso(p, 0, 1), [2, 1, 3]);
  assert.deepEqual(mac.moverPaso(p, 2, -1), [1, 3, 2]);
  assert.deepEqual(mac.moverPaso(p, 0, -1), [1, 2, 3]);
  assert.deepEqual(mac.moverPaso(p, 2, 1), [1, 2, 3]);
});

// ── ejecutar ───────────────────────────────────────────────────────────────

/** Un registro simulado que anota lo que se ejecuta. */
function entorno(macros, extra = {}) {
  const hechos = [];
  const comandos = {
    "a.uno": { titulo: "Uno", ejecutar: () => hechos.push("uno") },
    "a.lento": {
      titulo: "Lento",
      ejecutar: () => new Promise((r) => setTimeout(() => (hechos.push("lento"), r()), 20)),
    },
    "a.falla": {
      titulo: "Falla",
      ejecutar: async () => {
        throw new Error("se rompió");
      },
    },
    "a.lanza": {
      titulo: "Lanza",
      ejecutar: () => {
        throw new Error("lanzó");
      },
    },
    "a.oculto": { titulo: "Oculto", disponible: () => false, ejecutar: () => hechos.push("oculto") },
    "a.dev": { titulo: "Dev", soloDev: true, ejecutar: () => hechos.push("dev") },
    "editor.insertar-texto": { titulo: "Insertar", ejecutar: (_c, args) => hechos.push(`texto:${args.texto}`) },
    "nota.abrir": { titulo: "Abrir", ejecutar: (_c, args) => hechos.push(`abrir:${args.nota}:${!!args.crear}`) },
  };
  return {
    hechos,
    e: {
      ctx,
      comando: (id) => comandos[id],
      macro: (id) => macros.find((x) => x.id === id),
      esperar: async (ms) => hechos.push(`esperar:${ms}`),
      ...extra,
    },
  };
}

test("ejecuta en orden y espera las promesas", async () => {
  const macro = {
    id: "x",
    nombre: "X",
    pasos: [
      { tipo: "comando", comando: "a.lento" },
      { tipo: "comando", comando: "a.uno" },
      { tipo: "texto", texto: "hola" },
      { tipo: "esperar", ms: 50000 },
      { tipo: "abrir", nota: "N", crear: true },
    ],
  };
  const { hechos, e } = entorno([macro]);
  const r = await mac.ejecutarMacro(macro, e);
  assert.deepEqual(r, { ok: true, pasos: 5 });
  assert.deepEqual(hechos, ["lento", "uno", "texto:hola", `esperar:${mac.ESPERA_MAXIMA_MS}`, "abrir:N:true"]);
});

test("se detiene en el paso que falla y dice cuál", async () => {
  for (const [cmd, motivo] of [
    ["a.falla", "se rompió"],
    ["a.lanza", "lanzó"],
    ["a.oculto", "no está disponible ahora"],
    ["a.dev", "no existe o no está disponible"],
    ["no.existe", "no existe o no está disponible"],
  ]) {
    const macro = { id: "x", nombre: "X", pasos: [{ tipo: "comando", comando: "a.uno" }, { tipo: "comando", comando: cmd }, { tipo: "comando", comando: "a.uno" }] };
    const { hechos, e } = entorno([macro]);
    const r = await mac.ejecutarMacro(macro, e);
    assert.equal(r.ok, false, cmd);
    assert.equal(r.paso, 2, cmd);
    assert.equal(r.macro, "X");
    assert.ok(r.motivo.includes(motivo), `${cmd}: ${r.motivo}`);
    assert.deepEqual(hechos, ["uno"], `${cmd}: no siguió después del fallo`);
    assert.match(mac.textoFallo(r), /^el paso 2 de «X» falló: /);
  }
});

test("un comando de desarrollador corre con el modo dev", async () => {
  const macro = { id: "x", nombre: "X", pasos: [{ tipo: "comando", comando: "a.dev" }] };
  const { hechos, e } = entorno([macro]);
  const r = await mac.ejecutarMacro(macro, { ...e, ctx: { ...ctx, dev: true } });
  assert.equal(r.ok, true);
  assert.deepEqual(hechos, ["dev"]);
});

test("una macro dentro de otra, y el fallo de la de adentro", async () => {
  const adentro = { id: "adentro", nombre: "Adentro", pasos: [{ tipo: "comando", comando: "a.uno" }, { tipo: "comando", comando: "a.falla" }] };
  const afuera = { id: "afuera", nombre: "Afuera", pasos: [{ tipo: "comando", comando: "macro.adentro" }, { tipo: "comando", comando: "a.uno" }] };
  const { hechos, e } = entorno([adentro, afuera]);
  const r = await mac.ejecutarMacro(afuera, e);
  assert.equal(r.ok, false);
  assert.equal(r.macro, "Adentro");
  assert.equal(r.paso, 2);
  assert.deepEqual(hechos, ["uno"]);
});

test("la recursión se corta al ejecutar, sin colgarse", async () => {
  const a = { id: "a", nombre: "A", pasos: [{ tipo: "comando", comando: "a.uno" }, { tipo: "comando", comando: "macro.b" }] };
  const b = { id: "b", nombre: "B", pasos: [{ tipo: "comando", comando: "macro.a" }] };
  const { hechos, e } = entorno([a, b]);
  const r = await mac.ejecutarMacro(a, e);
  assert.equal(r.ok, false);
  assert.equal(r.macro, "B");
  assert.ok(r.motivo.includes("ya está en curso"));
  assert.deepEqual(hechos, ["uno"]);
  const sola = { id: "s", nombre: "S", pasos: [{ tipo: "comando", comando: "macro.s" }] };
  const r2 = await mac.ejecutarMacro(sola, entorno([sola]).e);
  assert.equal(r2.ok, false);
  const r3 = await mac.ejecutarMacro(a, e, ["a"]);
  assert.equal(r3.ok, false);
  assert.equal(r3.paso, 0);
});

test("una macro que llama a una que no existe falla en ese paso", async () => {
  const a = { id: "a", nombre: "A", pasos: [{ tipo: "comando", comando: "macro.nadie" }] };
  const r = await mac.ejecutarMacro(a, entorno([a]).e);
  assert.equal(r.ok, false);
  assert.ok(r.motivo.includes("«nadie» no existe"));
});

test("entrePasos corre antes de cada paso", async () => {
  const macro = { id: "x", nombre: "X", pasos: [{ tipo: "comando", comando: "a.uno" }, { tipo: "comando", comando: "a.uno" }] };
  const { hechos, e } = entorno([macro], {});
  e.entrePasos = async () => hechos.push("cuadro");
  await mac.ejecutarMacro(macro, e);
  assert.deepEqual(hechos, ["cuadro", "uno", "cuadro", "uno"]);
});

// ── las de fábrica ─────────────────────────────────────────────────────────

const idsRegistrados = new Set([...COMANDOS_APP, ...cm.COMANDOS_MACROS].map((c) => c.id));

test("las macros de fábrica son válidas y usan comandos que existen", () => {
  assert.equal(mac.MACROS_DE_FABRICA.length, 3);
  const { macros, descartes } = mac.normalizarMacros({ macros: mac.MACROS_DE_FABRICA });
  assert.deepEqual(descartes, []);
  assert.deepEqual(macros, mac.MACROS_DE_FABRICA);
  for (const f of mac.MACROS_DE_FABRICA) {
    assert.deepEqual(mac.validarMacro(f, { existe: (id) => idsRegistrados.has(id), macros: mac.MACROS_DE_FABRICA }), [], f.id);
    for (const p of f.pasos) {
      const inv = mac.invocacionDePaso(p);
      if (inv) assert.ok(idsRegistrados.has(inv.comando), inv.comando);
    }
  }
});

test("restaurar las de fábrica: vuelven las borradas y las cambiadas, las del usuario quedan", () => {
  const mia = { id: "mia", nombre: "Mía", pasos: [] };
  const cambiada = { ...mac.copiarMacro(mac.MACROS_DE_FABRICA[1]), nombre: "Otro nombre" };
  assert.equal(mac.igualQueDeFabrica(cambiada), false);
  const r = mac.restaurarDeFabrica([mia, cambiada]);
  assert.deepEqual(r.map((x) => x.id), ["mia", "nota-del-dia", "nota-al-lado", "ordenar-bandeja"]);
  assert.equal(r[1].nombre, "Nota del día");
  assert.ok(r.slice(1).every(mac.igualQueDeFabrica));
  // No comparten objetos con la constante.
  r[1].pasos.push({ tipo: "esperar", ms: 1 });
  assert.equal(mac.MACROS_DE_FABRICA[1].pasos.length, 1);
});

// ── en el registro ─────────────────────────────────────────────────────────

test("los comandos nuevos son válidos junto a los de la app", () => {
  assert.deepEqual(reg.validarComandos([...COMANDOS_APP, ...cm.COMANDOS_MACROS]), []);
  for (const id of ["editor.insertar-texto", "nota.abrir", "espora.crear"]) {
    const c = cm.COMANDOS_MACROS.find((x) => x.id === id);
    assert.equal(c.requiereArgs, true, id);
    assert.equal((c.atajos ?? []).length, 0, id);
  }
  // Ningún comando fijo empieza como los de las macros (`macro.`): chocarían con una macro.
  assert.ok([...idsRegistrados].every((id) => !id.startsWith("macro.")));
});

test("los comandos con datos no salen en la paleta ni en los atajos", () => {
  const todos = [...COMANDOS_APP, ...cm.COMANDOS_MACROS];
  const paleta = reg.comandosDePaleta(todos, ctx).map((c) => c.id);
  assert.ok(!paleta.includes("editor.insertar-texto"));
  assert.ok(paleta.includes("bandeja.abrir"));
  assert.ok(paleta.includes("macros.grabar"));
  const enGrupos = reg.gruposDeAtajos(todos, false).flatMap((g) => g.comandos.map((c) => c.comando.id));
  assert.ok(!enGrupos.includes("nota.abrir"));
});

test("las que abren algo para elegir no se graban", () => {
  for (const id of ["paleta.comandos", "paleta.notas", "pistas.mostrar", "atajos.hoja", "crear.nuevo", "crear.desde-espora", "macros.grabar"]) {
    const c = [...COMANDOS_APP, ...cm.COMANDOS_MACROS].find((x) => x.id === id);
    assert.equal(c?.noSeGraba, true, id);
  }
  assert.ok(!COMANDOS_APP.find((x) => x.id === "nota.nueva").noSeGraba);
});

test("el comando macro.<id> hereda los atajos, los conflictos y las reservadas", () => {
  const macroCmd = { id: "macro.nota-del-dia", titulo: "Macro: Nota del día", icono: null, categoria: "macros", ejecutar() {} };
  const todos = [...COMANDOS_APP, macroCmd];
  const atajo = { ctrl: true, alt: true, code: "KeyD" }; // AltGr: inválido
  assert.equal(per.choqueDe(atajo, macroCmd.id, todos, reg.efectivosDe(todos, {})).tipo, "invalido");
  const libre = { ctrl: true, shift: true, code: "KeyD" };
  assert.equal(per.choqueDe(libre, macroCmd.id, todos, reg.efectivosDe(todos, {})), null);
  assert.equal(per.choqueDe({ ctrl: true, code: "KeyW" }, macroCmd.id, todos, reg.efectivosDe(todos, {})).tipo, "otro");
  assert.equal(
    per.choqueDe({ ctrl: true, shift: true, code: "Space" }, macroCmd.id, todos, reg.efectivosDe(todos, {})).tipo,
    "reservada",
  );
  assert.equal(per.choqueDe({ code: "KeyD" }, macroCmd.id, todos, reg.efectivosDe(todos, {})).tipo, "invalido");
  // Asignado y guardado como cualquier otro: lo encuentra el despachador.
  const sobre = per.normalizarSobreescrituras(per.asignarAtajo({}, todos, macroCmd.id, null, libre));
  assert.deepEqual(sobre, { "macro.nota-del-dia": [libre] });
  assert.equal(reg.comandoParaTecla(tecla("KeyD", { ctrlKey: true, shiftKey: true }), todos, false, "burbuja", sobre)?.id, macroCmd.id);
  // Y aparece en la hoja, en su grupo «Macros».
  const grupos = reg.gruposDeAtajos(todos, false, { soloConAtajo: true, sobre });
  const g = grupos.find((x) => x.categoria === "macros");
  assert.equal(g?.nombre, "Macros");
  assert.deepEqual(g.comandos.map((c) => c.comando.id), [macroCmd.id]);
  // Reemplazar Ctrl+W: la pestaña se queda sin él.
  const robado = per.asignarAtajo({}, todos, macroCmd.id, null, { ctrl: true, code: "KeyW" });
  assert.equal(reg.comandoParaTecla(tecla("KeyW", { ctrlKey: true }), todos, false, "burbuja", robado)?.id, macroCmd.id);
});

test("comandoDeMacro arma el comando de la macro", () => {
  const c = cm.comandoDeMacro({ id: "nota-del-dia", nombre: "Nota del día", pasos: [{ tipo: "esperar", ms: 1 }] });
  assert.equal(c.id, "macro.nota-del-dia");
  assert.equal(c.titulo, "Macro: Nota del día");
  assert.equal(c.detalle, "1 paso");
  assert.equal(c.categoria, "macros");
  assert.deepEqual(reg.validarComandos([c]), []);
});
