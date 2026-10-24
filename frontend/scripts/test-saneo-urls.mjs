// Test headless del saneo de URLs (`DEF-160`): la regla pura
// (`urlPermitida`, `lib/enlacesExternos.ts`) y el HTML REAL de la vista de
// lectura (`lib/markdown.ts`), para comprobar que ningún `href`/`src` con un
// esquema ajeno sobrevive al pipeline y que lo nuestro sigue funcionando.
//
// Por qué importa: en Mycelium un XSS no es una pestaña robada, es ejecución de
// código en el equipo —los comandos de Tauri están al alcance de JS—. Antes de
// esto, `[a](javascript:…)` salía como `<a href="javascript:…">` y un clic lo
// ejecutaba.
//
// Mismo arnés que `scripts/test-embeds.mjs`: los módulos se transpilan a una
// carpeta temporal DENTRO de `frontend/` para que resuelvan `node_modules`.
//
//   node --test scripts/test-saneo-urls.mjs
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(AQUI, "..");
const TMP = join(FRONTEND, ".tmp-test-saneo-urls");

const MODULOS = [
  "lib/markdown.ts",
  "lib/frontmatter.ts",
  "lib/wikilinks.ts",
  "lib/drawio.ts",
  "lib/extensionesDeTipo.ts",
  "lib/editor/wikilink.ts",
  "lib/video.ts",
  "lib/imagenes.ts",
  "lib/enlacesExternos.ts",
  "lib/estadosTarea.ts",
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
const { renderNota, renderMarkdown } = await cargar("markdown");
const { urlPermitida, formaParaEsquema, sanearUrlsHast, TITULO_ENLACE_BLOQUEADO } =
  await cargar("enlacesExternos");

after(async () => {
  await rm(TMP, { recursive: true, force: true });
});

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
const ZWSP = String.fromCharCode(0x200b);

/** Todos los valores de `href="…"` y `src="…"` de un HTML. */
function urlsDe(html) {
  return [...html.matchAll(/\s(?:href|src|xlink:href)="([^"]*)"/gi)].map((m) => m[1]);
}

/** Lo que un navegador vería como esquema, decodificando las entidades. */
function esquemaVisto(valor) {
  const m = /^([a-z][a-z0-9+.-]*):/.exec(formaParaEsquema(valor));
  return m ? m[1] : null;
}

// ── La regla pura ────────────────────────────────────────────────────────────

test("javascript: no pasa, escrito como se escriba", () => {
  for (const v of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    `java${TAB}script:alert(1)`,
    `java${LF}script:alert(1)`,
    `java${NUL}script:alert(1)`,
    `${ZWSP}javascript:alert(1)`,
    "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)",
    "&#X6a;avascript&colon;alert(1)",
    "javascript&#58;alert(1)",
    "&amp;#106;avascript:alert(1)",
    "java&Tab;script:alert(1)",
  ]) {
    assert.equal(urlPermitida(v, "enlace"), false, JSON.stringify(v));
    assert.equal(urlPermitida(v, "imagen"), false, JSON.stringify(v));
    assert.equal(urlPermitida(v, "marco"), false, JSON.stringify(v));
  }
});

test("los demás esquemas peligrosos o desconocidos tampoco", () => {
  for (const v of [
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///C:/Windows/System32/cmd.exe",
    "search-ms:query=x",
    "ms-msdt:/id PCWDiagnostic",
    "tauri://localhost/",
    "asset://localhost/C:/secreto",
    "smb://servidor/recurso",
  ]) {
    assert.equal(urlPermitida(v, "enlace"), false, v);
  }
});

test("data: en un enlace no; data:image en una imagen sí", () => {
  assert.equal(urlPermitida("data:image/png;base64,AAAA", "enlace"), false);
  assert.equal(urlPermitida("data:image/png;base64,AAAA", "imagen"), true);
  assert.equal(urlPermitida("data:text/html,x", "imagen"), false);
  assert.equal(urlPermitida("data:image/png;base64,AAAA", "marco"), false);
});

test("lo nuestro pasa: web, correo, anclas, internos y rutas relativas", () => {
  for (const v of [
    "https://ejemplo.com/x?y=1#z",
    "HTTP://EJEMPLO.COM",
    "mailto:alguien@ejemplo.com",
    "#wikilink:Otra%20nota",
    "#tag:proyecto",
    "#excalidraw",
    "#drawio",
    "#un-encabezado",
    "otra-nota.md",
    "./imagen.png",
    "../carpeta/archivo.pdf",
    "",
  ]) {
    assert.equal(urlPermitida(v, "enlace"), true, v);
  }
  assert.equal(urlPermitida("mailto:x@y.z", "imagen"), false, "mailto solo en enlaces");
  assert.equal(urlPermitida("https://www.youtube-nocookie.com/embed/x", "marco"), true);
});

test("lo que no es texto no pasa", () => {
  assert.equal(urlPermitida(undefined), false);
  assert.equal(urlPermitida(42), false);
});

