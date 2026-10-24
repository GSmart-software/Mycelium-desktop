/**
 * Lee la tabla `name` de un `.woff2`: el copyright (id 0), el nombre completo
 * (4), la versión (5), la licencia (13) y su URL (14) que la propia fuente
 * declara. Lo usa `preparar-excalidraw.mjs` para armar el aviso de licencia de
 * cada fuente con los datos del archivo que se distribuye, no con los de una
 * lista escrita a mano que se desactualiza sola.
 *
 * Solo lo justo del formato WOFF2 (https://www.w3.org/TR/WOFF2/): el directorio
 * de tablas y el bloque comprimido con Brotli, que `node:zlib` ya trae. La tabla
 * `name` nunca va transformada, así que sale tal cual del bloque.
 */
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

/** Etiquetas conocidas del directorio de WOFF2, por índice (§ 4.2). */
const ETIQUETAS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

/** UIntBase128 (§ 4.1). */
function base128(buf, cursor) {
  let valor = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[cursor.p++];
    valor = valor * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return valor;
  }
  throw new Error("UIntBase128 inválido");
}

/**
 * Devuelve `{ [id]: texto }` con los registros de la tabla `name` (prefiere los
 * de la plataforma Windows/Unicode, en UTF-16BE).
 */
export function nombresWoff2(archivo) {
  const buf = readFileSync(archivo);
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${archivo} no es WOFF2`);
  const cantidad = buf.readUInt16BE(12);
  const comprimido = buf.readUInt32BE(20);
  const cursor = { p: 48 };
  const tablas = [];
  for (let i = 0; i < cantidad; i++) {
    const banderas = buf[cursor.p++];
    let etiqueta = ETIQUETAS[banderas & 0x3f];
    if ((banderas & 0x3f) === 63) {
      etiqueta = buf.toString("latin1", cursor.p, cursor.p + 4);
      cursor.p += 4;
    }
    const original = base128(buf, cursor);
    const transformacion = (banderas >> 6) & 3;
    const transformada = etiqueta === "glyf" || etiqueta === "loca" ? transformacion === 0 : transformacion !== 0;
    const largo = transformada ? base128(buf, cursor) : original;
    tablas.push({ etiqueta, largo });
  }
  const datos = brotliDecompressSync(buf.subarray(cursor.p, cursor.p + comprimido));
  let desde = 0;
  let name = null;
  for (const t of tablas) {
    if (t.etiqueta === "name") name = datos.subarray(desde, desde + t.largo);
    desde += t.largo;
  }
  if (!name) throw new Error(`${archivo} no tiene tabla name`);

  const registros = name.readUInt16BE(2);
  const inicio = name.readUInt16BE(4);
  const salida = {};
  for (let i = 0; i < registros; i++) {
    const e = 6 + i * 12;
    const plataforma = name.readUInt16BE(e);
    const id = name.readUInt16BE(e + 6);
    const largo = name.readUInt16BE(e + 8);
    const offset = name.readUInt16BE(e + 10);
    const crudo = name.subarray(inicio + offset, inicio + offset + largo);
    let texto;
    if (plataforma === 0 || plataforma === 3) {
      texto = "";
      for (let k = 0; k + 1 < crudo.length; k += 2) texto += String.fromCharCode(crudo.readUInt16BE(k));
    } else {
      texto = crudo.toString("latin1");
    }
    if (!(id in salida) || plataforma === 3) salida[id] = texto.replace(/\r\n?/g, "\n");
  }
  return salida;
}
