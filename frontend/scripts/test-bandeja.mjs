// Test headless de la Bandeja y la captura rápida (`FUN-L-33`): el formato
// (`lib/bandeja.ts`: agregar al final bajo el encabezado del día, nota o tarea,
// contar las entradas sin procesar, validar la ruta) y la protección
// (`lib/bandejaRuta.ts`: no se renombra, no se mueve, no se elimina, tampoco con
// su carpeta). Los módulos se transpilan en el momento, como en
// `scripts/test-mcp-archivos.mjs`; la preferencia se reemplaza por un store
// falso para elegir la ruta de la Bandeja en cada caso.
//
//   node --test scripts/test-bandeja.mjs
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
const b = await import(BANDEJA);

// La preferencia, falsa: `globalThis.__rutaBandeja` es lo que «configuró» el usuario.
const PREFS = aUrl(
  "export const usePreferencesStore = { getState: () => ({ prefs: { rutaBandeja: globalThis.__rutaBandeja } }) };",
);
const ruta = await import(
  await fuente("../lib/bandejaRuta.ts", { "@/lib/bandeja": BANDEJA, "@/stores/preferencesStore": PREFS })
);

// El 5 de noviembre de 2026 a las 09:40, hora local.
const HOY = new Date(2026, 10, 5, 9, 40);
const nota = (texto) => ({ tipo: "nota", texto });
const tarea = (texto) => ({ tipo: "tarea", texto });

// ── la captura ─────────────────────────────────────────────────────────────

test("con [] o [ ] al principio es tarea; sin eso, nota", () => {
  assert.deepEqual(b.interpretarCaptura("Llamar a Laura"), nota("Llamar a Laura"));
  assert.deepEqual(b.interpretarCaptura("[] Renovar el dominio"), tarea("Renovar el dominio"));
  assert.deepEqual(b.interpretarCaptura("[ ] Renovar el dominio"), tarea("Renovar el dominio"));
  assert.deepEqual(b.interpretarCaptura("  []Pagar"), tarea("Pagar"));
  // El [] en el medio no la vuelve tarea.
  assert.deepEqual(b.interpretarCaptura("Ver [] después"), nota("Ver [] después"));
  // [x] no es el atajo de tarea: queda como texto.
  assert.deepEqual(b.interpretarCaptura("[x] algo"), nota("[x] algo"));
});

test("vacío o solo [] no se anota; los saltos de línea se vuelven espacios", () => {
  assert.equal(b.interpretarCaptura(""), null);
  assert.equal(b.interpretarCaptura("   "), null);
  assert.equal(b.interpretarCaptura("[]"), null);
  assert.equal(b.interpretarCaptura("[ ]   "), null);
  assert.deepEqual(b.interpretarCaptura("una\nlínea\r\nsola"), nota("una línea sola"));
});

test("la etiqueta de la cajita sigue a lo que se escribe", () => {
  assert.equal(b.esCapturaDeTarea("[]"), true);
  assert.equal(b.esCapturaDeTarea("[ ] x"), true);
  assert.equal(b.esCapturaDeTarea("x"), false);
  assert.equal(b.esCapturaDeTarea("["), false);
});

test("la línea lleva la hora local y la casilla si es tarea", () => {
  assert.equal(b.lineaDeEntrada(nota("Idea"), HOY), "- 09:40 Idea");
  assert.equal(b.lineaDeEntrada(tarea("Pagar"), HOY), "- [ ] 09:40 Pagar");
  assert.equal(b.fechaDelDia(new Date(2026, 0, 3, 23, 5)), "2026-01-03");
  assert.equal(b.horaDeEntrada(new Date(2026, 0, 3, 7, 5)), "07:05");
});

// ── agregar al final ───────────────────────────────────────────────────────

