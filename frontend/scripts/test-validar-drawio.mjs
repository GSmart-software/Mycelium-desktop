// Test del validador de diagramas `.drawio` (`FUN-L-26`, parte B).
//
// Los fixtures de `fixtures/ia/drawio/` son de tres clases, y el prefijo del
// nombre dice qué se espera de cada uno:
//   bueno-*  → sin errores NI avisos (son las recetas de la skill `mycelium-drawio`)
//   aviso-*  → sin errores, con el aviso que su nombre promete
//   malo-*   → con el error que su nombre promete, y exit code ≠ 0
//
//   node --test scripts/test-validar-drawio.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";
import { anchoTexto, motivoTextoNoCabe, parsearEstilo, parsearXml, textoVisible, validarDrawio } from "./validar-drawio.mjs";

const DIR = fileURLToPath(new URL("./fixtures/ia/drawio/", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./validar-drawio.mjs", import.meta.url));
const leer = (nombre) => readFileSync(join(DIR, nombre), "utf8");
const codigos = (r, nivel) => r.problemas.filter((p) => p.nivel === nivel).map((p) => p.codigo);

/** Corre el CLI y devuelve su exit code (sin canalizar: el código es el suyo). */
function exitCode(archivo) {
  try {
    execFileSync(process.execPath, [SCRIPT, archivo], { stdio: "pipe" });
    return 0;
  } catch (e) {
    return e.status;
  }
}

const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".drawio"));

test("hay al menos 3 fixtures buenos y 3 malos", () => {
  assert.ok(fixtures.filter((f) => f.startsWith("bueno-")).length >= 3);
  assert.ok(fixtures.filter((f) => f.startsWith("malo-")).length >= 3);
});

for (const f of fixtures.filter((f) => f.startsWith("bueno-"))) {
  test(`${f}: pasa sin errores ni avisos`, () => {
    const r = validarDrawio(leer(f));
    assert.deepEqual(r.problemas, [], JSON.stringify(r.problemas, null, 2));
    assert.ok(r.paginas.length >= 1);
    assert.equal(exitCode(join(DIR, f)), 0);
  });
}

// Qué error (o aviso) tiene que aparecer en cada fixture, y en qué celda.
const ESPERADOS = {
  "malo-arista-inexistente.drawio": { nivel: "error", codigo: "arista-extremo-inexistente", id: "e1" },
  "malo-cajas-encimadas.drawio": { nivel: "error", codigo: "superposicion", id: "auth" },
  "malo-texto-no-entra.drawio": { nivel: "error", codigo: "texto-no-cabe", ids: ["largo", "sinwrap", "rombo"] },
  "malo-hijo-coordenadas-absolutas.drawio": { nivel: "error", codigo: "fuera-del-contenedor", id: "proxy" },
  "malo-xml-ampersand.drawio": { nivel: "error", codigo: "xml-malformado", id: null },
  "aviso-arista-atraviesa.drawio": { nivel: "aviso", codigo: "arista-atraviesa", id: "e3" },
  "aviso-titulo-tachado.drawio": { nivel: "aviso", codigo: "arista-tacha-titulo", ids: ["e-web", "e-movil", "e-gw-cache"] },
};

for (const f of fixtures.filter((f) => !f.startsWith("bueno-"))) {
  test(`${f}: falla por el motivo correcto`, () => {
    const esperado = ESPERADOS[f];
    assert.ok(esperado, `falta declarar en ESPERADOS qué se espera de ${f}`);
    const r = validarDrawio(leer(f));
    const del = r.problemas.filter((p) => p.nivel === esperado.nivel && p.codigo === esperado.codigo);
    assert.ok(del.length > 0, `esperaba ${esperado.codigo}; hubo ${JSON.stringify(r.problemas)}`);
    const ids = esperado.ids ?? [esperado.id];
    assert.deepEqual(
      [...new Set(del.map((p) => p.id))].sort(),
      [...ids].sort(),
      "el problema tiene que señalar a la celda culpable",
    );
    // Nada más que lo que el fixture quiere mostrar: si aparece otro problema, el
    // fixture está probando dos cosas (o el validador tiene un falso positivo).
    const otros = r.problemas.filter((p) => p.codigo !== esperado.codigo);
    assert.deepEqual(otros, [], JSON.stringify(otros, null, 2));
    assert.equal(exitCode(join(DIR, f)), esperado.nivel === "error" ? 1 : 0);
  });
}

