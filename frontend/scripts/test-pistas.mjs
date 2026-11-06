// Test del modo pistas (`FUN-XL-04`, Parte 5): las etiquetas (únicas, del mismo
// largo, sin que una sea el comienzo de otra), el orden por posición, cómo se
// escribe una etiqueta letra a letra, qué se hace con cada tipo de elemento y
// que el comando `pistas.mostrar` tenga F10, en captura, sin tecla reservada.
//
// Los módulos se transpilan en el momento, como en `scripts/test-comandos.mjs`.
//
//   node --test scripts/test-pistas.mjs
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

const PISTAS = await fuente("../lib/teclado/pistas.ts");
const ATAJOS = await fuente("../lib/comandos/atajos.ts");
const MODO_DEV = await fuente("../lib/modoDev.ts");
const PERSONALIZAR = await fuente("../lib/comandos/personalizar.ts", { "./atajos": ATAJOS });
const REGISTRO = await fuente("../lib/comandos/registro.ts", {
  "@/lib/modoDev": MODO_DEV,
  "./atajos": ATAJOS,
  "./personalizar": PERSONALIZAR,
});
const CONSOLA = await fuente("../lib/comandos/teclasConsola.ts", { "./atajos": ATAJOS, "./registro": REGISTRO });
const ATMOSFERAS = await fuente("../lib/atmosferas.ts");
const NUEVO = await fuente("../lib/comandos/nuevo.ts");
const APP = await fuente(
  "../lib/comandos/comandosApp.ts",
  { "@/lib/modoDev": MODO_DEV, "@/lib/atmosferas": ATMOSFERAS, "./nuevo": NUEVO },
  { falsos: true },
);

const p = await import(PISTAS);
const at = await import(ATAJOS);
const reg = await import(REGISTRO);
const consola = await import(CONSOLA);
const { COMANDOS_APP } = await import(APP);

