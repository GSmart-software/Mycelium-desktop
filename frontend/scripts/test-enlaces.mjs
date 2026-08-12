// Test headless (sin navegador ni Tauri) del núcleo de auditoría y re-enlazado
// (`FUN-M-17` / `FUN-L-17`). `lib/enlaces.ts` es puro —sin imports—, así que se
// transpila en el momento y se importa vía data: URL, igual que
// `scripts/test-frontmatter.mjs`, `test-esporas.mjs` y `test-bases.mjs`.
//
//   node --test scripts/test-enlaces.mjs
//   node scripts/test-enlaces.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/enlaces.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const {
  aplicarFormas,
  candidatasDe,
  compilarFormas,
  conDescartes,
  conFormas,
  diagnosticar,
  escribirLexico,
  leerLexico,
  zonasProtegidas,
} = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

// ── Utilidades ────────────────────────────────────────────────────────────────

const LEXICO = {
  version: 1,
  destinos: {
    "HU/HU-009 Gestion de usuarios.md": {
      titulo: "HU-009 Gestion de usuarios",
      formas: ["HU-009", "HU009"],
    },
    "Guias/Guia de despliegue.md": {
      titulo: "Guia de despliegue",
      formas: ["Guia de despliegue"],
    },
  },
  descartadas: [{ forma: "Estado", motivo: "palabra común" }],
};

const aplicar = (texto, lexico = LEXICO) => aplicarFormas(texto, compilarFormas(lexico)).texto;

const NOTAS = [
  { id: "HU/HU-009 Gestion de usuarios.md", titulo: "HU-009 Gestion de usuarios" },
  { id: "Guias/Guia de despliegue.md", titulo: "Guia de despliegue" },
  { id: "Indice.md", titulo: "Indice" },
];

// ── Reescritura: los tres casos de la spec ────────────────────────────────────

test("`HU-009` entre backticks pierde los backticks", () => {
  assert.equal(aplicar("Ver `HU-009` para el login."), "Ver [[HU-009]] para el login.");
});

test("HU-009 suelto en la prosa", () => {
  assert.equal(aplicar("Depende de HU-009 y poco más."), "Depende de [[HU-009]] y poco más.");
});

test("un enlace Markdown a una nota se convierte entero", () => {
  assert.equal(
    aplicar("Ver [HU-009](HU/HU-009 Gestion de usuarios.md) acá."),
    "Ver [[HU-009]] acá.",
  );
});

test("se convierten TODAS las apariciones, no solo la primera", () => {
  assert.equal(
    aplicar("HU-009 y otra vez HU-009 y `HU-009`."),
    "[[HU-009]] y otra vez [[HU-009]] y [[HU-009]].",
  );
});

test("sin distinguir mayúsculas, pero preservando el texto original", () => {
  assert.equal(aplicar("ver hu-009 acá"), "ver [[hu-009]] acá");
  assert.equal(aplicar("ver Hu-009 acá"), "ver [[Hu-009]] acá");
});

// ── Límites de palabra ────────────────────────────────────────────────────────

test("HU-0091 NO se toca: el límite de palabra lo protege", () => {
  assert.equal(aplicar("El caso HU-0091 es otro."), "El caso HU-0091 es otro.");
});

test("HU-009-B tampoco: el guion continúa la palabra", () => {
  assert.equal(aplicar("Ver HU-009-B."), "Ver HU-009-B.");
});

test("pegado a puntuación sí se convierte", () => {
  assert.equal(aplicar("Ver HU-009, y ya."), "Ver [[HU-009]], y ya.");
  assert.equal(aplicar("(HU-009)"), "([[HU-009]])");
});

// ── Zonas prohibidas ──────────────────────────────────────────────────────────

test("el frontmatter no se toca", () => {
  const texto = "---\ntitulo: HU-009\n---\n\nVer HU-009.";
  assert.equal(aplicar(texto), "---\ntitulo: HU-009\n---\n\nVer [[HU-009]].");
});