// ── Casos puntuales ─────────────────────────────────────────────────────────

const modelo = (celdas) =>
  `<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${celdas}</root></mxGraphModel></diagram></mxfile>`;
const caja = (id, x, y, w = 120, h = 60, extra = "", value = id) =>
  `<mxCell id="${id}" value="${value}" style="rounded=1;whiteSpace=wrap;html=1;${extra}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;

test("parser: errores con línea y columna", () => {
  assert.throws(() => parsearXml('<a x="1 < 2"/>'), /«<» sin escapar.*línea 1/);
  assert.throws(() => parsearXml("<a><b></a>"), /<\/a> cierra a <b>/);
  assert.throws(() => parsearXml('<a x="1" x="2"/>'), /repetido/);
  assert.throws(() => parsearXml('<a v="uno&nbsp;dos"/>'), /entidad desconocida/);
  assert.equal(parsearXml('<a v="l1&#xa;l2 &amp; &lt;b&gt;"/>').attrs.v, "l1\nl2 & <b>");
});

test("celdas 0 y 1, ids duplicados y parent inexistente", () => {
  const sinRaiz = validarDrawio(`<mxfile><diagram name="P"><mxGraphModel><root>${caja("a", 40, 40)}</root></mxGraphModel></diagram></mxfile>`);
  assert.ok(codigos(sinRaiz, "error").includes("sin-celda-raiz"));
  const dup = validarDrawio(modelo(caja("a", 40, 40) + caja("a", 240, 40)));
  assert.ok(codigos(dup, "error").includes("id-duplicado"));
  const huerfano = validarDrawio(
    modelo('<mxCell id="x" value="x" vertex="1" parent="nada"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>'),
  );
  assert.ok(codigos(huerfano, "error").includes("parent-inexistente"));
});

test("arista sin target y arista que apunta a la capa", () => {
  const sinTarget = validarDrawio(modelo(caja("a", 40, 40) + '<mxCell id="e" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"/></mxCell>'));
  assert.ok(codigos(sinTarget, "error").includes("arista-sin-extremo"));
  const aCapa = validarDrawio(modelo(caja("a", 40, 40) + '<mxCell id="e" edge="1" parent="1" source="a" target="1"><mxGeometry relative="1" as="geometry"/></mxCell>'));
  assert.ok(codigos(aCapa, "error").includes("arista-extremo-no-vertice"));
});

test("una caja dibujada encima de otra sin ser su hija", () => {
  const r = validarDrawio(modelo(caja("zona", 40, 40, 400, 300) + caja("a", 80, 100)));
  assert.deepEqual(codigos(r, "error"), ["encima-sin-ser-hijo"]);
});

test("coordenadas negativas: aviso", () => {
  const r = validarDrawio(modelo(caja("a", -100, 40)));
  assert.deepEqual(codigos(r, "aviso"), ["coordenadas-negativas"]);
  assert.deepEqual(codigos(r, "error"), []);
});

test("con waypoints que rodean, la arista ya no atraviesa", () => {
  const cajas = caja("a", 40, 40) + caja("b", 240, 40) + caja("c", 440, 40);
  const recta = '<mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="a" target="c"><mxGeometry relative="1" as="geometry"/></mxCell>';
  assert.deepEqual(codigos(validarDrawio(modelo(cajas + recta)), "aviso"), ["arista-atraviesa"]);
  const rodeo =
    '<mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;html=1;exitX=0.5;exitY=1;entryX=0.5;entryY=1;" edge="1" parent="1" source="a" target="c">' +
    '<mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="100" y="140"/><mxPoint x="500" y="140"/></Array></mxGeometry></mxCell>';
  assert.deepEqual(validarDrawio(modelo(cajas + rodeo)).problemas, []);
});

test("un diagrama comprimido se lee (y avisa)", () => {
  const interno = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${caja("a", 40, 40)}</root></mxGraphModel>`;
  const b64 = deflateRawSync(Buffer.from(encodeURIComponent(interno))).toString("base64");
  const r = validarDrawio(`<mxfile><diagram id="p" name="P">${b64}</diagram></mxfile>`);
  assert.deepEqual(codigos(r, "aviso"), ["pagina-comprimida"]);
  assert.deepEqual(codigos(r, "error"), []);
  assert.equal(r.paginas[0].vertices, 1);
});