test("el árbol hast: se quita la URL, el elemento y su texto se quedan", () => {
  const arbol = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "a",
        properties: { href: "javascript:alert(1)" },
        children: [{ type: "text", value: "pulsame" }],
      },
      { type: "element", tagName: "img", properties: { src: "data:text/html,x", alt: "a" }, children: [] },
      { type: "element", tagName: "iframe", properties: { src: "javascript:alert(1)" }, children: [] },
      { type: "element", tagName: "a", properties: { href: "https://ok.com/" }, children: [] },
      { type: "element", tagName: "img", properties: { src: "x.png", srcSet: ["javascript:x 2x"] }, children: [] },
    ],
  };
  sanearUrlsHast(arbol);
  const [a, img, iframe, ok, img2] = arbol.children;
  assert.equal(a.properties.href, undefined);
  assert.equal(a.properties.title, TITULO_ENLACE_BLOQUEADO);
  assert.equal(a.children[0].value, "pulsame");
  assert.equal(img.properties.src, undefined);
  assert.equal(img.properties.alt, "a");
  assert.equal(iframe.properties.src, undefined);
  assert.equal(ok.properties.href, "https://ok.com/");
  assert.equal(img2.properties.srcSet, undefined);
  assert.equal(img2.properties.src, "x.png");
});

// ── El HTML real de la vista de lectura ─────────────────────────────────────

const ATAQUES = [
  "[a](javascript:alert(1))",
  "[a](JaVaScRiPt:alert(1))",
  "[a](<javascript:alert(1)>)",
  "<javascript:alert(1)>",
  "[a](&#106;avascript:alert(1))",
  "[a](javascript&#58;alert(1))",
  "[a](java&Tab;script:alert(1))",
  "[a](vbscript:msgbox(1))",
  "[a](data:text/html,<script>alert(1)</script>)",
  "[a](file:///C:/Windows/System32/cmd.exe)",
  "[a](search-ms:query=x)",
  "![x](javascript:alert(1))",
  "![x](data:text/html,hola)",
  "[a][ref]\n\n[ref]: javascript:alert(1)",
  "[![x](https://ok.com/i.png)](javascript:alert(1))",
  "| c |\n|---|\n| [a](javascript:alert(1)) |",
  "> [!note]\n> [a](javascript:alert(1))",
];

test("ningún esquema ajeno sobrevive al pipeline", () => {
  for (const md of ATAQUES) {
    const html = renderNota(md);
    for (const url of urlsDe(html)) {
      const esquema = esquemaVisto(url);
      assert.ok(
        esquema === null || ["http", "https", "mailto"].includes(esquema) || url.startsWith("data:image/"),
        `${JSON.stringify(md)} dejó ${JSON.stringify(url)} en ${html}`,
      );
    }
    // En los atributos de URL no queda nada; en el texto visible —y en el
    // `data-mic-img` de una imagen del vault, que solo se busca como ruta—
    // puede quedar: es lo que el usuario escribió, y se lee como texto.
    for (const m of html.matchAll(/\s(?:href|src|srcset|xlink:href|action|formaction|poster)="[^"]*"/gi)) {
      assert.doesNotMatch(m[0], /javascript|vbscript|search-ms|file:|data:text/i, `${md} → ${html}`);
    }
  }
});

test("un enlace neutralizado sigue mostrando su texto", () => {
  const html = renderNota("Antes [pulsame](javascript:alert(1)) después");
  assert.match(html, /<a title="Enlace bloqueado[^"]*">pulsame<\/a>/);
  assert.match(html, /Antes/);
  assert.match(html, /después/);
});

test("lo que ya funcionaba sigue funcionando", () => {
  const casos = [
    ["[web](https://ejemplo.com/x)", 'href="https://ejemplo.com/x"'],
    ["<https://ejemplo.com>", 'href="https://ejemplo.com"'],
    ["https://suelta.com", 'href="https://suelta.com"'],
    ["[correo](mailto:a@b.com)", 'href="mailto:a@b.com"'],
    ["[[Otra nota]]", 'href="#wikilink:Otra%20nota"'],
    ["[[Otra nota#Encabezado]]", 'href="#wikilink:Otra%20nota%23Encabezado"'],
    ["Hola #proyecto", 'href="#tag:proyecto"'],
    ["![x](https://ejemplo.com/i.png)", 'src="https://ejemplo.com/i.png"'],
    ["![x](data:image/png;base64,AAAA)", 'src="data:image/png;base64,AAAA"'],
    ["![[foto.png]]", 'data-mic-img="foto.png"'],
    ["![x](imagenes/foto.png)", 'data-mic-img="imagenes/foto.png"'],
    ["![[Arquitectura.drawio]]", 'class="mic-drawio"'],
    ["[relativo](otra-nota.md)", 'href="otra-nota.md"'],
    ["[ancla](#seccion)", 'href="#seccion"'],
    ["[ayuda](ayuda:escribir-notas/tareas)", 'href="ayuda:escribir-notas/tareas"'],
  ];
  for (const [md, esperado] of casos) {
    const html = renderNota(md);
    assert.ok(html.includes(esperado), `${md} → ${html}`);
  }
});

test("el vídeo embebido conserva su reproductor", () => {
  const html = renderMarkdown("![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)");
  assert.match(html, /<iframe[^>]+src="https:\/\//);
});

test("las propiedades del frontmatter también se sanean", () => {
  const html = renderNota('---\nenlace: "[a](javascript:alert(1))"\ntags: [uno]\n---\ncuerpo');
  assert.doesNotMatch(html, /href="javascript/i);
  assert.match(html, /Enlace bloqueado/);
  assert.match(html, /href="#tag:uno"/);
});