test("un bloque de código cercado no se toca", () => {
  const texto = "Antes HU-009.\n\n```js\nconst x = 'HU-009';\n```\n\nDespués HU-009.";
  const salida = aplicar(texto);
  assert.equal(salida.includes("const x = 'HU-009';"), true, "el código queda intacto");
  assert.equal(salida.split("[[HU-009]]").length - 1, 2, "solo las dos de fuera");
});

test("una valla con tildes largas y con ~~~ también protege", () => {
  assert.equal(aplicar("~~~\nHU-009\n~~~"), "~~~\nHU-009\n~~~");
  assert.equal(aplicar("````\nHU-009\n````"), "````\nHU-009\n````");
});

test("una valla sin cerrar protege hasta el final", () => {
  assert.equal(aplicar("```\nHU-009 y más"), "```\nHU-009 y más");
});

test("dentro de una URL no es una referencia", () => {
  assert.equal(
    aplicar("Ver https://ej.com/HU-009/x y también HU-009."),
    "Ver https://ej.com/HU-009/x y también [[HU-009]].",
  );
});

test("un enlace a algo que no es nota queda intacto", () => {
  assert.equal(aplicar("[HU-009](diagrama.png)"), "[HU-009](diagrama.png)");
  assert.equal(aplicar("[HU-009](https://ej.com)"), "[HU-009](https://ej.com)");
});

test("el alt de una imagen no se enlaza", () => {
  assert.equal(aplicar("![HU-009](foto.png)"), "![HU-009](foto.png)");
});

// ── Idempotencia y forma más larga ────────────────────────────────────────────

test("volver a aplicar no cambia nada", () => {
  const una = aplicar("Ver `HU-009` y HU-009.");
  assert.equal(aplicar(una), una);
});

test("un embed existente tampoco se toca", () => {
  assert.equal(aplicar("![[HU-009]]"), "![[HU-009]]");
});

test("gana la forma más larga", () => {
  const lexico = {
    version: 1,
    destinos: {
      "a.md": { titulo: "A", formas: ["HU"] },
      "b.md": { titulo: "B", formas: ["HU-009"] },
    },
    descartadas: [],
  };
  assert.equal(aplicar("Ver HU-009.", lexico), "Ver [[HU-009]].");
});

test("una forma de varias palabras funciona", () => {
  assert.equal(
    aplicar("El despliegue se describe en Guia de despliegue."),
    "El despliegue se describe en [[Guia de despliegue]].",
  );
});

// ── La regla de seguridad: solo se toca lo que está en el léxico ──────────────

test("una forma que NO está en el léxico no se toca, ni entre backticks", () => {
  assert.equal(
    aplicar("El identificador `XY-123` es código, y RF-012 tampoco está."),
    "El identificador `XY-123` es código, y RF-012 tampoco está.",
  );
});

// ── Finales de línea ──────────────────────────────────────────────────────────

test("un archivo con CRLF conserva sus finales de línea", () => {
  const salida = aplicar("Ver HU-009.\r\nY otra línea.\r\n");
  assert.equal(salida, "Ver [[HU-009]].\r\nY otra línea.\r\n");
});

test("el frontmatter con CRLF también se detecta", () => {
  const texto = "---\r\ntitulo: HU-009\r\n---\r\n\r\nVer HU-009.";
  assert.equal(aplicar(texto).includes("titulo: HU-009"), true);
});

// ── El informe de reemplazos ──────────────────────────────────────────────────

test("cada reemplazo dice qué había antes y a dónde apunta", () => {
  const r = aplicarFormas("Ver `HU-009`.", compilarFormas(LEXICO));
  assert.equal(r.reemplazos.length, 1);
  assert.deepEqual(r.reemplazos[0], {
    antes: "`HU-009`",
    despues: "[[HU-009]]",
    forma: "HU-009",
    destino: "HU/HU-009 Gestion de usuarios.md",
  });
});

// ── Zonas protegidas, directamente ────────────────────────────────────────────

test("zonasProtegidas cubre frontmatter, código, wikilink y URL", () => {
  const texto = "---\na: 1\n---\ntexto [[x]] https://e.com\n```\ncode\n```\n";
  const zonas = zonasProtegidas(texto);
  assert.equal(zonas.length >= 4, true);
});

