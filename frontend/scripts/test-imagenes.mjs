// Test headless (sin navegador ni Tauri) de `lib/imagenes.ts`: a qué archivo
// del vault apunta cada forma de embeber una imagen en una nota (`DEF-126`).
// El módulo es puro —sin imports—, así que se transpila en el momento y se
// importa vía data: URL, como `scripts/test-video.mjs`.
//
//   node --test scripts/test-imagenes.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/imagenes.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const {
  embedMarkdownRe,
  embedWikiRe,
  esRefDeImagen,
  esUrlExterna,
  indexarImagenes,
  limpiarRutaMarkdown,
  normalizarRuta,
  partirAltMarkdown,
  partirEmbedImagen,
  resolverEmbedImagen,
  resolverRutaImagen,
} = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

/** Un vault de prueba: rutas relativas POSIX, como las de `vaultStore.otros`. */
const indice = indexarImagenes([
  "logo.png",
  "Adjuntos/foto.png",
  "Proyectos/Adjuntos/foto.png",
  "Proyectos/Mycelium/captura.jpg",
  "Proyectos/Mycelium/img/diagrama.webp",
  "Viajes/mapa con espacios.png",
  "Viajes/Foto Grande.JPG",
  "iconos/flecha.svg",
  "Docs/manual.pdf",
  "notas.txt",
]);

// ── ![[…]] ───────────────────────────────────────────────────────────────────

test("![[x.png]] resuelve por nombre, esté donde esté", () => {
  assert.equal(resolverEmbedImagen("captura.jpg", indice), "Proyectos/Mycelium/captura.jpg");
  assert.equal(resolverEmbedImagen("logo.png", indice), "logo.png");
  assert.equal(resolverEmbedImagen("mapa con espacios.png", indice), "Viajes/mapa con espacios.png");
});

test("el nombre no distingue mayúsculas (el disco de Windows tampoco)", () => {
  assert.equal(resolverEmbedImagen("foto grande.jpg", indice), "Viajes/Foto Grande.JPG");
  assert.equal(resolverEmbedImagen("LOGO.PNG", indice), "logo.png");
});

test("homónimos sin pista: gana el de ruta más corta", () => {
  assert.equal(resolverEmbedImagen("foto.png", indice), "Adjuntos/foto.png");
});

test("con carpeta, la ruta desambigua", () => {
  assert.equal(resolverEmbedImagen("Proyectos/Adjuntos/foto.png", indice), "Proyectos/Adjuntos/foto.png");
  // Una pista parcial alcanza: la carpeta termina en ella.
  assert.equal(resolverEmbedImagen("Mycelium/captura.jpg", indice), "Proyectos/Mycelium/captura.jpg");
  // `Adjuntos/foto.png` calza con las dos: entre ellas, la más corta.
  assert.equal(resolverEmbedImagen("Adjuntos/foto.png", indice), "Adjuntos/foto.png");
});

test("una pista que no calza no lleva a la homónima de otra carpeta", () => {
  assert.equal(resolverEmbedImagen("Otra/foto.png", indice), null);
  assert.equal(resolverEmbedImagen("Otra/captura.jpg", indice), null);
});

test("lo que no existe, o no es imagen, no resuelve", () => {
  assert.equal(resolverEmbedImagen("nada.png", indice), null);
  assert.equal(resolverEmbedImagen("manual.pdf", indice), null);
  assert.equal(resolverEmbedImagen("", indice), null);
});

test("el SVG se embebe (en un <img> no ejecuta nada)", () => {
  assert.equal(resolverEmbedImagen("flecha.svg", indice), "iconos/flecha.svg");
});

test("partirEmbedImagen: tamaño, alto y alternativo", () => {
  assert.deepEqual(partirEmbedImagen("foto.png"), { destino: "foto.png", alt: "", tamano: null });
  assert.deepEqual(partirEmbedImagen("foto.png|300"), {
    destino: "foto.png",
    alt: "",
    tamano: { ancho: 300 },
  });
  assert.deepEqual(partirEmbedImagen("foto.png|300x200"), {
    destino: "foto.png",
    alt: "",
    tamano: { ancho: 300, alto: 200 },
  });
  assert.deepEqual(partirEmbedImagen("foto.png|Una foto"), {
    destino: "foto.png",
    alt: "Una foto",
    tamano: null,
  });
  // Dentro de una tabla la barra va escapada (`DEF-045`).
  assert.deepEqual(partirEmbedImagen("foto.png\\|250"), {
    destino: "foto.png",
    alt: "",
    tamano: { ancho: 250 },
  });
});

test("esRefDeImagen reconoce solo extensiones de imagen", () => {
  for (const ref of ["a.png", "a.JPG", "c/a.jpeg", "a.gif", "a.webp", "a.svg", "a.avif", "a.bmp"]) {
    assert.equal(esRefDeImagen(ref), true, ref);
  }
  for (const ref of ["Nota", "a.md", "a.excalidraw", "a.drawio", "a.pdf", "png"]) {
    assert.equal(esRefDeImagen(ref), false, ref);
  }
});

// ── ![](…) ───────────────────────────────────────────────────────────────────

