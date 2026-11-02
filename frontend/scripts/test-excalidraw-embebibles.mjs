// Test headless de qué se puede embeber en un dibujo de Excalidraw (`DEF-167`):
// solo videos de YouTube y Vimeo, con las URL que Excalidraw convierte en
// reproductor. `lib/excalidrawEmbebibles.ts` es puro, así que se transpila en el
// momento y se importa vía data: URL, igual que el resto de los núcleos.
//
// El montaje real dentro de Excalidraw lo prueba `smoke-excalidraw-embebibles.mjs`.
//
//   node --test scripts/test-excalidraw-embebibles.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/excalidrawEmbebibles.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const E = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);

const VALIDAS = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123_abc-X&index=2",
  "https://www.youtube.com/embed/dQw4w9WgXcQ",
  "https://www.youtube.com/embed/dQw4w9WgXcQ?start=10",
  "https://www.youtube.com/shorts/abcDEF12345",
  "https://www.youtube.com/playlist?list=PLabc_123-x",
  "https://www.youtube.com/embed/videoseries?list=PLabc_123-x",
  "https://youtu.be/dQw4w9WgXcQ",
  "https://youtu.be/dQw4w9WgXcQ?t=30",
  "https://youtu.be/dQw4w9WgXcQ?si=Ab_c-1.2",
  "https://vimeo.com/76979871",
  "https://www.vimeo.com/76979871",
  "https://player.vimeo.com/video/76979871",
  "https://player.vimeo.com/video/76979871?h=abc123",
];

const INVALIDAS = [
  // otros sitios
  "https://twitter.com/x/status/1234567890",
  "https://x.com/usuario/status/1234567890",
  "https://www.reddit.com/r/sub/comments/abc123/titulo/",
  "https://www.figma.com/file/abc/Diseno",
  "https://stackblitz.com/edit/proyecto",
  "https://gist.github.com/usuario/abc123",
  "https://val.town/v/usuario.funcion",
  "https://giphy.com/embed/abc",
  "https://link.excalidraw.com/l/abc",
  "https://algo.simplepdf.eu/doc",
  "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  // dominios disfrazados
  "https://youtube.com.ejemplo.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com.ejemplo.com/watch?v=dQw4w9WgXcQ",
  "https://ejemployoutube.com/watch?v=dQw4w9WgXcQ",
  "https://ejemplo.com/?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com@ejemplo.com/watch?v=dQw4w9WgXcQ",
  "https://ejemplo.com\\@www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
  "https://vimeo.com.ejemplo.com/76979871",
  "https://player.vimeo.com.ejemplo.com/video/76979871",
  // subdominios
  "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://ejemplo.youtu.be/dQw4w9WgXcQ",
  "https://cdn.vimeo.com/76979871",
  // esquemas
  "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "http://vimeo.com/76979871",
  "javascript:alert(1)//https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "data:text/html,<script>alert(1)</script>",
  "//www.youtube.com/watch?v=dQw4w9WgXcQ",
  "www.youtube.com/watch?v=dQw4w9WgXcQ",
  "youtu.be/dQw4w9WgXcQ",
  // mayúsculas (Excalidraw no las convierte en reproductor)
  "HTTPS://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
  "https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ",
  "https://Vimeo.com/76979871",
  // formas raras dentro del dominio correcto
  "https://www.youtube.com/",
  "https://www.youtube.com/watch?v=",
  "https://www.youtube.com/channel/UCabc",
  "https://www.youtube.com/watch?v=abc&u=x.com/a/status/1",
  "https://www.youtube.com/watch?v=abc\"><script>",
  "https://www.youtube.com/watch?v=abc&x=%22",
  "https://www.youtube.com/watch?v=abc#frag",
  " https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ ",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ\n",
  "https://vimeo.com/channels/staffpicks",
  "https://vimeo.com/x.com/a/status/1",
  "https://player.vimeo.com/video/abc",
  // no texto
  "",
  null,
  undefined,
  42,
  {},
  "https://www.youtube.com/watch?v=" + "a".repeat(3000),
];

test("acepta los videos de YouTube y Vimeo", () => {
  for (const url of VALIDAS) assert.equal(E.esEmbebiblePermitido(url), true, url);
});