test("archivo vacío: el encabezado del día y la entrada", () => {
  assert.equal(b.agregarEntrada("", nota("Idea"), HOY), "## 2026-11-05\n- 09:40 Idea\n");
  // Solo espacios cuenta como vacío: no queda una línea en blanco arriba.
  assert.equal(b.agregarEntrada("\n\n", nota("Idea"), HOY), "## 2026-11-05\n- 09:40 Idea\n");
});

test("el día ya abierto al final: la entrada va debajo, sin repetir el encabezado", () => {
  const antes = "## 2026-11-05\n- 08:00 Primera\n";
  assert.equal(
    b.agregarEntrada(antes, tarea("Segunda"), HOY),
    "## 2026-11-05\n- 08:00 Primera\n- [ ] 09:40 Segunda\n",
  );
});

test("otro día: se abre el de hoy al final, separado por una línea en blanco", () => {
  const antes = "## 2026-11-04\n- 18:12 Ayer\n";
  assert.equal(
    b.agregarEntrada(antes, nota("Hoy"), HOY),
    "## 2026-11-04\n- 18:12 Ayer\n\n## 2026-11-05\n- 09:40 Hoy\n",
  );
});

test("lo que había no se reescribe: el resultado empieza con el contenido anterior", () => {
  const casos = [
    "# Mi bandeja\n\nTexto libre, sin formato\n* algo\n",
    "sin salto final",
    "## 2026-11-05\n- 08:00 x\n\n## Procesado\n- [x] ya\n",
    "---\ntags: [inbox]\n---\n",
    "linea\r\notra\r\n",
  ];
  for (const antes of casos) {
    const despues = b.agregarEntrada(antes, nota("Nueva"), HOY);
    const base = antes.endsWith("\n") ? antes : antes + "\n";
    assert.ok(despues.startsWith(base), JSON.stringify(antes));
    assert.ok(despues.trimEnd().endsWith("- 09:40 Nueva"), JSON.stringify(despues));
  }
});

test("otro formato a mano: el día de hoy existe pero no es el último encabezado → se abre de nuevo al final", () => {
  const antes = "## 2026-11-05\n- 08:00 x\n\n## Procesado\n- [x] ya\n";
  assert.equal(
    b.agregarEntrada(antes, nota("Nueva"), HOY),
    antes + "\n## 2026-11-05\n- 09:40 Nueva\n",
  );
});

test("sin salto final: se le pone uno, y la línea en blanco antes del encabezado", () => {
  assert.equal(b.agregarEntrada("texto", nota("Nueva"), HOY), "texto\n\n## 2026-11-05\n- 09:40 Nueva\n");
});

test("un encabezado dentro de un bloque de código no cuenta como el del día", () => {
  const antes = "## 2026-11-04\n```\n## 2026-11-05\n```\n";
  assert.equal(
    b.agregarEntrada(antes, nota("Hoy"), HOY),
    antes + "\n## 2026-11-05\n- 09:40 Hoy\n",
  );
});

test("un archivo con CRLF sigue con CRLF", () => {
  const antes = "## 2026-11-05\r\n- 08:00 x\r\n";
  assert.equal(b.agregarEntrada(antes, nota("y"), HOY), "## 2026-11-05\r\n- 08:00 x\r\n- 09:40 y\r\n");
});

test("varias capturas seguidas, el mismo día y al siguiente", () => {
  let t = "";
  t = b.agregarEntrada(t, nota("Uno"), HOY);
  t = b.agregarEntrada(t, tarea("Dos"), new Date(2026, 10, 5, 10, 5));
  t = b.agregarEntrada(t, nota("Tres"), new Date(2026, 10, 6, 8, 0));
  assert.equal(
    t,
    "## 2026-11-05\n- 09:40 Uno\n- [ ] 10:05 Dos\n\n## 2026-11-06\n- 08:00 Tres\n",
  );
});

// ── el contador ────────────────────────────────────────────────────────────

test("cuenta entradas, no días: notas y tareas pendientes", () => {
  const t = "## 2026-11-04\n- 18:12 Idea\n\n## 2026-11-05\n- [ ] 09:40 Pedir el Excel\n- 11:30 Dato\n";
  assert.equal(b.contarEntradas(t), 3);
});