// ── Auditoría: NO modifica, y descubre ────────────────────────────────────────

const DOCS = [
  {
    id: "Indice.md",
    titulo: "Indice",
    texto: [
      "# Indice",
      "",
      "Ver `HU-009` para el login, y otra vez `HU-009`.",
      "El despliegue está en Guia de despliegue.",
      "También [HU-009](HU/HU-009 Gestion de usuarios.md).",
      "",
      "```js",
      "const RF_012 = 1;",
      "```",
      "",
      "Y un `RF-012` suelto.",
    ].join("\n"),
  },
  {
    id: "Notas.md",
    titulo: "Notas",
    texto: "Depende de HU-009 y de `RF-012`. Estado: abierto.",
  },
];

test("auditar NO modifica ni un byte de ningún documento", () => {
  const copia = DOCS.map((d) => ({ ...d }));
  const antes = JSON.stringify(copia);
  candidatasDe(copia, NOTAS, { version: 1, destinos: {}, descartadas: [] });
  assert.equal(
    JSON.stringify(copia),
    antes,
    "es la garantía que sostiene toda la separación auditoría/enlazado",
  );
});

test("descubre las formas y cuenta apariciones y documentos", () => {
  const c = candidatasDe(DOCS, NOTAS, { version: 1, destinos: {}, descartadas: [] });
  const hu = c.find((x) => x.forma.toLowerCase() === "hu-009");
  assert.equal(hu.apariciones, 4, "3 en Indice (2 backticks + 1 enlace) y 1 en Notas");
  assert.equal(hu.documentos, 2);
  assert.equal(hu.destino, "HU/HU-009 Gestion de usuarios.md");
  assert.equal(hu.destinoTitulo, "HU-009 Gestion de usuarios");
});

test("el destino se deduce de un título que EMPIEZA por la forma", () => {
  const c = candidatasDe(
    [{ id: "x.md", titulo: "X", texto: "Ver `HU-009`." }],
    NOTAS,
    { version: 1, destinos: {}, descartadas: [] },
  );
  assert.equal(c[0].destino, "HU/HU-009 Gestion de usuarios.md");
});

test("una forma sin destino se propone igual, para poder asignarlo a mano", () => {
  const c = candidatasDe(DOCS, NOTAS, { version: 1, destinos: {}, descartadas: [] });
  const rf = c.find((x) => x.forma.toLowerCase() === "rf-012");
  assert.equal(rf !== undefined, true);
  assert.equal(rf.destino, null);
});

test("lo que está dentro de un bloque de código no se propone", () => {
  const c = candidatasDe(
    [{ id: "x.md", titulo: "X", texto: "```\nAAA-111\n```\n" }],
    NOTAS,
    { version: 1, destinos: {}, descartadas: [] },
  );
  assert.equal(c.some((x) => x.forma === "AAA-111"), false);
});

test("un título nombrado en la prosa se propone", () => {
  const c = candidatasDe(DOCS, NOTAS, { version: 1, destinos: {}, descartadas: [] });
  const g = c.find((x) => x.forma === "Guia de despliegue");
  assert.equal(g !== undefined, true);
  assert.equal(g.destino, "Guias/Guia de despliegue.md");
});

test("una nota no se propone a sí misma", () => {
  const c = candidatasDe(
    [{ id: "Indice.md", titulo: "Indice", texto: "Soy `Indice` y me nombro." }],
    NOTAS,
    { version: 1, destinos: {}, descartadas: [] },
  );
  assert.equal(c.some((x) => x.forma.toLowerCase() === "indice"), false);
});

test("volver a auditar NO vuelve a proponer lo ya descartado ni lo ya registrado", () => {
  const c = candidatasDe(DOCS, NOTAS, LEXICO);
  assert.equal(c.some((x) => x.forma.toLowerCase() === "hu-009"), false, "ya está en el léxico");
  assert.equal(c.some((x) => x.forma === "Estado"), false, "ya se descartó");
  assert.equal(c.some((x) => x.forma.toLowerCase() === "rf-012"), true, "esta sigue abierta");
});

