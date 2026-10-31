#!/usr/bin/env node
// Hook `PostToolUse` de Claude Code para un vault de Mycelium (`FUN-S-10`).
//
// Cuando la IA escribe o edita una nota `.md` del vault (Write, Edit,
// MultiEdit) y lo nuevo trae una **referencia a otra nota que Mycelium no
// cuenta como enlace**, le avisa con la lista y la forma `[[…]]` que sí cuenta:
//
//   - un enlace Markdown a un `.md` (`[texto](otra.md)`, `[t](carpeta/otra.md)`);
//   - una forma registrada en el léxico de `FUN-M-17`
//     (`.claude/enlaces-lexico.json`) escrita sin corchetes (`HU-009`, o
//     `` `HU-009` ``).
//
// Es prevención: lo que arregla la auditoría de referencias no vuelve a crecer.
// No bloquea ni reescribe: la escritura ya ocurrió, y la IA decide —un enlace
// Markdown puede tener que quedar así a propósito—. Ignora el código (bloques
// cercados y en línea), el frontmatter, las URLs, las imágenes y lo que ya es
// `[[…]]`.
//
// Lo instala Mycelium en `.claude/hooks/` al generar las instrucciones IA y lo
// registra en `.claude/settings.json`. Sin dependencias: solo `node:*`.
//
// Entrada (stdin): el JSON del hook (`tool_name`, `tool_input`, `cwd`).
// Salida: nada, o `additionalContext` con el aviso, que Claude Code le pasa al modelo.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Ruta del léxico dentro del vault (la misma que `lib/enlaces.ts`). */
export const RUTA_LEXICO = ".claude/enlaces-lexico.json";

/** Cuántas referencias se listan como mucho: el aviso no puede tapar la conversación. */
const MAXIMO = 15;

// ── Zonas donde no hay referencias ───────────────────────────────────────────

