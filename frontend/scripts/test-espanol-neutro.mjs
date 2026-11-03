// Test del registro de los textos que ve el usuario: español neutro, con tuteo,
// sin voseo ni modismos rioplatenses (regla del usuario, 2026-11-02).
//
// Recorre los textos visibles de la interfaz y de la ayuda integrada:
//
// - `components/`, `app/`, `lib/`, `stores/` (TS/TSX), `src-tauri/src/` y
//   `src-tauri/crates/` (Rust), `ayuda/**` (Markdown) y la plantilla de snippets
//   `public/plantilla-estilos.css` (sus comentarios son el texto que lee el usuario).
// - En el código se saltan los comentarios (no son visibles): líneas que empiezan
//   con `//`, `*`, `/*` o `{/*`, el resto de una línea tras ` //` y los bloques
//   `/* … */`. Es una heurística por línea, a propósito: un error de cálculo no se
//   arrastra al resto del archivo.
// - Quedan afuera los templates del framework de IA del vault (`lib/ia/**`,
//   `hookMvRmGenerado.ts`: se versionan aparte), `lib/ayuda/paginasGeneradas.ts`
//   (se genera desde `ayuda/**`, que sí se revisa) y las hojas `.module.css` (solo
//   llevan comentarios de código).
//
// Qué cuenta como voseo:
//
// - Una palabra aguda terminada en `-ás`, `-és` o `-ís` («podés», «tenés»,
//   «escribís»), salvo las que no son verbos o son tuteo («más», «después»,
//   «estás») y los futuros en `-rás` («verás»).
// - Un imperativo agudo en `-á` («guardá», «tocá»), salvo los futuros en `-rá`.
// - Una lista cerrada de imperativos en `-é`/`-í` y con enclíticos («hacé»,
//   «elegí», «abrilo», «fijate»), que sin diccionario no se distinguen del
//   pretérito («quité», «abrí» la nota), y los modismos («vos», «acá», «tipear»).
//
//   node --test scripts/test-espanol-neutro.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORIOS = ["components", "app", "lib", "stores", "ayuda", "src-tauri/src", "src-tauri/crates", "public"];
const EXTENSIONES = /\.(tsx?|mjs|rs|md|css)$/;

/** Archivos cuyos textos ve el usuario (rutas relativas con `/`). */
function archivos() {
  const out = [];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!["node_modules", "target", "generated"].includes(e.name)) recorrer(p);
      } else if (EXTENSIONES.test(e.name)) out.push(relative(FRONTEND, p).replace(/\\/g, "/"));
    }
  };
  for (const d of DIRECTORIOS) recorrer(join(FRONTEND, d));
  return out.filter(
    (f) =>
      !f.startsWith("lib/ia/") &&
      !/hookMvRmGenerado|paginasGeneradas/.test(f) &&
      (!f.startsWith("public/") || f === "public/plantilla-estilos.css") &&
      (!f.endsWith(".css") || f === "public/plantilla-estilos.css"),
  );
}

