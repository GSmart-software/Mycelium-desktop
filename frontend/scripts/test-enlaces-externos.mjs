// Test headless de qué se abre en el navegador y qué no (`FUN-S-20`, `DEF-101`).
//
// Lo que se prueba acá es sobre todo **la lista de esquemas**: una nota puede
// venir importada, escrita por otra persona o generada por una IA, y entregarle
// al sistema un `file://`, un `javascript:` o un protocolo registrado por otra
// aplicación es abrirle una puerta a cualquiera que consiga que abras una nota.
//
//   node --test scripts/test-enlaces-externos.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/enlacesExternos.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const {
  ESQUEMAS_PERMITIDOS,
  atenderClicEnEnlace,
  destinoDeUrlSuelta,
  destinoExterno,
  esEnlaceExterno,
  manejarClicDeEnlace,
} =
  await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

test("una página web es un enlace externo", () => {
  assert.equal(esEnlaceExterno("https://www.wikipedia.org/"), true);
  assert.equal(esEnlaceExterno("http://example.com/algo?x=1#y"), true);
  assert.equal(esEnlaceExterno("HTTPS://EJEMPLO.COM/"), true, "el esquema no distingue mayúsculas");
});

test("mailto también se abre: lo atiende el cliente de correo", () => {
  assert.equal(esEnlaceExterno("mailto:alguien@ejemplo.com"), true);
});

