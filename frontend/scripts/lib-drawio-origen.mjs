// draw.io servido como lo sirve Rust (`src-tauri/src/drawio_origen.rs`, `DEF-168`),
// para los smokes que corren sin Tauri (`smoke-drawio.mjs`, `smoke-csp.mjs`).
//
// Lee la CSP (`src-tauri/drawio/csp.json`) y la guarda (`src-tauri/drawio/guarda.js`)
// de los mismos archivos que Rust incluye en el binario, así que lo que se prueba
// es la política real. Lo que replica a mano —la validación de la ruta, dónde va
// la guarda y los hashes— lo prueban los tests de Rust del módulo.
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const SRC_TAURI = resolve(import.meta.dirname, "..", "src-tauri");
const CSP = JSON.parse(await readFile(join(SRC_TAURI, "drawio", "csp.json"), "utf8"));
const GUARDA = await readFile(join(SRC_TAURI, "drawio", "guarda.js"), "utf8");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

/** `inyectar_guarda`: la guarda, primer script del documento. */
export function inyectarGuarda(html) {
  const script = `<script>${GUARDA}</script>`;
  const m = /<head[^>]*>/i.exec(html);
  if (!m) return script + html;
  const corte = m.index + m[0].length;
  return html.slice(0, corte) + script + html.slice(corte);
}

/** `hashes_en_linea`: los `<script>` en línea no vacíos, normalizados a LF. */
export function hashesEnLinea(html) {
  const hashes = [];
  for (const m of html.matchAll(/<script(?=[\s>/])([^>]*)>([\s\S]*?)<\/script/gi)) {
    if (/(^|\s)src(=|\s|$)/i.test(m[1]) || m[2].length === 0) continue;
    const texto = m[2].replace(/\r\n?/g, "\n");
    hashes.push(`'sha256-${createHash("sha256").update(texto).digest("base64")}'`);
  }
  return hashes;
}

/** `politica`: la CSP de una respuesta de draw.io. */
export function politicaDrawio(hashes, ancestros) {
  const partes = Object.entries(CSP).map(
    ([d, f]) => `${d} ${(d === "script-src" ? [...f, ...hashes] : f).join(" ")}`,
  );
  partes.push(`frame-ancestors ${ancestros.join(" ")}`);
  return partes.join("; ");
}

/**
 * La respuesta a `rutaPedida` (el `pathname`, sin decodificar) sobre `raiz` (la
 * carpeta de draw.io): `{ estado, cabeceras, cuerpo }`.
 */
export async function responderDrawio(raiz, rutaPedida, ancestros) {
  let rel;
  try {
    rel = decodeURIComponent(rutaPedida).replace(/^\//, "");
  } catch {
    rel = null;
  }
  if (rel === "") rel = "index.html";
  const limpia =
    rel !== null && rel.split("/").every((s) => s && !s.startsWith(".") && !/[\\:\0-\x1f]/.test(s));
  const ruta = limpia ? join(raiz, rel) : "";
  if (!limpia || !ruta.startsWith(raiz + sep) || !existsSync(ruta) || !statSync(ruta).isFile()) {
    return {
      estado: 404,
      cabeceras: { "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": politicaDrawio([], ancestros) },
      cuerpo: Buffer.from("Not Found"),
    };
  }
  const tipo = MIME[extname(ruta).toLowerCase()] ?? "application/octet-stream";
  let cuerpo = await readFile(ruta);
  let hashes = [];
  if (tipo.startsWith("text/html")) {
    const html = inyectarGuarda(cuerpo.toString("utf8"));
    hashes = hashesEnLinea(html);
    cuerpo = Buffer.from(html, "utf8");
  }
  return {
    estado: 200,
    cabeceras: {
      "Content-Type": tipo,
      "Content-Security-Policy": politicaDrawio(hashes, ancestros),
      "X-Content-Type-Options": "nosniff",
    },
    cuerpo,
  };
}