test("![](rel) es relativa a la carpeta de la nota", () => {
  assert.equal(
    resolverRutaImagen("captura.jpg", "Proyectos/Mycelium", indice),
    "Proyectos/Mycelium/captura.jpg",
  );
  assert.equal(
    resolverRutaImagen("img/diagrama.webp", "Proyectos/Mycelium", indice),
    "Proyectos/Mycelium/img/diagrama.webp",
  );
  assert.equal(resolverRutaImagen("./img/diagrama.webp", "Proyectos/Mycelium", indice),
    "Proyectos/Mycelium/img/diagrama.webp");
  assert.equal(
    resolverRutaImagen("../Adjuntos/foto.png", "Proyectos/Mycelium", indice),
    "Proyectos/Adjuntos/foto.png",
  );
});

test("la carpeta de la nota gana a la raíz", () => {
  // `Adjuntos/foto.png` existe desde la raíz y desde `Proyectos/`.
  assert.equal(resolverRutaImagen("Adjuntos/foto.png", "Proyectos", indice), "Proyectos/Adjuntos/foto.png");
  assert.equal(resolverRutaImagen("Adjuntos/foto.png", null, indice), "Adjuntos/foto.png");
});

test("si no está junto a la nota, se busca desde la raíz del vault", () => {
  assert.equal(resolverRutaImagen("Adjuntos/foto.png", "Viajes", indice), "Adjuntos/foto.png");
  assert.equal(resolverRutaImagen("logo.png", "Proyectos/Mycelium", indice), "logo.png");
  // Con `/` adelante es desde la raíz, sin probar la carpeta de la nota.
  assert.equal(resolverRutaImagen("/Adjuntos/foto.png", "Proyectos", indice), "Adjuntos/foto.png");
});

test("un nombre suelto que no está ni ahí ni en la raíz se busca por nombre", () => {
  assert.equal(resolverRutaImagen("captura.jpg", null, indice), "Proyectos/Mycelium/captura.jpg");
  // Con carpeta escrita, no: la ruta es la que el usuario puso.
  assert.equal(resolverRutaImagen("Otra/captura.jpg", null, indice), null);
});

test("%20, espacios y <…> se decodifican", () => {
  assert.equal(resolverRutaImagen("mapa%20con%20espacios.png", "Viajes", indice), "Viajes/mapa con espacios.png");
  assert.equal(resolverRutaImagen("Viajes/mapa%20con%20espacios.png", null, indice), "Viajes/mapa con espacios.png");
  assert.equal(resolverRutaImagen("<mapa con espacios.png>", "Viajes", indice), "Viajes/mapa con espacios.png");
  assert.equal(limpiarRutaMarkdown("<a b.png>"), "a b.png");
  assert.equal(limpiarRutaMarkdown("Carpeta\\a.png"), "Carpeta/a.png");
  // Un `%` que no es escape no rompe nada: se busca tal cual.
  assert.equal(limpiarRutaMarkdown("50%.png"), "50%.png");
});

test("una ruta que se sale del vault no resuelve", () => {
  assert.equal(normalizarRuta("../a.png"), null);
  assert.equal(resolverRutaImagen("../../logo.png", "Proyectos", indice), null);
  assert.equal(normalizarRuta("a/./b/../c.png"), "a/c.png");
});

test("las URL externas no se resuelven contra el vault", () => {
  for (const url of ["https://ejemplo.com/a.png", "http://x.org/b.jpg", "data:image/png;base64,AAAA"]) {
    assert.equal(esUrlExterna(url), true, url);
    assert.equal(resolverRutaImagen(url, null, indice), null, url);
  }
  assert.equal(esUrlExterna("foto.png"), false);
  assert.equal(esUrlExterna("Adjuntos/https.png"), false);
});

test("lo que no existe da null (la vista muestra el aviso)", () => {
  assert.equal(resolverRutaImagen("nada.png", "Proyectos", indice), null);
  assert.equal(resolverRutaImagen("", null, indice), null);
});

test("partirAltMarkdown: `![alt|300](x)` lleva el tamaño al final del alternativo", () => {
  assert.deepEqual(partirAltMarkdown("Una foto|300"), { alt: "Una foto", tamano: { ancho: 300 } });
  assert.deepEqual(partirAltMarkdown("|200x100"), { alt: "", tamano: { ancho: 200, alto: 100 } });
  assert.deepEqual(partirAltMarkdown("a|b"), { alt: "a|b", tamano: null });
  assert.deepEqual(partirAltMarkdown("sin tamaño"), { alt: "sin tamaño", tamano: null });
});

// ── Las expresiones de la vista en vivo ──────────────────────────────────────

test("embedMarkdownRe: ruta simple, <con espacios> y con título", () => {
  const ms = (t) => [...t.matchAll(embedMarkdownRe())].map((m) => [m[1], m[2]]);
  assert.deepEqual(ms("![](foto.png)"), [["", "foto.png"]]);
  assert.deepEqual(ms("texto ![Alt|300](a/b.png) más"), [["Alt|300", "a/b.png"]]);
  assert.deepEqual(ms("![](<mapa con espacios.png>)"), [["", "<mapa con espacios.png>"]]);
  assert.deepEqual(ms('![x](foto.png "Título")'), [["x", "foto.png"]]);
  assert.deepEqual(ms("![](https://youtu.be/dQw4w9WgXcQ)"), [["", "https://youtu.be/dQw4w9WgXcQ"]]);
  assert.deepEqual(ms("[no](es.png) imagen"), []);
});

test("embedWikiRe toma el interior de ![[…]], no un [[enlace]] suelto", () => {
  const ms = (t) => [...t.matchAll(embedWikiRe())].map((m) => m[1]);
  assert.deepEqual(ms("![[foto.png|300]] y [[Nota]]"), ["foto.png|300"]);
});