test("las tareas hechas y canceladas no cuentan; las demás, sí", () => {
  const t = [
    "- [x] hecha",
    "- [X] hecha",
    "- [-] cancelada",
    "- [ ] pendiente",
    "- [/] en curso",
    "- [>] pospuesta",
    "- [!] importante",
    "- [?] pregunta",
  ].join("\n");
  assert.equal(b.contarEntradas(t), 5);
});

test("vacía, sin ítems o con solo hechas: cero (el contador no se muestra)", () => {
  assert.equal(b.contarEntradas(""), 0);
  assert.equal(b.contarEntradas("## 2026-11-05\n\nTexto suelto\n"), 0);
  assert.equal(b.contarEntradas("- [x] ya\n- [-] no\n"), 0);
});

test("no cuenta lo del frontmatter, los bloques de código, las líneas horizontales ni ítems vacíos", () => {
  const t = "---\ntags:\n  - inbox\n---\n- uno\n```\n- en código\n```\n* * *\n- \n1. dos\n  - tres anidado\n";
  assert.equal(b.contarEntradas(t), 3);
});

// ── la ruta ────────────────────────────────────────────────────────────────

test("la ruta configurada: relativa, con .md, sin salir del vault ni entrar a lo oculto", () => {
  assert.equal(b.normalizarRutaBandeja("Bandeja.md"), "Bandeja.md");
  assert.equal(b.normalizarRutaBandeja("Bandeja"), "Bandeja.md");
  assert.equal(b.normalizarRutaBandeja(" Entrada\\Bandeja.MD "), "Entrada/Bandeja.md");
  assert.equal(b.normalizarRutaBandeja("Entrada//Mi bandeja"), "Entrada/Mi bandeja.md");
  assert.equal(b.normalizarRutaBandeja("Notas v2.1"), "Notas v2.1.md");
  for (const mala of ["", "  ", "/Bandeja.md", "C:\\x\\Bandeja.md", "../Bandeja.md", "a/./b.md", ".mycelium/Bandeja.md", "Bandeja.txt", "Ban:deja.md", ".md"]) {
    assert.equal(b.normalizarRutaBandeja(mala), null, mala);
  }
});

test("la carpeta renombrada o movida se lleva la ruta", () => {
  assert.equal(b.rutaTrasMoverCarpeta("Entrada/Bandeja.md", "Entrada", "Archivo/Entrada"), "Archivo/Entrada/Bandeja.md");
  assert.equal(b.rutaTrasMoverCarpeta("Entrada/Sub/Bandeja.md", "Entrada", "Inbox"), "Inbox/Sub/Bandeja.md");
  assert.equal(b.rutaTrasMoverCarpeta("Bandeja.md", "Entrada", "Inbox"), null);
  // Un prefijo que no es carpeta entera no cuenta.
  assert.equal(b.rutaTrasMoverCarpeta("Entradas/Bandeja.md", "Entrada", "Inbox"), null);
});

// ── la protección ──────────────────────────────────────────────────────────

test("sin configurar, la Bandeja es Bandeja.md (sin distinguir mayúsculas)", () => {
  globalThis.__rutaBandeja = undefined;
  assert.equal(ruta.rutaBandeja(), "Bandeja.md");
  assert.equal(ruta.esBandeja("Bandeja.md"), true);
  assert.equal(ruta.esBandeja("bandeja.md"), true);
  assert.equal(ruta.esBandeja("Otra/Bandeja.md"), false);
  // Una ruta configurada que no sirve cae a la de defecto.
  globalThis.__rutaBandeja = "../fuera.md";
  assert.equal(ruta.rutaBandeja(), "Bandeja.md");
});