test("varias páginas se validan por separado", () => {
  const p1 = `<diagram id="a" name="Uno"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${caja("x", 40, 40)}</root></mxGraphModel></diagram>`;
  const p2 = `<diagram id="b" name="Dos"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${caja("x", 40, 40)}${caja("y", 60, 60)}</root></mxGraphModel></diagram>`;
  const r = validarDrawio(`<mxfile>${p1}${p2}</mxfile>`);
  assert.equal(r.paginas.length, 2);
  // Los ids se repiten entre páginas sin problema; la superposición es de la segunda.
  assert.deepEqual(r.problemas.map((p) => [p.pagina, p.codigo]), [["Dos", "superposicion"]]);
});

test("entidades HTML: se cuentan los caracteres visibles, no la entidad", () => {
  // El valor llega decodificado del XML: `&amp;gt;` del archivo es acá `&gt;`.
  assert.equal(textoVisible("¿Monto &gt; 500?", true), "¿Monto > 500?");
  assert.equal(textoVisible("a &amp;lt; b", true), "a &lt; b"); // se ve «&lt;»: una sola pasada
  assert.equal(textoVisible("&#x2192; y &#8594; y &rarr;", true).length, "→ y → y •".length);
  assert.equal(textoVisible("uno&nbsp;dos", true), "uno dos");
  // Un nombre largo con muchas entidades entra igual que su versión visible.
  const est = parsearEstilo("rounded=1;whiteSpace=wrap;html=1;");
  assert.equal(motivoTextoNoCabe("I&amp;D &gt; Ventas &gt; Norte", est, 160, 60), null);
});

test("html=1 con un «<» que abre una etiqueta sin cerrar: aviso", () => {
  const r = validarDrawio(modelo(caja("a", 40, 40, 160, 60, "", "a &lt;b (se come el resto)")));
  assert.deepEqual(codigos(r, "aviso"), ["html-menor-sin-escapar"]);
  assert.deepEqual(validarDrawio(modelo(caja("a", 40, 40, 160, 60, "", "a &amp;lt;b bien"))).problemas, []);
  assert.deepEqual(validarDrawio(modelo(caja("a", 40, 40, 160, 60, "", "&lt;b&gt;negrita&lt;/b&gt;"))).problemas, []);
});

test("ER: tablas apiladas salen y entran por la derecha (sin falso cruce)", () => {
  const tabla = (id, x, y, filas) =>
    `<mxCell id="${id}" value="${id}" style="swimlane;childLayout=stackLayout;startSize=30;html=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="220" height="${30 + 26 * filas.length}" as="geometry"/></mxCell>` +
    filas
      .map((f, k) => `<mxCell id="${f}" value="${f}" style="text;html=1;whiteSpace=wrap;portConstraint=eastwest;" vertex="1" parent="${id}"><mxGeometry y="${30 + 26 * k}" width="220" height="26" as="geometry"/></mxCell>`)
      .join("");
  const er = (extra = "") =>
    `<mxCell id="r" style="edgeStyle=entityRelationEdgeStyle;html=1;endArrow=ERzeroToMany;startArrow=ERmandOne;${extra}" edge="1" parent="1" source="a1" target="b2"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  const tablas = tabla("ta", 40, 40, ["a1", "a2"]) + tabla("tb", 40, 220, ["b1", "b2"]);
  assert.deepEqual(validarDrawio(modelo(tablas + er())).problemas, []);
  // Forzar el lado con puertos hace que la línea cruce las filas (así se ve en draw.io).
  const forzada = validarDrawio(modelo(tablas + er("exitX=0;exitY=0.5;entryX=0;entryY=0.5;")));
  assert.deepEqual(codigos(forzada, "aviso"), ["arista-atraviesa"]);
  assert.match(forzada.problemas[0].mensaje, /no fijes puertos/);
});

test("puertos en una figura con direction: aviso", () => {
  const cola = `<mxCell id="q" value="Cola" style="shape=cylinder3;whiteSpace=wrap;html=1;direction=south;" vertex="1" parent="1"><mxGeometry x="40" y="160" width="160" height="70" as="geometry"/></mxCell>`;
  const arista = (st) => `<mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;html=1;${st}" edge="1" parent="1" source="a" target="q"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  const r = validarDrawio(modelo(caja("a", 40, 40, 160) + cola + arista("entryX=0.5;entryY=0;")));
  assert.deepEqual(codigos(r, "aviso"), ["puerto-girado"]);
  assert.deepEqual(validarDrawio(modelo(caja("a", 40, 40, 160) + cola + arista(""))).problemas, []);
});

