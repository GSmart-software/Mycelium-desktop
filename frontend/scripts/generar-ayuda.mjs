// Generador de `lib/ayuda/paginasGeneradas.ts` (`FUN-L-27`, ayuda integrada).
//
// Las páginas de la ayuda se escriben como Markdown en `ayuda/` —una carpeta por
// tema, un archivo por subtema— y viajan con la app dentro de un módulo TS: la
// ayuda funciona sin conexión y no depende de ningún archivo del vault. Mismo
// circuito que `scripts/generar-skills-ia.mjs` → `lib/ia/skillsGeneradas.ts`:
// los `.md` son la FUENTE DE VERDAD y el módulo se regenera, nunca se edita.
//
//   node scripts/generar-ayuda.mjs              (regenera el módulo)
//   node scripts/generar-ayuda.mjs --comprobar  (exit 1 si está desactualizado)
//
// `npm run dev` lo regenera al arrancar y `npm run build` lo comprueba: un
// build con el módulo viejo falla en vez de publicar una ayuda desfasada.
// `scripts/test-ayuda.mjs` comprueba lo mismo y además la cobertura.
//
// Formato (detalle en docs/features/ayuda-integrada.md § «Implementación de la
// parte A»):
//
//   ayuda/<NN-tema>/<NN-subtema>.md
//
//   ---
//   titulo: Énfasis
//   tema: Escribir notas
//   sinonimos: [negrita, cursiva, guion bajo]
//   solo: desktop
//   cubre: [markdown]
//   estado: pendiente
//   ---
//   Cuerpo en Markdown. Un bloque ```ejemplo se muestra como fuente + render.
//
// El número de la carpeta y del archivo da el ORDEN; el resto del nombre, el
// identificador (`escribir-notas/enfasis`), que es lo que usan los enlaces
// `ayuda:` entre páginas. El frontmatter es un mapa plano (el mismo subconjunto
// que entiende Mycelium), así que se lee acá sin dependencias.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
export const CARPETA = "ayuda";
const SALIDA = "lib/ayuda/paginasGeneradas.ts";

/** `NN-slug`: dos dígitos de orden y un identificador en minúsculas. */
const NOMBRE_RE = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** Las claves que admite el frontmatter de una página, y si son listas. */
const CLAVES = {
  titulo: "texto",
  tema: "texto",
  sinonimos: "lista",
  solo: "texto",
  cubre: "lista",
  estado: "texto",
};

const leer = (ruta) => readFileSync(ruta, "utf8").replace(/\r\n?/g, "\n");