test("la Bandeja no se renombra, no se mueve, no se elimina; otra nota, sí", () => {
  globalThis.__rutaBandeja = "Bandeja.md";
  assert.throws(() => ruta.protegerBandeja("Bandeja.md", "renombrar"), /no se renombra/);
  assert.throws(() => ruta.protegerBandeja("Bandeja.md", "mover"), /no se mueve/);
  assert.throws(() => ruta.protegerBandeja("Bandeja.md", "eliminar"), /no se elimina/);
  assert.throws(() => ruta.protegerBandeja("BANDEJA.md", "eliminar"), (e) => e.name === "BandejaProtegida");
  assert.doesNotThrow(() => ruta.protegerBandeja("Notas/Bandeja.md", "eliminar"));
  assert.doesNotThrow(() => ruta.protegerBandeja("Plan.md", "renombrar"));
});

test("con otra ruta configurada, la protegida es esa", () => {
  globalThis.__rutaBandeja = "Entrada/Bandeja";
  assert.equal(ruta.rutaBandeja(), "Entrada/Bandeja.md");
  assert.throws(() => ruta.protegerBandeja("Entrada/Bandeja.md", "mover"));
  assert.doesNotThrow(() => ruta.protegerBandeja("Bandeja.md", "mover"));
});

test("la carpeta que la contiene no se elimina; las demás, sí", () => {
  globalThis.__rutaBandeja = "Entrada/Sub/Bandeja.md";
  assert.throws(() => ruta.protegerCarpetaConBandeja("Entrada"), /contiene la Bandeja/);
  assert.throws(() => ruta.protegerCarpetaConBandeja("Entrada/Sub"), /contiene la Bandeja/);
  assert.doesNotThrow(() => ruta.protegerCarpetaConBandeja("Entradas"));
  assert.doesNotThrow(() => ruta.protegerCarpetaConBandeja("Otra"));
  globalThis.__rutaBandeja = "Bandeja.md";
  assert.doesNotThrow(() => ruta.protegerCarpetaConBandeja("Entrada"));
});

// ── el lugar común ─────────────────────────────────────────────────────────

test("el store protege renombrar, mover y eliminar (el lugar común del explorador, el título y el MCP)", async () => {
  // No se puede cargar el store sin Tauri: se comprueba que cada método pasa
  // por la protección antes de tocar nada, y que el MCP la rechaza antes de
  // medir el alcance.
  const store = await readFile(fileURLToPath(new URL("../stores/vaultStore.ts", import.meta.url)), "utf8");
  const cuerpo = (metodo) => {
    const i = store.indexOf(`async ${metodo}(`);
    assert.ok(i >= 0, metodo);
    return store.slice(i, store.indexOf("\n      },", i));
  };
  assert.match(cuerpo("renameNota"), /protegerBandeja\(id, "renombrar"\)/);
  assert.match(cuerpo("moveNota"), /protegerBandeja\(id, "mover"\)/);
  assert.match(cuerpo("deleteNota"), /protegerBandeja\(id, "eliminar"\)/);
  assert.match(cuerpo("deleteCarpeta"), /protegerCarpetaConBandeja\(id\)/);
  // Antes de la llamada a la capa de datos, no después.
  for (const [m, p] of [["renameNota", "protegerBandeja"], ["deleteNota", "protegerBandeja"], ["deleteCarpeta", "protegerCarpetaConBandeja"]]) {
    const c = cuerpo(m);
    const escribe = c.indexOf("await api");
    assert.ok(escribe > 0 && c.indexOf(p) < escribe, `${m}: la protección va antes de escribir`);
  }

  const mcp = await readFile(fileURLToPath(new URL("../lib/mcpArchivos.ts", import.meta.url)), "utf8");
  for (const accion of ["renombrar", "mover", "borrar"]) {
    assert.match(mcp, new RegExp(`rechazarBandeja\\(a, "${accion}"\\)`), accion);
  }
});

// ── la Bandeja personal y el destino (Parte B) ─────────────────────────────

/** Un `localStorage` en memoria. */
function almacen(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), datos };
}