test("los esquemas peligrosos NO se abren", () => {
  // Es el corazón de la validación: entregarle esto al sistema es el problema.
  assert.equal(esEnlaceExterno("file:///C:/Windows/System32/cmd.exe"), false);
  assert.equal(esEnlaceExterno("javascript:alert(1)"), false);
  assert.equal(esEnlaceExterno("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(esEnlaceExterno("vbscript:msgbox(1)"), false);
  // Protocolos registrados por otras apps de Windows, que han sido vector real.
  assert.equal(esEnlaceExterno("ms-msdt:/id PCWDiagnostic"), false);
  assert.equal(esEnlaceExterno("search-ms:query=x"), false);
  assert.equal(esEnlaceExterno("smb://servidor/recurso"), false);
});

test("lo de adentro de Mycelium no es cosa de este módulo", () => {
  // Los atiende quien los puso: navegar a una nota, a una etiqueta o a un ancla.
  assert.equal(esEnlaceExterno("#wikilink:Otra%20nota"), false);
  assert.equal(esEnlaceExterno("#tag:proyecto"), false);
  assert.equal(esEnlaceExterno("#excalidraw"), false);
  assert.equal(esEnlaceExterno("#drawio"), false);
  assert.equal(esEnlaceExterno("#un-titulo-de-la-nota"), false);
});

test("una ruta relativa es del vault, no del navegador", () => {
  assert.equal(esEnlaceExterno("otra-nota.md"), false);
  assert.equal(esEnlaceExterno("./imagen.png"), false);
  assert.equal(esEnlaceExterno("../carpeta/archivo.pdf"), false);
  assert.equal(esEnlaceExterno("Carpeta/Nota"), false);
});

test("lo vacío y lo que no es texto no rompen nada", () => {
  assert.equal(esEnlaceExterno(""), false);
  assert.equal(esEnlaceExterno("   "), false);
  assert.equal(esEnlaceExterno(null), false);
  assert.equal(esEnlaceExterno(undefined), false);
});

test("destinoExterno normaliza y recorta espacios", () => {
  assert.equal(destinoExterno("  https://ejemplo.com  "), "https://ejemplo.com/");
  assert.equal(destinoExterno("no soy una url"), null);
});

test("la lista de esquemas permitidos es corta y explícita", () => {
  // Si alguien la amplía, que sea a propósito y quede en el diff.
  assert.deepEqual([...ESQUEMAS_PERMITIDOS], ["http:", "https:", "mailto:"]);
});

// ── El manejador compartido ─────────────────────────────────────────────────
//
// Es el que usan los CINCO sitios que atienden clics en enlaces. Lo que más
// importa: que corte la navegación. Sin `preventDefault()` la webview navega
// igual y vuelve `DEF-101`, que se lleva la app entera.

/** Un evento de mentira que anota si le cortaron la navegación. */
function eventoFalso(href) {
  return {
    cortado: false,
    preventDefault() {
      this.cortado = true;
    },
    target: {
      closest: (sel) => (sel === "a" ? { getAttribute: () => href } : null),
    },
  };
}

test("un enlace web se toma Y se corta la navegación", () => {
  const ev = eventoFalso("https://ejemplo.com/");
  assert.equal(manejarClicDeEnlace(ev), true);
  assert.equal(ev.cortado, true, "sin preventDefault vuelve DEF-101");
});

test("un wikilink NO se toma (lo atiende quien lo puso), pero SÍ se corta", () => {
  // DEF-160: un `<a>` nunca navega la webview por su cuenta.
  const ev = eventoFalso("#wikilink:Otra");
  assert.equal(manejarClicDeEnlace(ev), false);
  assert.equal(ev.cortado, true);
});

test("un esquema peligroso no se abre, y se corta igual: si no, la webview lo ejecuta", () => {
  // DEF-160: antes volvía false SIN preventDefault y `javascript:` se ejecutaba.
  for (const href of ["file:///C:/Windows/System32/cmd.exe", "javascript:alert(1)", "JaVaScRiPt:x", "vbscript:x"]) {
    const ev = eventoFalso(href);
    assert.equal(manejarClicDeEnlace(ev), false, href);
    assert.equal(ev.cortado, true, href);
  }
});

test("el href explícito gana: es como lo llama la vista en vivo", () => {
  // Ahí no hay `<a>`; el destino viaja en `data-href`.
  const ev = {
    cortado: false,
    preventDefault() {
      this.cortado = true;
    },
    target: null,
  };
  assert.equal(manejarClicDeEnlace(ev, "https://ejemplo.com/"), true);
  assert.equal(ev.cortado, true);
});

test("sin `<a>` y sin href explícito no pasa nada", () => {
  const ev = {
    cortado: false,
    preventDefault() {
      this.cortado = true;
    },
    target: { closest: () => null },
  };
  assert.equal(manejarClicDeEnlace(ev), false);
  assert.equal(ev.cortado, false);
});

// DEF-132: una dirección suelta en el texto (la que GFM reconoce sin corchetes)
// queda visible en vivo y se abre con un clic. A `www.` y a un correo les falta
// el esquema: se lo pone igual que GitHub.
test("una URL suelta se completa con su esquema", () => {
  assert.equal(destinoDeUrlSuelta("https://ejemplo.com/x"), "https://ejemplo.com/x");
  assert.equal(destinoDeUrlSuelta("www.ejemplo.com"), "https://www.ejemplo.com");
  assert.equal(destinoDeUrlSuelta("WWW.Ejemplo.com"), "https://WWW.Ejemplo.com");
  assert.equal(destinoDeUrlSuelta("alguien@ejemplo.com"), "mailto:alguien@ejemplo.com");
  assert.equal(destinoDeUrlSuelta("mailto:alguien@ejemplo.com"), "mailto:alguien@ejemplo.com");
  assert.equal(esEnlaceExterno(destinoDeUrlSuelta("www.ejemplo.com")), true);
  assert.equal(esEnlaceExterno(destinoDeUrlSuelta("alguien@ejemplo.com")), true);
});

// ── El manejador de las vistas de HTML renderizado (DEF-160) ────────────────

test("atenderClicEnEnlace: fuera de un `<a>` no toca el evento", () => {
  const ev = {
    cortado: false,
    preventDefault() {
      this.cortado = true;
    },
    target: { closest: () => null },
  };
  assert.equal(atenderClicEnEnlace(ev), false);
  assert.equal(ev.cortado, false);
});

test("atenderClicEnEnlace: un wikilink abre la nota, decodificado", () => {
  const ev = eventoFalso("#wikilink:Otra%20nota%23Encabezado");
  let abierta = null;
  assert.equal(atenderClicEnEnlace(ev, { abrirNota: (t) => (abierta = t) }), true);
  assert.equal(ev.cortado, true);
  assert.equal(abierta, "Otra nota#Encabezado");
});

test("atenderClicEnEnlace: un wikilink mal codificado no rompe ni navega", () => {
  const ev = eventoFalso("#wikilink:50%");
  let abierta = null;
  assert.equal(atenderClicEnEnlace(ev, { abrirNota: (t) => (abierta = t) }), true);
  assert.equal(ev.cortado, true);
  assert.equal(abierta, null);
});

test("atenderClicEnEnlace: CUALQUIER `<a>` corta la navegación", () => {
  for (const href of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "vbscript:x",
    "data:text/html,x",
    "file:///C:/x",
    "search-ms:query=x",
    "#tag:proyecto",
    "#un-titulo",
    "otra-nota.md",
    "",
    null,
  ]) {
    const ev = eventoFalso(href);
    let abierta = null;
    assert.equal(atenderClicEnEnlace(ev, { abrirNota: (t) => (abierta = t) }), true, String(href));
    assert.equal(ev.cortado, true, String(href));
    assert.equal(abierta, null, String(href));
  }
});

test("atenderClicEnEnlace: sin acciones, un wikilink tampoco navega", () => {
  const ev = eventoFalso("#wikilink:Otra");
  assert.equal(atenderClicEnEnlace(ev), true);
  assert.equal(ev.cortado, true);
});