/** Por línea, una función que dice si una columna cae en un comentario de código. */
function comentarios(ruta, texto) {
  const codigo = /\.(tsx?|mjs|rs)$/.test(ruta);
  let enBloque = false;
  return texto.split("\n").map((linea) => {
    if (!codigo) return { linea, comentario: () => false };
    const venia = enBloque;
    const abre = linea.lastIndexOf("/*");
    const cierra = linea.lastIndexOf("*/");
    const abreEnString = /['"`]\/\*/.test(linea);
    enBloque = venia ? cierra < 0 || abre > cierra : abre >= 0 && abre > cierra && !abreEnString;
    if (venia && cierra >= 0) {
      const fin = linea.indexOf("*/") + 2;
      return { linea, comentario: (c) => c < fin };
    }
    if (venia || /^(\/\/|\*|\/\*|\{\/\*)/.test(linea.trim())) return { linea, comentario: () => true };
    let corte = -1;
    for (const m of linea.matchAll(/(^|\s)\/\//g)) {
      const antes = linea.slice(0, m.index);
      const par = (ch) => (antes.split(ch).length - 1) % 2 === 0;
      if (par('"') && par("`") && par("'")) {
        corte = m.index;
        break;
      }
    }
    const bloque = abre >= 0 && !abreEnString ? abre : -1;
    return {
      linea,
      comentario: (c) => (corte >= 0 && c > corte) || (bloque >= 0 && c > bloque && (cierra < bloque || c < cierra)),
    };
  });
}

// Agudas en -ás/-és/-ís que no son voseo.
const AGUDAS_BIEN = new Set([
  "más", "demás", "además", "atrás", "detrás", "jamás", "quizás", "estás", "compás",
  "después", "revés", "través", "estés", "inglés", "francés", "portugués", "japonés", "interés", "cortés", "estrés",
  "país", "maíz", "raíz", "anís", "parís",
]);
// Agudas en -á que no son imperativos.
const EN_A_BIEN = new Set(["está", "allá", "quizá", "sofá", "mamá", "papá", "ojalá", "acullá", "panamá", "canadá"]);
// Lista cerrada: imperativos en -é/-í, con enclíticos, y modismos.
const LISTA = new Set([
  "vos", "acá", "tipear", "tipeá", "fijate", "fijá", "fijás", "prendé", "chequeá", "andá", "vení", "decí", "salí", "sos",
  "hacé", "poné", "volvé", "mové", "leé", "anteponé", "prendé", "tené", "podé", "sabé", "corré", "escogé", "mantené",
  "abrí", "elegí", "escribí", "repetí", "seguí", "pedí", "decidí", "incluí", "subí", "imprimí", "permití", "compartí", "añadí",
  "abrilo", "abrila", "abrime", "decíselo", "decime", "corregilo", "cerrala", "ponelo", "recordame", "generala", "generalas",
  "actualizalas", "usala", "usalo", "creala", "crealo", "revisalo", "revisalos", "comprobalo", "apagalo", "editalo", "contáselo",
  "arreglalo", "arreglala", "arreglalas", "arreglalos", "omitila", "partilo", "partilas", "borralo", "borrala", "borralas",
  "encerrala", "encadenalos", "escribila", "escribilo", "arrastralos", "soltalos", "dejalo", "dejala", "dejalos", "leelos",
  "elegilo", "elegila", "miralo", "mirala", "avisale", "avisame", "preguntale", "pedila", "pedile", "pedilo", "guardalo",
  "guardala", "hacelo", "fijate", "acordate", "asegurate", "probalo", "mostrame", "decile", "contame",
]);
// Lo que se deja a propósito: «archivo:texto de la línea» que contiene la forma.
const EXCEPCIONES = [
  // El test de la bienvenida lista el voseo que prohíbe.
  { archivo: "src-tauri/src/bienvenida.rs", linea: /for voseo in/ },
  // Las herramientas MCP responden en primera persona del pretérito: «Abrí «Plan» en el panel 1».
  { archivo: /^src-tauri\/crates\/mycelium-mcp\//, palabra: "abrí" },
];

function esVoseo(palabra) {
  const w = palabra.toLowerCase();
  if (LISTA.has(w)) return true;
  if (w.length >= 4 && /(ás|és|ís)$/.test(w)) return !AGUDAS_BIEN.has(w) && !/rás$/.test(w);
  if (w.length >= 4 && /á$/.test(w)) return !EN_A_BIEN.has(w) && !/rá$/.test(w);
  return false;
}

function exceptuado(ruta, linea, palabra) {
  return EXCEPCIONES.some(
    (e) =>
      (typeof e.archivo === "string" ? e.archivo === ruta : e.archivo.test(ruta)) &&
      (!e.linea || e.linea.test(linea)) &&
      (!e.palabra || e.palabra === palabra.toLowerCase()),
  );
}

/** Todas las apariciones de voseo en textos visibles: `ruta:línea: [forma] texto`. */
export function buscarVoseo() {
  const hallazgos = [];
  for (const ruta of archivos()) {
    const texto = readFileSync(join(FRONTEND, ruta), "utf8");
    comentarios(ruta, texto).forEach(({ linea, comentario }, i) => {
      // `\n` dentro de un string: la `n` no es parte de la palabra que sigue.
      for (const m of linea.matchAll(/(?:(?<=\\[nt])|(?<!\p{L}))\p{L}+/gu)) {
        if (!esVoseo(m[0]) || comentario(m.index) || exceptuado(ruta, linea, m[0])) continue;
        hallazgos.push(`${ruta}:${i + 1}: [${m[0]}] ${linea.trim().slice(0, 160)}`);
      }
    });
  }
  return hallazgos;
}

test("los textos visibles y la ayuda están en español neutro, sin voseo", () => {
  const hallazgos = buscarVoseo();
  assert.deepEqual(hallazgos, [], `Voseo o modismos en textos visibles:\n${hallazgos.join("\n")}`);
});

test("el detector reconoce el voseo y deja pasar el tuteo", () => {
  for (const w of ["podés", "Tenés", "escribís", "guardá", "Elegí", "abrilo", "vos", "acá", "hacé"]) assert.ok(esVoseo(w), w);
  for (const w of ["puedes", "más", "después", "está", "verás", "guardará", "quité", "estás", "aquí", "elige", "ábrelo"])
    assert.ok(!esVoseo(w), w);
});
