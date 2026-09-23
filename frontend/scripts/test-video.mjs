// Test headless del reconocedor de vídeos embebidos (`FUN-S-21`).
//
// `lib/video.ts` es puro —sin imports—, así que se transpila en el momento y se
// importa vía data: URL, igual que el resto de los núcleos del proyecto.
//
//   node --test scripts/test-video.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const rutaTs = fileURLToPath(new URL("../lib/video.ts", import.meta.url));
const { outputText } = ts.transpileModule(await readFile(rutaTs, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { ALLOW_VIDEO, esVideo, leerVideo, SANDBOX_VIDEO, tituloDeVideo } = await import(
  `data:text/javascript,${encodeURIComponent(outputText)}`
);

const ID = "dQw4w9WgXcQ"; // 11 caracteres, como todos los de YouTube

test("las formas de YouTube que la gente pega de verdad", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ]) {
    const v = leerVideo(url);
    assert.ok(v, `no reconoció ${url}`);
    assert.equal(v.proveedor, "youtube");
    assert.equal(v.id, ID);
  }
});

test("el reproductor va por youtube-nocookie, siempre", () => {
  // Es la decisión de la spec: mismo reproductor, sin cookies de seguimiento
  // antes de que el usuario le dé al play.
  const v = leerVideo(`https://www.youtube.com/watch?v=${ID}`);
  assert.ok(v.src.startsWith("https://www.youtube-nocookie.com/embed/"));
  assert.ok(v.src.includes(ID));
  assert.ok(v.src.includes("rel=0"), "sin sugerencias de otros canales al terminar");
});

test("conserva el enlace original para poder ofrecerlo si no carga", () => {
  const url = `https://youtu.be/${ID}`;
  assert.equal(leerVideo(url).url, url);
});

test("los parámetros de más no estorban", () => {
  // Un enlace copiado desde el minuto 90 trae `t=`, y desde una lista trae más.
  const v = leerVideo(`https://www.youtube.com/watch?v=${ID}&t=90s&list=PLx`);
  assert.ok(v);
  assert.equal(v.id, ID);
});

test("Vimeo también", () => {
  assert.deepEqual(
    { p: leerVideo("https://vimeo.com/123456789").proveedor, i: leerVideo("https://vimeo.com/123456789").id },
    { p: "vimeo", i: "123456789" },
  );
  assert.equal(leerVideo("https://player.vimeo.com/video/123456789").id, "123456789");
  assert.equal(
    leerVideo("https://vimeo.com/123456789").src,
    "https://player.vimeo.com/video/123456789",
  );
});

test("un host que solo SE PARECE al de YouTube no cuela", () => {
  // La comparación es por host completo, no por sufijo: si no, cualquiera
  // registra `youtube.com.evil.net` y se mete en la nota como un reproductor.
  assert.equal(esVideo(`https://youtube.com.evil.net/watch?v=${ID}`), false);
  assert.equal(esVideo(`https://notyoutube.com/watch?v=${ID}`), false);
  assert.equal(esVideo(`https://evil.net/youtube.com/watch?v=${ID}`), false);
  assert.equal(esVideo(`https://vimeo.com.evil.net/123456789`), false);
});

test("un id con forma rara no se acepta", () => {
  assert.equal(esVideo("https://www.youtube.com/watch?v=corto"), false);
  assert.equal(esVideo("https://www.youtube.com/watch?v="), false);
  assert.equal(esVideo("https://www.youtube.com/watch"), false);
  assert.equal(esVideo(`https://www.youtube.com/watch?v=${ID}xx`), false, "12 caracteres");
  assert.equal(esVideo("https://vimeo.com/no-son-digitos"), false);
});

test("otras páginas de YouTube no son un vídeo", () => {
  assert.equal(esVideo("https://www.youtube.com/"), false);
  assert.equal(esVideo("https://www.youtube.com/@uncanal"), false);
  assert.equal(esVideo("https://www.youtube.com/results?search_query=x"), false);
});

test("solo http(s): nada de esquemas raros disfrazados de vídeo", () => {
  assert.equal(esVideo(`javascript:://youtu.be/${ID}`), false);
  assert.equal(esVideo(`file://youtu.be/${ID}`), false);
});

test("lo que no es un vídeo se deja pasar como lo que sea", () => {
  assert.equal(leerVideo("https://ejemplo.com/pagina"), null);
  assert.equal(leerVideo("imagen.png"), null);
  assert.equal(leerVideo(""), null);
  assert.equal(leerVideo(null), null);
  assert.equal(leerVideo(undefined), null);
});

test("el iframe NO puede compartir origen con la app", () => {
  // Con `allow-same-origin` el documento de YouTube alcanzaría el
  // `localStorage`, las cookies y el DOM de Mycelium. Es la línea que no se
  // puede cruzar, así que está fijada por test.
  assert.ok(!SANDBOX_VIDEO.includes("allow-same-origin"));
  assert.ok(!SANDBOX_VIDEO.includes("allow-top-navigation"));
  assert.ok(SANDBOX_VIDEO.includes("allow-scripts"), "sin scripts no hay reproductor");
  assert.ok(!ALLOW_VIDEO.includes("camera"));
  assert.ok(!ALLOW_VIDEO.includes("microphone"));
  assert.ok(!ALLOW_VIDEO.includes("geolocation"));
});

test("el título del reproductor dice de dónde sale", () => {
  assert.equal(tituloDeVideo(leerVideo(`https://youtu.be/${ID}`)), `Vídeo de YouTube ${ID}`);
  assert.equal(
    tituloDeVideo(leerVideo("https://vimeo.com/123456789")),
    "Vídeo de Vimeo 123456789",
  );
});