const RE_FENCE = /^([ \t]*)(`{3,}|~{3,})/;
const RE_WIKILINK = /!?\[\[[^\]\n]*\]\]/g;
const RE_URL = /\b(?:https?|ftp|mailto):\/?\/?[^\s)<>"']+/g;
const RE_CODIGO_EN_LINEA = /(`+)(.+?)\1(?!`)/g;
// `[texto](destino "título")`. El destino puede ir entre `<…>` o, aunque
// CommonMark no lo admita, con espacios sueltos (`[x](Mi nota.md)`): así lo
// escribe más de una herramienta, y sigue siendo una referencia a una nota.
const RE_ENLACE_MD = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\n]+?)(?:\s+"[^"\n]*")?\s*\)/g;

/**
 * Rangos `[desde, hasta)` donde no se busca nada: frontmatter, bloques
 * cercados (sin cerrar: hasta el final), `[[enlaces]]` y URLs.
 */
export function zonasProtegidas(texto) {
  const zonas = [];
  const lineas = texto.split("\n");
  const inicios = [];
  let acumulado = 0;
  for (const l of lineas) {
    inicios.push(acumulado);
    acumulado += l.length + 1;
  }
  const sinCr = (l) => (l.endsWith("\r") ? l.slice(0, -1) : l);
  if (lineas.length > 1 && sinCr(lineas[0]) === "---") {
    for (let i = 1; i < lineas.length; i++) {
      const t = sinCr(lineas[i]);
      if (t === "---" || t === "...") {
        zonas.push({ desde: 0, hasta: inicios[i] + lineas[i].length });
        break;
      }
    }
  }
  let abierto = null;
  for (let i = 0; i < lineas.length; i++) {
    const m = RE_FENCE.exec(sinCr(lineas[i]));
    if (abierto === null) {
      if (m) abierto = { char: m[2][0], largo: m[2].length, desde: inicios[i] };
      continue;
    }
    if (m && m[2][0] === abierto.char && m[2].length >= abierto.largo) {
      zonas.push({ desde: abierto.desde, hasta: inicios[i] + lineas[i].length });
      abierto = null;
    }
  }
  if (abierto !== null) zonas.push({ desde: abierto.desde, hasta: texto.length });
  for (const re of [RE_WIKILINK, RE_URL]) {
    for (const m of texto.matchAll(re)) zonas.push({ desde: m.index, hasta: m.index + m[0].length });
  }
  return zonas;
}

const dentroDe = (zonas, desde, hasta) => zonas.some((z) => desde < z.hasta && hasta > z.desde);

/** Los tramos de código en línea, fuera de las zonas protegidas. */
function codigoEnLinea(texto, zonas) {
  const out = [];
  for (const m of texto.matchAll(RE_CODIGO_EN_LINEA)) {
    const r = { desde: m.index, hasta: m.index + m[0].length, interior: m[2] };
    if (!dentroDe(zonas, r.desde, r.hasta)) out.push(r);
  }
  return out;
}

// ── Léxico ───────────────────────────────────────────────────────────────────

/**
 * Las formas del léxico, de la más larga a la más corta (una corta no parte a
 * una larga). Tolera un léxico ausente o roto: sin léxico, solo se buscan los
 * enlaces Markdown.
 */
export function formasDelLexico(json) {
  let crudo;
  try {
    crudo = JSON.parse(json);
  } catch {
    return [];
  }
  const destinos = crudo && typeof crudo.destinos === "object" && crudo.destinos !== null ? crudo.destinos : {};
  const out = [];
  for (const [destino, d] of Object.entries(destinos)) {
    if (!d || typeof d.titulo !== "string" || !Array.isArray(d.formas)) continue;
    for (const forma of d.formas) {
      if (typeof forma === "string" && forma.trim() !== "") out.push({ forma, destino, titulo: d.titulo });
    }
  }
  return out.sort((a, b) => b.forma.length - a.forma.length);
}

/** Carácter que continúa una palabra: `HU-0091` no contiene a `HU-009`. */
const esDePalabra = (c) => c !== undefined && /[\p{L}\p{N}_-]/u.test(c);

// ── Detección ────────────────────────────────────────────────────────────────

/** Título de una nota a partir de su ruta: el nombre sin `.md`. */
const tituloDe = (ruta) => ruta.slice(ruta.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** La forma `[[…]]` para una nota, un texto visible y un ancla. */
function wikilink(titulo, visible, ancla) {
  const destino = ancla ? `${titulo}#${ancla}` : titulo;
  const mostrar = visible.trim();
  return mostrar === "" || mostrar.toLowerCase() === titulo.toLowerCase() ? `[[${destino}]]` : `[[${destino}|${mostrar}]]`;
}

/**
 * Las referencias sin enlazar de `texto`, la nota en `nota` (ruta relativa al
 * vault, con `/`). Pura: el disco entra por `existe(rutaRelativa)`.
 *
 * - `rangos`: si se da, solo cuenta lo que cae (al menos en parte) dentro de
 *   alguno —lo que escribió esta edición—; sin `rangos`, todo el texto.
 * - `formas`: las de `formasDelLexico`.
 *
 * Devuelve `{ original, sugerencia, linea, tipo }` por aparición, en orden.
 */