test("rechaza cualquier otra dirección", () => {
  for (const url of INVALIDAS) {
    assert.equal(E.esEmbebiblePermitido(url), false, String(url));
  }
});

test("devuelve siempre un booleano (Excalidraw no cae en su propia lista)", () => {
  for (const url of [...VALIDAS, ...INVALIDAS]) {
    assert.equal(typeof E.esEmbebiblePermitido(url), "boolean");
  }
});

test("lo aceptado es lo que Excalidraw convierte en reproductor", () => {
  // Copias de RE_YOUTUBE y RE_VIMEO de Excalidraw 0.18.1 (element/embeddable.ts):
  // si una URL aceptada no las cumpliera, Excalidraw la trataría como página
  // genérica en lugar de reproductor.
  const RE_YOUTUBE =
    /^(?:http(?:s)?:\/\/)?(?:www\.)?youtu(?:be\.com|\.be)\/(embed\/|watch\?v=|shorts\/|playlist\?list=|embed\/videoseries\?list=)?([a-zA-Z0-9_-]+)(?:\?t=|&t=|\?start=|&start=)?([a-zA-Z0-9_-]+)?[^\s]*$/;
  const RE_VIMEO =
    /^(?:http(?:s)?:\/\/)?(?:(?:w){3}\.)?(?:player\.)?vimeo\.com\/(?:video\/)?([^?\s]+)(?:\?.*)?$/;
  for (const url of VALIDAS) {
    const yt = url.match(RE_YOUTUBE);
    const vm = url.match(RE_VIMEO);
    assert.ok(yt?.[2] || /^\d+$/.test(vm?.[1] ?? ""), url);
  }
});

test("quita el HTML guardado en los elementos iframe", () => {
  const elementos = [
    { id: "a", type: "rectangle", customData: { generationData: { html: "x" } } },
    {
      id: "b",
      type: "iframe",
      customData: { generationData: { status: "done", html: "<p>x</p>" }, otro: 1 },
    },
    { id: "c", type: "iframe" },
  ];
  const limpios = E.sinContenidoGenerado(elementos);
  assert.notEqual(limpios, elementos);
  assert.deepEqual(limpios[0], elementos[0], "otros tipos no se tocan");
  assert.deepEqual(limpios[1], { id: "b", type: "iframe", customData: { otro: 1 } });
  assert.equal(limpios[2], elementos[2]);
  assert.ok("generationData" in elementos[1].customData, "no muta la entrada");
});

test("sin nada que quitar devuelve el mismo arreglo", () => {
  const elementos = [{ id: "a", type: "embeddable", link: "https://youtu.be/x" }, null];
  assert.equal(E.sinContenidoGenerado(elementos), elementos);
});

test("lo pegado entra sin el HTML guardado y el pegado sigue", () => {
  const datos = {
    elements: [{ id: "b", type: "iframe", customData: { generationData: { html: "x" } } }],
    files: {},
  };
  assert.equal(E.pegadoSinContenidoGenerado(datos), true);
  assert.deepEqual(datos.elements, [{ id: "b", type: "iframe", customData: {} }]);
  const soloTexto = { text: "hola" };
  assert.equal(E.pegadoSinContenidoGenerado(soloTexto), true);
  assert.deepEqual(soloTexto, { text: "hola" });
});

test("la biblioteca se limpia ítem por ítem, y null si no hay nada que quitar", () => {
  const limpio = { id: "1", status: "unpublished", created: 1, elements: [{ type: "rectangle" }] };
  const sucio = {
    id: "2",
    status: "unpublished",
    created: 2,
    elements: [{ type: "iframe", customData: { generationData: { html: "x" } } }],
  };
  const salida = E.bibliotecaSinContenidoGenerado([limpio, sucio]);
  assert.equal(salida[0], limpio);
  assert.deepEqual(salida[1], { ...sucio, elements: [{ type: "iframe", customData: {} }] });
  assert.equal(E.bibliotecaSinContenidoGenerado([limpio]), null);
  assert.equal(E.bibliotecaSinContenidoGenerado([]), null);
});