/** Frontmatter plano → `{ datos, cuerpo }`. Lanza con el motivo si no se entiende. */
export function leerFrontmatter(texto, rel) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(texto);
  if (!m) throw new Error(`${rel}: falta el frontmatter (--- … ---) al principio`);
  const datos = {};
  for (const linea of m[1].split("\n")) {
    if (!linea.trim() || linea.trimStart().startsWith("#")) continue;
    const kv = /^([a-z]+):\s*(.*)$/.exec(linea);
    if (!kv) throw new Error(`${rel}: línea de frontmatter que no se entiende: «${linea}»`);
    const [, clave, crudo] = kv;
    const tipo = CLAVES[clave];
    if (!tipo) throw new Error(`${rel}: clave desconocida «${clave}» (válidas: ${Object.keys(CLAVES).join(", ")})`);
    if (clave in datos) throw new Error(`${rel}: clave repetida «${clave}»`);
    const valor = crudo.trim();
    if (tipo === "lista") {
      const l = /^\[(.*)\]$/.exec(valor);
      if (!l) throw new Error(`${rel}: «${clave}» tiene que ser una lista [a, b]`);
      datos[clave] = l[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      datos[clave] = valor.replace(/^["']|["']$/g, "");
    }
  }
  return { datos, cuerpo: texto.slice(m[0].length).replace(/^\n+/, "") };
}

/**
 * El texto plano de una página, para el buscador: sin la sintaxis de Markdown
 * pero CON el contenido de los ejemplos, que también es algo que se busca.
 */
export function textoPlano(md) {
  return md
    .replace(/^ {0,3}(`{3,}|~{3,}).*$/gm, " ")
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*>\s*\[![\w-]+\][-+]?/gm, " ")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)]|\|)\s?/gm, " ")
    .replace(/[*_~`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const listarDirs = (ruta) =>
  readdirSync(ruta)
    .filter((n) => statSync(join(ruta, n)).isDirectory())
    .sort();

/** Las páginas, en orden de índice. Lanza ante cualquier inconsistencia de formato. */
export function leerAyuda() {
  const base = resolve(RAIZ, CARPETA);
  const temas = [];
  for (const dir of listarDirs(base)) {
    const md = NOMBRE_RE.exec(dir);
    if (!md) throw new Error(`${CARPETA}/${dir}: la carpeta de un tema se llama NN-slug (p. ej. 02-escribir-notas)`);
    const temaSlug = md[2];
    const archivos = readdirSync(join(base, dir))
      .filter((n) => n.endsWith(".md"))
      .sort();
    if (archivos.length === 0) throw new Error(`${CARPETA}/${dir}: tema sin páginas`);
    let temaTitulo = null;
    const paginas = [];
    for (const archivo of archivos) {
      const rel = `${CARPETA}/${dir}/${archivo}`;
      const ma = NOMBRE_RE.exec(archivo.slice(0, -3));
      if (!ma) throw new Error(`${rel}: el archivo de una página se llama NN-slug.md (p. ej. 03-enfasis.md)`);
      const { datos, cuerpo } = leerFrontmatter(leer(join(base, dir, archivo)), rel);
      if (!datos.titulo) throw new Error(`${rel}: falta «titulo»`);
      if (!datos.tema) throw new Error(`${rel}: falta «tema»`);
      if (temaTitulo === null) temaTitulo = datos.tema;
      else if (datos.tema !== temaTitulo) {
        throw new Error(`${rel}: «tema: ${datos.tema}» no coincide con el resto de la carpeta («${temaTitulo}»)`);
      }
      if (datos.solo !== undefined && datos.solo !== "desktop" && datos.solo !== "web") {
        throw new Error(`${rel}: «solo» admite desktop o web`);
      }
      if (datos.estado !== undefined && datos.estado !== "pendiente") {
        throw new Error(`${rel}: «estado» solo admite pendiente (una página escrita no lleva estado)`);
      }
      const pendiente = datos.estado === "pendiente";
      if (!pendiente && !cuerpo.trim()) throw new Error(`${rel}: página sin contenido (¿falta estado: pendiente?)`);
      paginas.push({
        id: `${temaSlug}/${ma[2]}`,
        archivo: rel,
        titulo: datos.titulo,
        tema: datos.tema,
        solo: datos.solo ?? null,
        pendiente,
        cubre: datos.cubre ?? [],
        sinonimos: datos.sinonimos ?? [],
        cuerpo: pendiente ? "" : cuerpo,
        texto: pendiente ? "" : textoPlano(cuerpo),
      });
    }
    temas.push({ slug: temaSlug, titulo: temaTitulo, paginas });
  }
  return temas;
}

/** El texto de `lib/ayuda/paginasGeneradas.ts`. */
export function generarModulo(temas = leerAyuda()) {
  const lit = (v) => JSON.stringify(v);
  const pagina = (p) =>
    [
      "      {",
      `        id: ${lit(p.id)},`,
      `        titulo: ${lit(p.titulo)},`,
      `        tema: ${lit(p.tema)},`,
      `        solo: ${lit(p.solo)},`,
      `        pendiente: ${lit(p.pendiente)},`,
      `        cubre: ${lit(p.cubre)},`,
      `        sinonimos: ${lit(p.sinonimos)},`,
      `        cuerpo: ${lit(p.cuerpo)},`,
      `        texto: ${lit(p.texto)},`,
      "      },",
    ].join("\n");
  const tema = (t) =>
    ["  {", `    slug: ${lit(t.slug)},`, `    titulo: ${lit(t.titulo)},`, "    paginas: [", ...t.paginas.map(pagina), "    ],", "  },"].join(
      "\n",
    );
  return `// GENERADO por scripts/generar-ayuda.mjs — NO EDITAR A MANO.
// Fuente: ayuda/<NN-tema>/<NN-subtema>.md. Para regenerar:
//
//   node scripts/generar-ayuda.mjs   (o npm run generar-ayuda)

/** Una página de la ayuda (\`FUN-L-27\`). */
export type PaginaAyuda = {
  /** \`<tema>/<subtema>\`, sin los números de orden: lo que usan los enlaces \`ayuda:\`. */
  id: string;
  titulo: string;
  tema: string;
  /** Solo existe en esa versión; \`null\` = en las dos. */
  solo: "desktop" | "web" | null;
  /** Está en el índice pero todavía no se escribió («próximamente»). */
  pendiente: boolean;
  /** Herramientas que documenta (tipos de \`lib/extensionesDeTipo\`), para el test de cobertura. */
  cubre: readonly string[];
  /** Otras palabras con las que se la busca. */
  sinonimos: readonly string[];
  /** Markdown, sin el frontmatter. */
  cuerpo: string;
  /** Texto plano del cuerpo, para el buscador. */
  texto: string;
};

/** Un tema del índice, con sus páginas en orden. */
export type TemaAyuda = { slug: string; titulo: string; paginas: readonly PaginaAyuda[] };

export const TEMAS_AYUDA: readonly TemaAyuda[] = [
${temas.map(tema).join("\n")}
];
`;
}

const rutaSalida = resolve(RAIZ, SALIDA);

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  let nuevo;
  try {
    nuevo = generarModulo();
  } catch (e) {
    console.error(`ayuda: ${e.message}`);
    process.exit(1);
  }
  if (process.argv.includes("--comprobar")) {
    let actual = "";
    try {
      actual = readFileSync(rutaSalida, "utf8").replace(/\r\n/g, "\n");
    } catch {}
    if (actual !== nuevo) {
      console.error(`${SALIDA} está desactualizado: corré node scripts/generar-ayuda.mjs`);
      process.exit(1);
    }
    console.log(`${SALIDA} al día.`);
  } else {
    writeFileSync(rutaSalida, nuevo);
    const n = leerAyuda().reduce((s, t) => s + t.paginas.length, 0);
    console.log(`${SALIDA}: ${n} páginas, ${Math.round(Buffer.byteLength(nuevo) / 1024)} KB.`);
  }
}