export function detectar({ texto, nota, formas = [], existe = () => true, rangos = null }) {
  const zonas = zonasProtegidas(texto);
  const codigo = codigoEnLinea(texto, zonas);
  const enEdicion = (desde, hasta) => rangos === null || dentroDe(rangos, desde, hasta);
  const linea = (i) => texto.slice(0, i).split("\n").length;
  const carpeta = nota.includes("/") ? nota.slice(0, nota.lastIndexOf("/")) : "";
  const encontradas = [];
  const enlacesMd = [];

  // 1. Enlaces Markdown a una nota del vault.
  for (const m of texto.matchAll(RE_ENLACE_MD)) {
    const desde = m.index;
    const hasta = desde + m[0].length;
    enlacesMd.push({ desde, hasta });
    if (m[1] === "!") continue; // una imagen
    if (dentroDe(zonas, desde, hasta) || dentroDe(codigo, desde, hasta) || !enEdicion(desde, hasta)) continue;
    let destino = m[3].startsWith("<") ? m[3].slice(1, -1) : m[3];
    if (/^[a-z][a-z0-9+.-]*:/i.test(destino)) continue; // http:, mailto:, file:…
    const almohadilla = destino.indexOf("#");
    const ancla = almohadilla >= 0 ? destino.slice(almohadilla + 1) : "";
    destino = almohadilla >= 0 ? destino.slice(0, almohadilla) : destino;
    try {
      destino = decodeURIComponent(destino);
    } catch {
      // Un `%` suelto: se usa tal cual.
    }
    if (!/\.md$/i.test(destino)) continue; // un .png, un .pdf, una carpeta
    // Relativo a la carpeta de la nota; si ahí no está, a la raíz del vault.
    const candidatas = destino.startsWith("/")
      ? [destino.replace(/^\/+/, "")]
      : [normalizar(carpeta ? `${carpeta}/${destino}` : destino), normalizar(destino)];
    const validas = candidatas.filter((c) => c !== null);
    if (validas.length === 0) continue; // sale del vault
    const enDisco = validas.find((c) => existe(c));
    const ruta = enDisco ?? validas[0];
    encontradas.push({
      original: m[0],
      sugerencia: wikilink(tituloDe(ruta), m[2], ancla ? decodificar(ancla) : ""),
      linea: linea(desde),
      tipo: enDisco ? "enlace-markdown" : "enlace-markdown-roto",
      desde,
    });
  }

  // 2. Formas del léxico sin corchetes.
  const tomado = [];
  const bajo = texto.toLowerCase();
  for (const f of formas) {
    if (f.destino === nota) continue; // la nota nombrándose a sí misma
    const aguja = f.forma.toLowerCase();
    for (let desde = bajo.indexOf(aguja); desde !== -1; desde = bajo.indexOf(aguja, desde + 1)) {
      const hasta = desde + aguja.length;
      if (esDePalabra(texto[desde - 1]) || esDePalabra(texto[hasta])) continue;
      if (dentroDe(zonas, desde, hasta) || dentroDe(enlacesMd, desde, hasta) || dentroDe(tomado, desde, hasta)) continue;
      // En código en línea, solo si el código ES la forma (`HU-009`): un
      // identificador dentro de un fragmento de código no es una referencia.
      const tramo = codigo.find((c) => desde < c.hasta && hasta > c.desde);
      let original = texto.slice(desde, hasta);
      let inicio = desde;
      let fin = hasta;
      if (tramo) {
        if (tramo.interior.trim().toLowerCase() !== aguja) continue;
        original = texto.slice(tramo.desde, tramo.hasta);
        inicio = tramo.desde;
        fin = tramo.hasta;
      } else if (texto[desde - 1] === "[" || texto[hasta] === "]") {
        continue; // dentro de unos corchetes que son otra cosa
      }
      if (!enEdicion(inicio, fin)) continue;
      tomado.push({ desde: inicio, hasta: fin });
      encontradas.push({
        original,
        sugerencia: wikilink(f.titulo, texto.slice(desde, hasta), ""),
        linea: linea(inicio),
        tipo: "lexico",
        desde: inicio,
      });
    }
  }

  return encontradas.sort((a, b) => a.desde - b.desde).map(({ desde: _, ...r }) => r);
}

/** `a/./b/../c.md` → `a/c.md`; `null` si sale del vault. */
function normalizar(ruta) {
  const partes = [];
  for (const p of ruta.replace(/\\/g, "/").split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (partes.length === 0) return null;
      partes.pop();
    } else partes.push(p);
  }
  return partes.join("/");
}