test("el destino: por defecto el vault; recuerda el último; una preferencia fija manda", () => {
  assert.equal(b.destinoInicial(null), "vault");
  const a = almacen();
  assert.equal(b.destinoInicial(a), "vault");
  b.recordarDestino(a, "personal");
  assert.equal(a.datos.get(b.CLAVE_DESTINO_ULTIMO), "personal");
  assert.equal(b.destinoInicial(a), "personal");
  // Un valor que no se entiende no rompe: vuelve al vault.
  assert.equal(b.destinoInicial(almacen({ [b.CLAVE_DESTINO_ULTIMO]: "otra" })), "vault");
  // Fijo en Configuración: gana sobre el último.
  a.setItem(b.CLAVE_DESTINO_PREFERENCIA, "vault");
  assert.equal(b.leerPreferenciaDestino(a), "vault");
  assert.equal(b.destinoInicial(a), "vault");
  assert.equal(b.leerPreferenciaDestino(almacen({ [b.CLAVE_DESTINO_PREFERENCIA]: "x" })), "ultimo");
  // Sin almacenamiento que escriba, recordar no rompe la cajita.
  b.recordarDestino({ getItem: () => null, setItem: () => { throw new Error("cuota"); } }, "vault");
});

test("Tab alterna entre los dos destinos", () => {
  assert.equal(b.otroDestino("vault"), "personal");
  assert.equal(b.otroDestino("personal"), "vault");
});

test("el aviso dice adónde fue", () => {
  assert.equal(b.textoAvisoCaptura(nota("x")), "Anotado en la Bandeja del vault");
  assert.equal(b.textoAvisoCaptura(tarea("x"), "vault"), "Tarea anotada en la Bandeja del vault");
  assert.equal(b.textoAvisoCaptura(nota("x"), "personal"), "Anotado en tu Bandeja personal");
  assert.equal(b.textoAvisoCaptura(tarea("x"), "personal"), "Tarea anotada en tu Bandeja personal");
});

// La capa de la Bandeja personal con los comandos de Rust falsos: un archivo en
// memoria con la misma regla de huellas que `bandeja_personal.rs`.
const { createHash } = await import("node:crypto");
const sha = (t) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
globalThis.__personal = { archivo: null, invocaciones: [], colarse: 0, avisos: [] };
const CORE = aUrl(`
const sha = ${sha.toString().replace("createHash", "globalThis.__crypto.createHash")};
export async function invoke(cmd, args) {
  const p = globalThis.__personal;
  p.invocaciones.push(cmd);
  if (cmd === "bandeja_personal_leer") {
    if (args.crear && p.archivo === null) p.archivo = "";
    return { contenido: p.archivo ?? "", existe: p.archivo !== null, ruta: "C:/datos/Bandeja personal.md" };
  }
  if (cmd === "bandeja_personal_guardar") {
    // Otra ventana anota entre la lectura y la escritura.
    if (p.colarse > 0) { p.colarse--; p.archivo = (p.archivo ?? "") + "- 08:00 de la otra ventana\\n"; }
    if (args.huellaEsperada !== null && p.archivo !== null) {
      const disco = sha(p.archivo);
      if (disco !== args.huellaEsperada && disco !== sha(args.contenido)) return { conflicto: true, huella: null };
    }
    p.archivo = args.contenido;
    return { conflicto: false, huella: sha(args.contenido) };
  }
  throw new Error("comando desconocido " + cmd);
}`);
globalThis.__crypto = { createHash };
const CONFLICTO = aUrl(`
export async function huellaDeTexto(t) {
  return globalThis.__crypto.createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
}`);
const ERRORES = await fuente("../lib/db/errors.ts");
const EVENTOS = aUrl(`
export const EVENTO_BANDEJA = "micelio:bandeja-anotada";
export function avisarRecarga(r) { globalThis.__personal.avisos.push(r); }`);
const PESTANAS_FALSO = aUrl(`export const BANDEJA_PERSONAL_ID = "bandeja:personal";`);
const personal = await import(
  await fuente("../lib/bandejaPersonal.ts", {
    "@tauri-apps/api/core": CORE,
    "@/lib/bandeja": BANDEJA,
    "@/lib/conflictoExterno": CONFLICTO,
    "@/lib/db/errors": ERRORES,
    "@/lib/eventos": EVENTOS,
    "@/lib/pestanas": PESTANAS_FALSO,
  })
);