const tecla = (code, mods = {}) => ({ code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

// ── el alfabeto ───────────────────────────────────────────────────────────

test("el alfabeto: sin repetidas, sin I ni O, y la fila central primero", () => {
  const a = p.ALFABETO_PISTAS;
  assert.equal(new Set(a).size, a.length);
  assert.ok(!a.includes("I") && !a.includes("O"));
  assert.ok(a.startsWith("ASDFGHJKL"));
  assert.match(a, /^[A-Z]+$/);
});

// ── las etiquetas ─────────────────────────────────────────────────────────

const sinPrefijos = (lista) => lista.every((x, i) => lista.every((y, j) => i === j || !y.startsWith(x)));

test("pocas: una letra cada una, las más cómodas primero", () => {
  assert.deepEqual(p.etiquetasPistas(0), []);
  assert.deepEqual(p.etiquetasPistas(3), ["A", "S", "D"]);
  const todas = p.etiquetasPistas(p.ALFABETO_PISTAS.length);
  assert.ok(todas.every((e) => e.length === 1));
});

test("más que letras: dos cada una, todas del mismo largo y sin prefijos", () => {
  const k = p.ALFABETO_PISTAS.length;
  for (const n of [k + 1, 60, 200, k * k]) {
    const l = p.etiquetasPistas(n);
    assert.equal(l.length, n);
    assert.equal(new Set(l).size, n, `repetidas con ${n}`);
    assert.ok(l.every((e) => e.length === 2), `largo distinto con ${n}`);
    assert.ok(sinPrefijos(l), `prefijos con ${n}`);
    assert.ok(l.every((e) => [...e].every((c) => p.ALFABETO_PISTAS.includes(c))));
  }
  assert.deepEqual(p.etiquetasPistas(k + 1).slice(0, 3), ["AA", "AS", "AD"]);
});

test("muchísimas: tres letras", () => {
  const k = p.ALFABETO_PISTAS.length;
  const l = p.etiquetasPistas(k * k + 1);
  assert.ok(l.every((e) => e.length === 3));
  assert.equal(new Set(l).size, l.length);
});

// ── las etiquetas por nombre ──────────────────────────────────────────────

test("las palabras de un nombre: sin tildes, sin vacías, sin signos ni el atajo", () => {
  assert.deepEqual(p.palabrasDeNombre("Abrir el panel de búsqueda"), ["ABRIR", "PANEL", "BUSQUEDA"]);
  assert.deepEqual(p.palabrasDeNombre("Árbol"), ["ARBOL"]);
  assert.deepEqual(p.palabrasDeNombre("Año nuevo"), ["ANO", "NUEVO"]);
  assert.deepEqual(p.palabrasDeNombre("Buscar (Ctrl+Shift+F)"), ["BUSCAR"]);
  assert.deepEqual(p.palabrasDeNombre("Estado del proyecto.md"), ["ESTADO", "PROYECTO", "MD"]);
  assert.deepEqual(p.palabrasDeNombre("2026-11-06"), []);
  assert.deepEqual(p.palabrasDeNombre("× ⋯ +"), []);
  // Si todas son vacías, se quedan.
  assert.deepEqual(p.palabrasDeNombre("A"), ["A"]);
});

test("una inicial sola es la etiqueta: Explorador E, Buscar B", () => {
  assert.deepEqual(p.etiquetasPorNombre(["Explorador", "Buscar", "Calendario"]), ["E", "B", "C"]);
});

test("si chocan, una segunda letra significativa y ninguna se queda con la sola", () => {
  assert.deepEqual(p.etiquetasPorNombre(["Explorador", "Esporas", "Buscar"]), ["EX", "ES", "B"]);
  // La inicial de la segunda palabra va primero.
  assert.deepEqual(p.etiquetasPorNombre(["Nueva nota", "Nueva carpeta"]), ["NN", "NC"]);
  // Los artículos no cuentan: «el panel» da la P.
  assert.deepEqual(p.etiquetasPorNombre(["Abrir el panel", "Abrir la ayuda"]), ["AP", "AA"]);
  // Nombres iguales: cada uno toma la siguiente letra libre.
  assert.deepEqual(p.etiquetasPorNombre(["Cerrar", "Cerrar", "Cerrar"]), ["CE", "CR", "CA"]);
});

test("las tildes no cambian la letra y se usan la I y la O", () => {
  assert.deepEqual(p.etiquetasPorNombre(["Índice", "Órbita", "Ñandú"]), ["I", "O", "N"]);
  assert.ok(p.ALFABETO_NOMBRES.includes("I") && p.ALFABETO_NOMBRES.includes("O"));
  assert.equal(p.letraDeCode("KeyI", p.ALFABETO_NOMBRES), "I");
  assert.equal(new Set(p.ALFABETO_NOMBRES).size, 26);
});

test("sin nombre útil: las iniciales que nadie usó, con el esquema de siempre", () => {
  const l = p.etiquetasPorNombre(["Explorador", "", null, "×", "Buscar"]);
  assert.equal(l[0], "E");
  assert.equal(l[4], "B");
  for (const e of l.slice(1, 4)) assert.ok(!"EB".includes(e[0]), e);
  assert.deepEqual(l.slice(1, 4), ["A", "S", "D"]);
  assert.ok(sinPrefijos(l));
  // Todo sin nombre: igual que antes.
  assert.deepEqual(p.etiquetasPorNombre(["", "", ""]), ["A", "S", "D"]);
});

test("sin iniciales libres para los sin nombre: todas al esquema de siempre", () => {
  const nombres = [...p.ALFABETO_NOMBRES].map((c) => c + "x");
  const l = p.etiquetasPorNombre([...nombres, "", ""]);
  assert.deepEqual(l, p.etiquetasPistas(nombres.length + 2));
});

test("muchos nombres: únicas, sin prefijos y estables", () => {
  const palabras = ["Explorador", "Esporas", "Estado", "Buscar", "Bandeja", "Calendario", "Cerrar", "Cerrar",
    "Nueva nota", "Nueva carpeta", "", "Índice", "Archivo", "Árbol", "Abrir el panel de búsqueda", "×"];
  const nombres = Array.from({ length: 300 }, (_, i) => palabras[i % palabras.length] + (i % 7 ? "" : " extra"));
  for (const lista of [palabras, nombres, nombres.slice(0, 60)]) {
    const l = p.etiquetasPorNombre(lista);
    assert.equal(l.length, lista.length);
    assert.equal(new Set(l).size, l.length, "repetidas");
    assert.ok(sinPrefijos(l), "prefijos");
    assert.ok(l.every((e) => /^[A-Z]+$/.test(e)));
    assert.deepEqual(p.etiquetasPorNombre(lista), l, "no es estable");
  }
  // Un grupo más grande que el alfabeto: tres letras, todas con su inicial.
  const muchas = Array.from({ length: 40 }, () => "Explorador");
  const l = p.etiquetasPorNombre(muchas);
  assert.ok(l.every((e) => e.length === 3 && e[0] === "E"));
  assert.ok(sinPrefijos(l));
});

// ── el nombre junto al código ─────────────────────────────────────────────

test("muestra texto: dos letras o números; un ícono, un signo o una letra suelta, no", () => {
  for (const t of ["Estado del proyecto", "Ir", "12", "Nota 1"]) assert.equal(p.muestraTexto(t), true, t);
  for (const t of ["", null, undefined, "  ", "×", "+", "⋯", "🔍", "B", "▸ ", "· ·"]) {
    assert.equal(p.muestraTexto(t), false, String(t));
  }
});

test("el nombre se limpia y se recorta con «…»", () => {
  assert.equal(p.recortarNombre("Buscar (Ctrl+Shift+F)"), "Buscar");
  assert.equal(p.recortarNombre("  Explorador  "), "Explorador");
  const largo = p.recortarNombre("Abrir el panel de búsqueda global del vault");
  assert.equal([...largo].length <= p.LARGO_NOMBRE_PISTA, true);
  assert.ok(largo.endsWith("…"));
  assert.equal(p.recortarNombre("(solo paréntesis)"), "(solo paréntesis)");
});

const caja = (left, top, right, bottom) => ({ left, top, right, bottom });

test("ubicar nombres: arriba si cabe, abajo si no, y si no, solo el código", () => {
  // Dos íconos en fila: el nombre del primero pisaría el código del segundo.
  const pistas = [
    { codigo: caja(0, 0, 20, 16), alternativas: [caja(0, 0, 90, 16), caja(0, 30, 90, 46)], activa: true },
    { codigo: caja(40, 0, 60, 16), alternativas: [caja(40, 0, 130, 16), caja(40, 30, 130, 46)], activa: true },
  ];
  // El primero baja; el segundo arriba cabe (su nombre no pisa nada).
  assert.deepEqual(p.ubicarNombres(pistas), [1, 0]);
  // Sin lugar en ninguna parte: solo el código.
  const tapada = [
    { codigo: caja(0, 0, 20, 16), alternativas: [caja(0, 0, 90, 16)], activa: true },
    { codigo: caja(30, 0, 50, 16), alternativas: [], activa: true },
  ];
  assert.deepEqual(p.ubicarNombres(tapada), [null, null]);
  // La que estorbaba se atenúa (ya no coincide): ahora cabe.
  tapada[1].activa = false;
  assert.deepEqual(p.ubicarNombres(tapada), [0, null]);
  // Una atenuada no muestra su nombre.
  assert.deepEqual(p.ubicarNombres([{ ...tapada[0], activa: false }]), [null]);
});

test("ubicar nombres: dos nombres no se pisan entre sí", () => {
  const pistas = [
    { codigo: caja(0, 0, 20, 16), alternativas: [caja(0, 0, 100, 16)], activa: true },
    { codigo: caja(0, 100, 20, 116), alternativas: [caja(0, 100, 100, 116), caja(0, 8, 100, 24)], activa: true },
  ];
  assert.deepEqual(p.ubicarNombres(pistas), [0, 0]);
  pistas[1].alternativas = [caja(0, 8, 100, 24)];
  assert.deepEqual(p.ubicarNombres(pistas), [0, null]);
});

// ── el orden ──────────────────────────────────────────────────────────────

const en = (id, left, top) => ({ id, caja: { left, top, right: left + 20, bottom: top + 20 } });

test("de arriba-izquierda a abajo-derecha, por renglones", () => {
  const items = [en("abajo", 0, 100), en("der", 200, 10), en("izq", 10, 12), en("medio", 100, 8)];
  assert.deepEqual(
    p.ordenarPorPosicion(items).map((x) => x.id),
    ["izq", "medio", "der", "abajo"],
  );
});

test("un par de píxeles de diferencia no cambia el renglón; más que la tolerancia, sí", () => {
  const items = [en("b", 50, 3), en("a", 0, 0)];
  assert.deepEqual(p.ordenarPorPosicion(items).map((x) => x.id), ["a", "b"]);
  const lejos = [en("b", 0, 30), en("a", 50, 0)];
  assert.deepEqual(p.ordenarPorPosicion(lejos).map((x) => x.id), ["a", "b"]);
});

// ── escribir una etiqueta ─────────────────────────────────────────────────

test("las letras se reconocen por posición, solo las del alfabeto", () => {
  assert.equal(p.letraDeCode("KeyA"), "A");
  assert.equal(p.letraDeCode("KeyI"), null);
  assert.equal(p.letraDeCode("KeyO"), null);
  assert.equal(p.letraDeCode("Digit1"), null);
  assert.equal(p.letraDeCode("Semicolon"), null);
});

test("filtrar por prefijo", () => {
  const l = ["AA", "AS", "SA", "SS"];
  assert.deepEqual(p.filtrarPorPrefijo(l, ""), [0, 1, 2, 3]);
  assert.deepEqual(p.filtrarPorPrefijo(l, "S"), [2, 3]);
  assert.deepEqual(p.filtrarPorPrefijo(l, "SA"), [2]);
  assert.deepEqual(p.filtrarPorPrefijo(l, "D"), []);
});

test("escribir letra a letra: sigue, activa, o ignora lo que no lleva a nada", () => {
  const l = ["AA", "AS", "SA", "SS"];
  assert.deepEqual(p.escribirLetra(l, "", "S"), { tipo: "seguir", escrito: "S", coinciden: [2, 3] });
  assert.deepEqual(p.escribirLetra(l, "S", "A"), { tipo: "activar", escrito: "SA", indice: 2 });
  assert.deepEqual(p.escribirLetra(l, "S", "D"), { tipo: "ignorar", escrito: "S" });
  assert.deepEqual(p.escribirLetra(l, "", "D"), { tipo: "ignorar", escrito: "" });
  assert.deepEqual(p.escribirLetra(["A", "S"], "", "S"), { tipo: "activar", escrito: "S", indice: 1 });
  assert.equal(p.borrarLetra("SA"), "S");
  assert.equal(p.borrarLetra(""), "");
});

// ── qué se hace con cada objetivo ─────────────────────────────────────────

test("enlaces, botones, pestañas, opciones y casillas: clic; con Shift, solo foco", () => {
  for (const d of [
    { etiqueta: "A" },
    { etiqueta: "BUTTON" },
    { etiqueta: "DIV", rol: "tab" },
    { etiqueta: "LI", rol: "option" },
    { etiqueta: "TR" },
    { etiqueta: "SUMMARY" },
    { etiqueta: "INPUT", tipo: "checkbox" },
    { etiqueta: "INPUT", tipo: "radio" },
    { etiqueta: "INPUT", tipo: "button" },
  ]) {
    assert.equal(p.accionDePista(d), "clic", JSON.stringify(d));
    assert.equal(p.accionDePista(d, true), "foco", JSON.stringify(d));
  }
});

test("campos de texto, desplegables y lo editable: foco (modo escribir)", () => {
  for (const d of [
    { etiqueta: "INPUT" },
    { etiqueta: "INPUT", tipo: "text" },
    { etiqueta: "INPUT", tipo: "search" },
    { etiqueta: "INPUT", tipo: "range" },
    { etiqueta: "TEXTAREA" },
    { etiqueta: "SELECT" },
    { etiqueta: "DIV", editable: true },
  ]) {
    assert.equal(p.accionDePista(d), "foco", JSON.stringify(d));
    assert.equal(p.accionDePista(d, true), "foco", JSON.stringify(d));
  }
});

test("un iframe es el marco entero; las marcas del DOM mandan", () => {
  assert.equal(p.accionDePista({ etiqueta: "IFRAME" }), "marco");
  assert.equal(p.accionDePista({ etiqueta: "DIV", marca: "consola" }), "consola");
  assert.equal(p.accionDePista({ etiqueta: "CANVAS", marca: "documento" }), "documento");
  assert.equal(p.accionDePista({ etiqueta: "DIV", marca: "puntero" }), "puntero");
  assert.equal(p.accionDePista({ etiqueta: "DIV", editable: true, marca: "foco" }), "foco");
  assert.equal(p.accionDePista({ etiqueta: "DIV", marca: "clic" }, true), "foco");
  // Una marca desconocida no inventa una acción: se decide por el elemento.
  assert.equal(p.accionDePista({ etiqueta: "BUTTON", marca: "volar" }), "clic");
});

// ── el comando ────────────────────────────────────────────────────────────

test("pistas.mostrar: F10, en captura, sin tecla reservada, y sale de la consola", () => {
  const c = COMANDOS_APP.find((x) => x.id === "pistas.mostrar");
  assert.ok(c, "no existe pistas.mostrar");
  assert.equal(at.textoAtajo(c.atajos[0]), "F10");
  assert.equal(c.enCaptura, true);
  for (const a of c.atajos) assert.equal(at.reservaQueChoca(a, c.id), null);
  assert.equal(at.problemaDeAtajo(c.atajos[0]), null);
  assert.equal(reg.comandoParaTecla(tecla("F10"), COMANDOS_APP, false, "captura")?.id, "pistas.mostrar");
  assert.equal(reg.comandoParaTecla(tecla("F10"), COMANDOS_APP, false, "burbuja"), null);
  // Shift+F10 es el menú contextual de una pestaña o del árbol: no son las pistas.
  assert.equal(reg.comandoParaTecla(tecla("F10", { shiftKey: true }), COMANDOS_APP, false, "captura"), null);
  assert.equal(consola.teclaSaleDeLaConsola(tecla("F10")), true);
  assert.ok(consola.FIJOS_EN_LA_CONSOLA.has("pistas.mostrar"));
  assert.deepEqual(reg.validarComandos(COMANDOS_APP), []);
});

// ── F10 por sección y saltar tecleando (rediseño del 2026-11-06) ──────────

const tecleo = await import(await fuente("../lib/teclado/tecleo.ts"));

test("qué pistas muestra F10 según dónde esté el foco", () => {
  const base = { hayModal: false, enEmergente: false, nivelDeSecciones: false, enSeccion: false };
  assert.equal(p.alcanceDePistas({ ...base, hayModal: true, nivelDeSecciones: true }), "modal");
  assert.equal(p.alcanceDePistas({ ...base, enEmergente: true, enSeccion: true }), "emergente");
  assert.equal(p.alcanceDePistas({ ...base, nivelDeSecciones: true }), "secciones");
  assert.equal(p.alcanceDePistas({ ...base, enSeccion: true }), "seccion");
  assert.equal(p.alcanceDePistas(base), "global");
  // Grupos (el explorador): dentro de uno, solo lo suyo; en su título, los de la sección.
  assert.equal(p.alcanceDePistas({ ...base, enSeccion: true, enGrupo: true }), "grupo");
  assert.equal(p.alcanceDePistas({ ...base, enSeccion: true, enGrupo: false }), "seccion");
  assert.equal(p.alcanceDePistas({ ...base, nivelDeSecciones: true, enGrupo: true }), "secciones");
});

test("el título de un grupo elige el grupo, no lo pliega", () => {
  assert.equal(p.accionDePista({ etiqueta: "BUTTON", marca: "grupo" }), "grupo");
  assert.equal(p.accionDePista({ etiqueta: "BUTTON", marca: "grupo" }, true), "grupo");
  assert.equal(p.accionDePista({ etiqueta: "DIV", marca: "grupo" }), "grupo");
});

test("los elementos de una lista no llevan pista; los controles sí", () => {
  for (const rol of ["treeitem", "tab", "option", "row", "gridcell"]) assert.equal(p.esElementoDeLista({ rol }), true, rol);
  assert.equal(p.esElementoDeLista({ rol: null, enLista: true }), true, "resultados, Esporas, papelera");
  assert.equal(p.esElementoDeLista({ enGrilla: true }), true, "días del calendario");
  assert.equal(p.esElementoDeLista({ enFilaDeTabla: true }), true, "filas de una tabla");
  assert.equal(p.esElementoDeLista({ tarjeta: true }), true, "tarjetas del lienzo");
  assert.equal(p.esElementoDeLista({ nodo: true }), true, "nodos del grafo");
  for (const rol of [null, "button", "checkbox", "switch", "menuitem", "separator"]) {
    assert.equal(p.esElementoDeLista({ rol }), false, String(rol));
  }
});

test("una pista por sección, con su nombre: casi todas de una letra", () => {
  const nombres = [
    p.nombreDeSeccion({ zona: "superior" }),
    p.nombreDeSeccion({ zona: "rail" }),
    p.nombreDeSeccion({ zona: "izquierda", titulo: "Explorador" }),
    p.nombreDeSeccion({ zona: "panel", titulo: "  Ideas  " }),
    p.nombreDeSeccion({ zona: "panel", titulo: "Mapa de documentacion" }),
    p.nombreDeSeccion({ zona: "lateral" }),
    p.nombreDeSeccion({ zona: "estado" }),
  ];
  assert.deepEqual(nombres, ["Ventana", "Rail", "Explorador", "Ideas", "Mapa de documentacion", "Conexiones", "Barra de estado"]);
  assert.equal(p.nombreDeSeccion({ zona: "izquierda" }), "Panel izquierdo");
  assert.equal(p.nombreDeSeccion({ zona: "panel", titulo: "" }), "Panel vacío");
  const etiquetas = p.etiquetasPorNombre(nombres);
  assert.equal(new Set(etiquetas).size, etiquetas.length);
  assert.equal(etiquetas.filter((e) => e.length === 1).length, nombres.length, etiquetas.join(" "));
  // Elegir una sección es su propia acción.
  assert.equal(p.accionDePista({ etiqueta: "section", marca: "seccion" }), "seccion");
  assert.equal(p.accionDePista({ etiqueta: "section", marca: "seccion" }, true), "seccion");
});

test("saltar tecleando: acumula si se teclea rápido, sin tildes ni mayúsculas", () => {
  const t1 = tecleo.acumularTecleo(null, "N", 1000);
  assert.deepEqual(t1, { texto: "n", momento: 1000 });
  const t2 = tecleo.acumularTecleo(t1, "o", 1000 + tecleo.ESPERA_TECLEO);
  assert.equal(t2.texto, "no");
  const t3 = tecleo.acumularTecleo(t2, "x", t2.momento + tecleo.ESPERA_TECLEO + 1);
  assert.equal(t3.texto, "x", "pasado el tiempo, empieza de nuevo");
  assert.equal(tecleo.normalizarNombre("  Índice"), "indice");
});

test("saltar tecleando: al siguiente que empieza así, con vuelta", () => {
  const nombres = ["Bandeja", "Notas", "nube", "Índice", "Norte", "Zeta"];
  // Una letra: desde el siguiente al actual; repetida, recorre.
  assert.equal(tecleo.saltoPorTecleo(nombres, 0, "n"), 1);
  assert.equal(tecleo.saltoPorTecleo(nombres, 1, "n"), 2);
  assert.equal(tecleo.saltoPorTecleo(nombres, 4, "n"), 1, "con vuelta");
  assert.equal(tecleo.saltoPorTecleo(nombres, 1, "nn"), 2, "la misma letra repetida recorre");
  // Varias letras: desde el actual, que sirve si ya coincide.
  assert.equal(tecleo.saltoPorTecleo(nombres, 1, "no"), 1);
  assert.equal(tecleo.saltoPorTecleo(nombres, 1, "nor"), 4);
  assert.equal(tecleo.saltoPorTecleo(nombres, 0, "ind"), 3, "sin tildes");
  assert.equal(tecleo.saltoPorTecleo(nombres, 0, "q"), null);
  assert.equal(tecleo.saltoPorTecleo([], 0, "a"), null);
  // Sin elemento actual (-1): desde el primero.
  assert.equal(tecleo.saltoPorTecleo(nombres, -1, "b"), 0);
});