function decodificar(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** El aviso para la IA. `null` si no hay nada que decir. */
export function aviso(nota, referencias) {
  if (referencias.length === 0) return null;
  // Una línea por referencia distinta, con todas las líneas donde aparece.
  const porTexto = new Map();
  for (const r of referencias) {
    const clave = `${r.original}\u0000${r.sugerencia}`;
    const previa = porTexto.get(clave);
    if (previa) previa.lineas.push(r.linea);
    else porTexto.set(clave, { ...r, lineas: [r.linea] });
  }
  const filas = [...porTexto.values()];
  const lista = filas.slice(0, MAXIMO).map((r) => {
    const lineas = [...new Set(r.lineas)];
    const donde = `línea${lineas.length > 1 ? "s" : ""} ${lineas.join(", ")}`;
    const extra =
      r.tipo === "lexico"
        ? ", forma del léxico"
        : r.tipo === "enlace-markdown-roto"
          ? ", y esa nota no existe todavía"
          : "";
    return `- ${r.original} → ${r.sugerencia} (${donde}${extra})`;
  });
  if (filas.length > MAXIMO) lista.push(`- … y ${filas.length - MAXIMO} más.`);
  return [
    `Mycelium: «${nota}» tiene ${filas.length === 1 ? "una referencia" : `${filas.length} referencias`} a otras notas ` +
      "que Mycelium no cuenta como enlace: no aparecen en el grafo ni en los backlinks. " +
      "Conviértelas a la forma [[…]] que se sugiere:",
    ...lista,
    "Si alguna no es una referencia a una nota (o tiene que quedar así a propósito), deja el texto como está.",
  ].join("\n");
}

// ── Disco y entrada ──────────────────────────────────────────────────────────

/** Lo que escribió la herramienta: el contenido entero o los fragmentos nuevos. */
export function fragmentosDe(herramienta, entrada) {
  if (!entrada || typeof entrada !== "object") return [];
  if (herramienta === "Write") return typeof entrada.content === "string" ? [entrada.content] : [];
  if (herramienta === "Edit") return typeof entrada.new_string === "string" ? [entrada.new_string] : [];
  if (herramienta === "MultiEdit" && Array.isArray(entrada.edits)) {
    return entrada.edits.map((e) => e?.new_string).filter((s) => typeof s === "string");
  }
  return [];
}

/**
 * Dónde quedaron los fragmentos en el archivo. Un fragmento que no se
 * encuentra (otro proceso lo cambió después) no limita nada: se mira entero.
 */
export function rangosDe(texto, fragmentos) {
  const rangos = [];
  for (const f of fragmentos) {
    if (f === "") continue;
    let i = texto.indexOf(f);
    if (i === -1) return null;
    for (; i !== -1; i = texto.indexOf(f, i + f.length)) rangos.push({ desde: i, hasta: i + f.length });
  }
  return rangos;
}

function principal() {
  let entrada = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (entrada += d));
  process.stdin.on("end", () => {
    try {
      const datos = JSON.parse(entrada);
      // Este archivo vive en <vault>/.claude/hooks/.
      const vault = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
      const archivo = datos?.tool_input?.file_path;
      if (typeof archivo !== "string" || !/\.md$/i.test(archivo)) return;
      const cwd = typeof datos?.cwd === "string" ? datos.cwd : process.cwd();
      const nota = relative(vault, resolve(cwd, archivo)).replace(/\\/g, "/");
      if (nota === "" || nota.startsWith("..") || isAbsolute(nota)) return;
      // Lo oculto (`.claude/`, `.mycelium/`) y las dependencias no son notas.
      if (nota.split("/").some((p) => p.startsWith(".") || p === "node_modules")) return;
      const fragmentos = fragmentosDe(datos.tool_name, datos.tool_input);
      if (fragmentos.length === 0) return;
      let texto;
      try {
        texto = readFileSync(resolve(vault, nota), "utf8");
      } catch {
        texto = fragmentos.join("\n");
      }
      let lexico = "";
      try {
        lexico = readFileSync(resolve(vault, RUTA_LEXICO), "utf8");
      } catch {
        // Sin léxico: solo enlaces Markdown.
      }
      const rangos = datos.tool_name === "Write" ? null : rangosDe(texto, fragmentos);
      const referencias = detectar({
        texto,
        nota,
        formas: formasDelLexico(lexico),
        existe: (rel) => existsSync(resolve(vault, rel)),
        rangos,
      });
      const mensaje = aviso(nota, referencias);
      if (!mensaje) return;
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: mensaje } }),
      );
    } catch {
      // Un aviso que falla no puede molestar a la IA: no se dice nada.
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) principal();