test("primero las que apuntan a una nota real, después por apariciones", () => {
  const c = candidatasDe(DOCS, NOTAS, { version: 1, destinos: {}, descartadas: [] });
  const conDestino = c.filter((x) => x.destino !== null);
  const sinDestino = c.filter((x) => x.destino === null);
  assert.equal(
    c.slice(0, conDestino.length).every((x) => x.destino !== null),
    true,
    "sobre un vault técnico, ordenar solo por apariciones deja arriba puro backtick de código",
  );
  for (const grupo of [conDestino, sinDestino]) {
    for (let i = 1; i < grupo.length; i++) {
      assert.equal(grupo[i - 1].apariciones >= grupo[i].apariciones, true);
    }
  }
});

test("el ruido evidente se descarta, pero NUNCA si apunta a una nota", () => {
  const docs = [{ id: "x.md", titulo: "X", texto: "Con `---`, `.md`, `1.2.0` y `f(x)`." }];
  const c = candidatasDe(docs, NOTAS, { version: 1, destinos: {}, descartadas: [] });
  assert.deepEqual(c.map((x) => x.forma), [], "todo eso es sintaxis, no referencias");

  // La misma forma, pero existiendo una nota que se llama así: sobrevive.
  const conNota = candidatasDe(docs, [...NOTAS, { id: ".md", titulo: ".md" }], {
    version: 1,
    destinos: {},
    descartadas: [],
  });
  assert.equal(conNota.some((x) => x.forma === ".md"), true);
});

test("un prefijo de dos letras no basta para deducir un destino", () => {
  const c = candidatasDe(
    [{ id: "x.md", titulo: "X", texto: "Ver `HU` por ahí." }],
    NOTAS,
    { version: 1, destinos: {}, descartadas: [] },
  );
  const hu = c.find((x) => x.forma === "HU");
  assert.equal(hu === undefined || hu.destino === null, true);
});

test("cada candidata trae un ejemplo real donde aparece", () => {
  const c = candidatasDe(DOCS, NOTAS, { version: 1, destinos: {}, descartadas: [] });
  assert.equal(c[0].ejemplo.length > 0, true);
});

// ── Diagnóstico ───────────────────────────────────────────────────────────────

test("el diagnóstico dice lo útil, no «todo huérfano»", () => {
  const c = candidatasDe(DOCS, NOTAS, { version: 1, destinos: {}, descartadas: [] });
  const d = diagnosticar(DOCS, c);
  assert.equal(d.documentos, 2);
  assert.equal(d.sinEnlaces, 2, "ninguno tiene wikilinks todavía");
  assert.equal(d.wikilinks, 0);
  assert.equal(d.apariciones > 0, true);
});

// ── Léxico ────────────────────────────────────────────────────────────────────

test("el léxico va y vuelve de JSON", () => {
  assert.deepEqual(leerLexico(escribirLexico(LEXICO)), LEXICO);
});

test("un léxico ausente o corrupto no tumba la auditoría", () => {
  assert.deepEqual(leerLexico(null), { version: 1, destinos: {}, descartadas: [] });
  assert.deepEqual(leerLexico("{no es json"), { version: 1, destinos: {}, descartadas: [] });
});

test("conFormas agrega sin duplicar y sin mutar el original", () => {
  const antes = JSON.stringify(LEXICO);
  const nuevo = conFormas(LEXICO, [
    { forma: "HU 009", destino: "HU/HU-009 Gestion de usuarios.md", titulo: "HU-009 Gestion de usuarios" },
    { forma: "hu-009", destino: "HU/HU-009 Gestion de usuarios.md", titulo: "HU-009 Gestion de usuarios" },
  ]);
  assert.deepEqual(nuevo.destinos["HU/HU-009 Gestion de usuarios.md"].formas, [
    "HU-009",
    "HU009",
    "HU 009",
  ]);
  assert.equal(JSON.stringify(LEXICO), antes, "el original no se toca");
});

test("conDescartes no duplica", () => {
  const nuevo = conDescartes(LEXICO, [
    { forma: "estado", motivo: "otra vez" },
    { forma: "Nuevo", motivo: "x" },
  ]);
  assert.equal(nuevo.descartadas.length, 2);
});