test("una arista que atraviesa una capa ajena se nombra como contenedor", () => {
  const capa = (id, y) =>
    `<mxCell id="${id}" value="${id}" style="swimlane;startSize=30;html=1;align=left;spacingLeft=10;" vertex="1" parent="1"><mxGeometry x="40" y="${y}" width="400" height="130" as="geometry"/></mxCell>`;
  const hijo = (id, padre) =>
    `<mxCell id="${id}" value="${id}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="${padre}"><mxGeometry x="200" y="50" width="160" height="60" as="geometry"/></mxCell>`;
  const celdas = capa("c1", 40) + capa("c2", 210) + capa("c3", 380) + hijo("arriba", "c1") + hijo("abajo", "c3");
  const recta = '<mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="arriba" target="abajo"><mxGeometry relative="1" as="geometry"/></mxCell>';
  const r = validarDrawio(modelo(celdas + recta));
  assert.deepEqual(codigos(r, "aviso"), ["arista-atraviesa"]);
  assert.match(r.problemas[0].mensaje, /atraviesa el contenedor "c2"/);
  // Por el pasillo de la derecha, afuera de las capas: sin aviso.
  const rodeo =
    '<mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;entryX=1;entryY=0.5;" edge="1" parent="1" source="arriba" target="abajo">' +
    '<mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="480" y="120"/><mxPoint x="480" y="460"/></Array></mxGeometry></mxCell>';
  assert.deepEqual(validarDrawio(modelo(celdas + rodeo)).problemas, []);
});

test("rombo: la fórmula width = max(180, caracteres × 10 + 40) siempre entra", () => {
  const est = parsearEstilo("rhombus;whiteSpace=wrap;html=1;");
  const ancho = (l) => Math.max(180, Math.ceil(([...l].length * 10 + 40) / 10) * 10);
  for (const t of ["¿Hay stock?", "¿Tiene comprobante?", "¿El cliente es mayorista?", "¿APROBADO POR RRHH?", "¿Supera el monto máximo mensual?"])
    assert.equal(motivoTextoNoCabe(t, est, ancho(t), 90), null, t);
  const dos = ["¿Se pudo entregar", "en el primer intento?"];
  const w = Math.max(...dos.map(ancho));
  assert.equal(motivoTextoNoCabe(dos.join("<br>"), est, w, 110), null);
});

test("estimación de texto: calibrada contra Helvetica 12 px", () => {
  // Medido en Chromium: «Servicio de autenticación» ≈ 133 px.
  const w = anchoTexto("Servicio de autenticación", 12);
  assert.ok(w > 120 && w < 150, `ancho estimado ${w}`);
  const est = parsearEstilo("rounded=1;whiteSpace=wrap;html=1;");
  assert.equal(motivoTextoNoCabe("Recibir pedido", est, 160, 60), null);
  // El valor llega ya decodificado del XML: con html=1 las etiquetas no cuentan.
  assert.equal(motivoTextoNoCabe("<b>Ana Pérez</b><br>Directora general", est, 160, 60), null);
  assert.match(motivoTextoNoCabe("<b>Ana Pérez</b><br>Directora<br>general<br>adjunta", est, 160, 40), /línea/);
  assert.match(motivoTextoNoCabe("Enviar correo de confirmación al usuario final", est, 100, 40), /línea/);
});
