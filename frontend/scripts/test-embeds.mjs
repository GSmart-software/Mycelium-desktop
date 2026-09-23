// Test headless del pipeline REAL de la vista de lectura (`lib/markdown.ts`),
// no de una expresión suelta (`FUN-L-20` CA5).
//
// Existe por un defecto concreto: `![[diagrama.drawio]]` no dibujaba nada y los
// tests que había seguían en verde, porque probaban la expresión por su cuenta
// y nadie comprobaba que `renderNota` llegara a emitir el placeholder.
//
// `lib/markdown.ts` importa paquetes de npm (remark/rehype), así que no se
// puede cargar desde una `data:` URL —ahí los especificadores desnudos no
// resuelven—. Se transpila a una carpeta temporal DENTRO de `frontend/`, con
// los imports `@/lib/...` reescritos a rutas relativas, para que node resuelva
// `node_modules` como siempre.
//
//   node --test scripts/test-embeds.mjs
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import ts from "typescript";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(AQUI, "..");
const TMP = join(FRONTEND, ".tmp-test-embeds");

/** Los módulos que hacen falta, con sus dependencias locales. */
const MODULOS = [
  "lib/markdown.ts",
  "lib/frontmatter.ts",
  "lib/wikilinks.ts",
  "lib/drawio.ts",
  "lib/extensionesDeTipo.ts",
  "lib/editor/wikilink.ts",
];

await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });

// El único import de store que sobrevive a la transpilación es `useVaultStore`,
// y `resolveWikilink` no lo usa: recibe las notas por parámetro. Con un doble
// basta para poder probarlo sin arrancar la app.
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
    // `@/lib/x` y `@/lib/editor/x` → `./x.mjs`: quedan todos planos en la misma
    // carpeta, así que solo importa el último segmento.
    .replace(/(["'])@\/lib\/(?:[A-Za-z0-9_-]+\/)*([A-Za-z0-9_-]+)\1/g, '"./$2.mjs"')
    .replace(/(["'])@\/stores\/([A-Za-z0-9_-]+)\1/g, '"./$2.mjs"');
  await writeFile(join(TMP, `${rel.split("/").pop().replace(/\.ts$/, "")}.mjs`), js);
}

const { renderNota } = await import(pathToFileURL(join(TMP, "markdown.mjs")).href);
const { resolveWikilink } = await import(pathToFileURL(join(TMP, "wikilink.mjs")).href);

after(async () => {
  await rm(TMP, { recursive: true, force: true });
});

test("![[diagrama.drawio]] emite el placeholder que el cliente reemplaza", () => {
  const html = renderNota("![[Arquitectura.drawio]]");
  // La clase es la que busca `renderDrawioIn`; el `data-diag`, lo que se le
  // pasa a `resolveWikilink`. Si cualquiera de las dos cambia sin que cambie
  // `lib/drawioRender.ts`, el embed deja de dibujarse en silencio.
  assert.match(html, /class="mic-drawio"/);
  assert.match(html, /data-diag="Arquitectura\.drawio"/);
});

test("el data-diag conserva la extensión y la carpeta", () => {
  // `resolveWikilink` necesita el nombre COMPLETO: la carpeta desambigua
  // homónimos y la extensión la quita él con `sinExtensionDeNota`.
  const html = renderNota("![[Proyectos/Arquitectura.drawio]]");
  assert.match(html, /data-diag="Proyectos\/Arquitectura\.drawio"/);
});

test("un diagrama con espacios y acentos en el nombre también sale", () => {
  const html = renderNota("![[Diagrama sin título.drawio]]");
  assert.match(html, /class="mic-drawio"/);
  assert.ok(
    html.includes("Diagrama sin t") && html.includes(".drawio"),
    `el nombre no llegó al placeholder: ${html}`,
  );
});

test("el embed de draw.io NO se convierte en un wikilink normal", () => {
  // Es el error que lo dejaría como texto/enlace azul en vez de dibujo: el
  // `[[…]]` interno no debe ganarle al embed.
  const html = renderNota("![[Arquitectura.drawio]]");
  assert.ok(
    !/class="mic-wikilink"/.test(html),
    `el embed se estilizó como wikilink: ${html}`,
  );
});

test("los embeds de excalidraw siguen funcionando igual", () => {
  // Que agregar draw.io no se lleve por delante lo que ya andaba.
  const html = renderNota("![[Dibujo.excalidraw]]");
  assert.match(html, /class="mic-excalidraw"/);
  assert.match(html, /data-diag="Dibujo"/);
});

test("un wikilink normal sigue siendo un wikilink", () => {
  const html = renderNota("Ver [[Otra nota]].");
  assert.match(html, /class="mic-wikilink"/);
  assert.ok(!/mic-drawio/.test(html));
});

test("un embed de draw.io convive con texto y con otros enlaces", () => {
  const html = renderNota("Antes [[Nota]] y el diagrama:\n\n![[Plano.drawio]]\n\nDespués.");
  assert.match(html, /class="mic-wikilink"/);
  assert.match(html, /class="mic-drawio"/);
  assert.match(html, /data-diag="Plano\.drawio"/);
});

// ── La resolución del destino: donde estaba el defecto ───────────────────────
//
// El título de una nota NO lleva extensión, pero el embed sí. Si
// `resolveWikilink` no sabe quitarla, `![[diagrama.drawio]]` no encuentra NADA
// y el bloque se dibuja como «no existe» con el archivo ahí al lado. Eso es
// exactamente lo que pasaba: la lista de extensiones decía `excalidraw|md`.

/** El vault de prueba: un diagrama, un dibujo, una base, un lienzo y una nota. */
const NOTAS = [
  { id: "Arquitectura.drawio", titulo: "Arquitectura", tipo: "drawio", carpetaId: null },
  { id: "Bocetos/Idea.excalidraw", titulo: "Idea", tipo: "excalidraw", carpetaId: "Bocetos" },
  { id: "Tareas.base", titulo: "Tareas", tipo: "base", carpetaId: null },
  { id: "Lienzo.canvas", titulo: "Lienzo", tipo: "canvas", carpetaId: null },
  { id: "Otra nota.md", titulo: "Otra nota", tipo: "markdown", carpetaId: null },
];
const CARPETAS = [{ id: "Bocetos", nombre: "Bocetos", padreId: null }];

test("un embed con extensión .drawio resuelve a su nota", () => {
  const destino = resolveWikilink("Arquitectura.drawio", NOTAS, CARPETAS);
  assert.ok(destino, "no resolvió: es el defecto que dejaba el embed en blanco");
  assert.equal(destino.id, "Arquitectura.drawio");
  assert.equal(destino.tipo, "drawio");
});

test("resuelve igual sin la extensión y sin importar mayúsculas", () => {
  assert.equal(resolveWikilink("Arquitectura", NOTAS, CARPETAS)?.id, "Arquitectura.drawio");
  assert.equal(
    resolveWikilink("arquitectura.DRAWIO", NOTAS, CARPETAS)?.id,
    "Arquitectura.drawio",
  );
});

test("TODAS las extensiones de nota resuelven, no solo las dos de antes", () => {
  // La lista escrita a mano decía `excalidraw|md`. Esta comprobación es la que
  // impide que el próximo tipo se agregue a medias.
  assert.equal(resolveWikilink("Tareas.base", NOTAS, CARPETAS)?.id, "Tareas.base");
  assert.equal(resolveWikilink("Lienzo.canvas", NOTAS, CARPETAS)?.id, "Lienzo.canvas");
  assert.equal(
    resolveWikilink("Idea.excalidraw", NOTAS, CARPETAS)?.id,
    "Bocetos/Idea.excalidraw",
  );
  assert.equal(resolveWikilink("Otra nota.md", NOTAS, CARPETAS)?.id, "Otra nota.md");
});

test("la carpeta sigue desambiguando con extensión de por medio", () => {
  assert.equal(
    resolveWikilink("Bocetos/Idea.excalidraw", NOTAS, CARPETAS)?.id,
    "Bocetos/Idea.excalidraw",
  );
});

test("un destino que no existe sigue sin resolver", () => {
  assert.equal(resolveWikilink("No existe.drawio", NOTAS, CARPETAS), undefined);
  assert.equal(resolveWikilink("", NOTAS, CARPETAS), undefined);
});