test("anotar en la personal: la crea si falta, agrega al final y no la crea al solo contar", async () => {
  Object.assign(globalThis.__personal, { archivo: null, invocaciones: [], colarse: 0 });
  const r = await personal.leerBandejaPersonal();
  assert.equal(r.existe, false);
  assert.equal(globalThis.__personal.archivo, null, "leer sin crear no la crea");
  await personal.anotarEnBandejaPersonal(tarea("Renovar el dominio"), HOY);
  assert.equal(globalThis.__personal.archivo, "## 2026-11-05\n- [ ] 09:40 Renovar el dominio\n");
  await personal.anotarEnBandejaPersonal(nota("Otra cosa"), new Date(2026, 10, 5, 9, 41));
  assert.equal(b.contarEntradas(globalThis.__personal.archivo), 2);
});

test("anotar en la personal con otra ventana anotando a la vez: se reintenta y no se pisa nada", async () => {
  Object.assign(globalThis.__personal, { archivo: "- 07:00 lo que había\n", invocaciones: [], colarse: 2 });
  await personal.anotarEnBandejaPersonal(nota("lo mío"), HOY);
  const texto = globalThis.__personal.archivo;
  assert.ok(texto.startsWith("- 07:00 lo que había\n"));
  assert.equal(texto.match(/de la otra ventana/g).length, 2);
  assert.ok(texto.endsWith("- 09:40 lo mío\n"));
  // Tres guardados: dos en conflicto y el bueno.
  assert.equal(globalThis.__personal.invocaciones.filter((c) => c === "bandeja_personal_guardar").length, 3);
});

test("guardar la personal con una base vieja es un 409, como una nota (DEF-138)", async () => {
  Object.assign(globalThis.__personal, { archivo: "afuera", colarse: 0 });
  await assert.rejects(personal.guardarBandejaPersonal("mío", "base vieja"), (e) => e.status === 409);
  assert.equal(globalThis.__personal.archivo, "afuera");
  // Sin base (Quedarme con lo mío): escribe.
  await personal.guardarBandejaPersonal("mío", null);
  assert.equal(globalThis.__personal.archivo, "mío");
});

test("la personal no recibe rutas: los comandos de Rust no tienen parámetro de ruta", async () => {
  const rust = await readFile(fileURLToPath(new URL("../src-tauri/src/bandeja_personal.rs", import.meta.url)), "utf8");
  for (const cmd of ["bandeja_personal_leer", "bandeja_personal_guardar"]) {
    const i = rust.indexOf(`pub fn ${cmd}(`);
    assert.ok(i > 0, cmd);
    const firma = rust.slice(i, rust.indexOf(")", i));
    assert.doesNotMatch(firma, /ruta|path/i, `${cmd} no acepta rutas`);
  }
  const lib = await readFile(fileURLToPath(new URL("../src-tauri/src/lib.rs", import.meta.url)), "utf8");
  assert.match(lib, /bandeja_personal::bandeja_personal_leer/);
  assert.match(lib, /bandeja_personal::bandeja_personal_guardar/);
  // El dispatcher lleva su contenido a esos comandos y rechaza el resto.
  const api = await readFile(fileURLToPath(new URL("../lib/api.ts", import.meta.url)), "utf8");
  assert.match(api, /b === BANDEJA_PERSONAL_ID/);
  assert.match(api, /MOTIVO_PERSONAL_FUERA_DEL_VAULT/);
});
