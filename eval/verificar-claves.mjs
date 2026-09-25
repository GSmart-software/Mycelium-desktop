// Verifica cada clave de `eval/preguntas.jsonl` contra el corpus (el vault en el
// commit de `config.json`). «Una clave equivocada invalida la pregunta en
// silencio»: esto la hace fallar en voz alta.
//
//   node eval/verificar-claves.mjs                     # desarrollo; la reserva sigue sellada
//   node eval/verificar-claves.mjs --abrir-reserva     # todas (hace falta la clave del sello)
//   node eval/verificar-claves.mjs --borrador x.json   # un borrador en claro (array JSON)
//
// Errores (salida 1): títulos que no existen, dato que ninguna nota clave
// sostiene, C7 cuyo dato sí está en una nota, C8 que comparte vocabulario con su
// sección, sección clave que no existe. Avisos: lo que pide mirar, no cambiar.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inventario } from "./lib/corpus.mjs";
import { cargarPreguntas } from "./lib/preguntas.mjs";
import { buscarSeccion, partirSeccionClave } from "./lib/secciones.mjs";
import { contiene, normalizar, palabrasDeContenido } from "./lib/texto.mjs";
import { OPCION_VAULT, prepararCorpusDe, vaultDeArgs } from "./lib/vault.mjs";

const VAULT = vaultDeArgs();

/**
 * C9 · dato solo en un PDF (agregada para la tesina): como C7, el dato no está
 * en ninguna nota; a diferencia de C7, vive en un PDF del vault, que ni `grep`
 * ni el índice del MCP leen. Se verifica extrayendo el texto con `pdftotext`.
 */
const CLASES = new Set(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"]);
/** Clases cuyo dato vive fuera de las notas: se sostienen con `fuentes_codigo`, no con notas clave. */
const FUERA_DE_NOTAS = new Set(["C7", "C9"]);
/** `estructura`: escrita desde títulos, mapas y enlaces, sin leer la nota que responde; `usuario`: la escribió el dueño del vault. */
const FUENTES = new Set(["bandeja", "transcripcion", "sembrada", "estructura", "usuario"]);
/** La composición del vault de Mycelium (§ 2): tres por clase, dos de desarrollo y una de reserva. */
const COMPOSICION_MYCELIUM = { por_clase: { desarrollo: 2, reserva: 1 }, clases: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"] };

/** El texto de una fuente fuera de las notas: un PDF por `pdftotext`, el resto tal cual. */
export function leerFuente(dir, ruta) {
  const p = join(dir, ruta);
  if (!/\.pdf$/i.test(ruta)) return readFileSync(p, "utf8");
  const r = spawnSync("pdftotext", ["-enc", "UTF-8", "-q", p, "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`pdftotext ${ruta}: ${r.stderr || r.error}`);
  // Un PDF corta palabras con guion al final de la línea: se unen para buscar.
  return r.stdout.replace(/-\n(?=\p{Ll})/gu, "").replace(/\s+/g, " ");
}
/** Palabras que una pregunta puede compartir con cualquier sección: nombres propios del producto. */
const PERMITIDAS_C8 = new Set(["mycelium", "vault", "app", "nota", "notas"]);

function mismaPalabra(a, b) {
  return a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
}
function compartidas(a, b) {
  return [...a].filter((x) => [...b].some((y) => mismaPalabra(x, y)));
}

/**
 * El puesto de la nota `objetivo` si se ordenan todas las notas por cuántas de
 * las palabras de la pregunta contienen —lo que haría quien encadena `grep -l`
 * con cada término y abre primero las que más coinciden—. Los empates cuentan en
 * contra: el puesto es 1 + las notas con TANTAS o más coincidencias, y si
 * el título se repite vale la mejor de sus copias. `notas`: `[{t, x}]` con texto
 * normalizado.
 */
export function puestoPorGrep(palabras, notas, objetivo) {
  const ps = [...palabras];
  const puntaje = (x) => ps.filter((w) => x.includes(w)).length;
  const conTitulo = (t) => t.split(/[\\/]/).pop().replace(/\.md$/i, "").normalize("NFC");
  const scores = notas.map((n) => ({ t: conTitulo(n.t), s: puntaje(n.x) }));
  const propio = Math.max(...scores.filter((n) => n.t === objetivo).map((n) => n.s), -1);
  if (propio < 0) return Infinity;
  return 1 + scores.filter((n) => n.t !== objetivo && n.s >= propio).length;
}

/** Grupos de alternativas del dato: `requeridas`, o `aceptadas` como un solo grupo. */
function grupos(q) {
  if (q.requeridas?.length) return q.requeridas;
  return q.aceptadas?.length ? [q.aceptadas] : [];
}

/**
 * `opciones.composicion`: la del vault (`null`: no se controla); por defecto, la
 * del vault de Mycelium. `opciones.otrosTextos`: `() => [{t, x}]` con el texto
 * normalizado de los archivos de texto que no son notas (`.html`, `.txt`, código):
 * un dato de C9 tampoco puede estar ahí, o sería una C7. `opciones.todasLasNotas`:
 * `() => [{t, x}]` con TODAS las notas, también las que repiten título (el
 * inventario guarda una por título).
 */
export function verificar(preguntas, inv, leerNota, leerCodigo, claudeMd, opciones = {}) {
  const composicion = opciones.composicion === undefined ? COMPOSICION_MYCELIUM : opciones.composicion;
  const todasLasNotas = opciones.todasLasNotas ?? (() => [...inv.titulos].map((t) => ({ t, x: normalizar(leerNota(t)) })));
  const errores = [];
  const avisos = [];
  const E = (q, m) => errores.push(`${q.id}: ${m}`);
  const A = (q, m) => avisos.push(`${q.id}: ${m}`);
  const ids = new Set();

  for (const q of preguntas) {
    if (q.sellada) continue;
    if (ids.has(q.id)) E(q, "id repetido");
    ids.add(q.id);
    for (const campo of ["id", "clase", "conjunto", "pregunta", "fuente", "veredicto", "dato", "notas_clave", "notas_admisibles"])
      if (q[campo] === undefined) E(q, `falta el campo ${campo}`);
    if (!CLASES.has(q.clase)) E(q, `clase inválida ${q.clase}`);
    if (!FUENTES.has(q.fuente?.tipo)) E(q, `fuente.tipo inválido ${q.fuente?.tipo}`);
    if (!["dato", "ausencia"].includes(q.veredicto)) E(q, `veredicto inválido ${q.veredicto}`);
    if ((q.clase === "C5") !== (q.veredicto === "ausencia")) E(q, "C5 y veredicto «ausencia» van juntos");

    const planas = (q.notas_clave ?? []).flatMap((n) => (Array.isArray(n) ? n : [n]));
    for (const t of [...planas, ...(q.notas_admisibles ?? [])])
      if (!inv.titulos.has(t)) E(q, `la nota «${t}» no existe en el corpus`);
    for (const t of planas) if (!(q.notas_admisibles ?? []).includes(t)) E(q, `«${t}» es clave pero no admisible`);

    const gs = grupos(q);
    if (q.veredicto === "dato" && !gs.length) E(q, "una pregunta de dato sin aceptadas ni requeridas no se puede puntuar");

    // El dato tiene que estar sostenido por las notas clave (o por el código, en
    // C7, o por el PDF, en C9).
    const fueraDeNotas = FUERA_DE_NOTAS.has(q.clase);
    if (q.veredicto === "dato") {
      const fuentes = fueraDeNotas
        ? (q.fuentes_codigo ?? []).map((f) => ({ t: f, x: normalizar(leerCodigo(f)) }))
        : planas.filter((t) => inv.titulos.has(t)).map((t) => ({ t, x: normalizar(leerNota(t)) }));
      if (!fuentes.length) E(q, fueraDeNotas ? `${q.clase} sin fuentes_codigo` : "sin notas clave");
      if (q.clase === "C9" && (q.fuentes_codigo ?? []).some((f) => !/\.pdf$/i.test(f))) E(q, "C9 con una fuente que no es un PDF");
      for (const g of gs)
        if (!fuentes.some((f) => g.some((alt) => contiene(f.x, alt))))
          E(q, `ninguna fuente clave contiene el grupo [${g.join(" | ")}]`);
      // Cada alternativa de la lista de notas clave tiene que sostener algo por sí sola.
      if (!fueraDeNotas)
        for (const f of fuentes)
          if (!gs.some((g) => g.some((alt) => contiene(f.x, alt)))) A(q, `la nota clave «${f.t}» no contiene ninguna cadena de la clave`);
    }

    // Admisibles: tienen que hablar del tema (aviso, no error).
    const todasAlt = gs.flat();
    if (todasAlt.length)
      for (const t of q.notas_admisibles ?? [])
        if (inv.titulos.has(t) && !todasAlt.some((alt) => contiene(normalizar(leerNota(t)), alt)))
          A(q, `admisible «${t}» no contiene ninguna cadena de la clave (revisar a mano)`);

    // Los distractores tienen que existir: son tentaciones reales, no inventadas.
    for (const d of q.distractores ?? []) {
      const enVault = [...inv.titulos].some((t) => contiene(normalizar(leerNota(t)), d));
      if (!enVault) A(q, `el distractor «${d}» no aparece en ninguna nota`);
    }

    // C7 y C9: el dato NO puede estar escrito en una nota (es la definición de la
    // clase). C9, además, en ningún otro archivo de texto: solo en el PDF.
    if (fueraDeNotas) {
      if (!q.prueba_fuera_indice) E(q, `${q.clase} sin prueba_fuera_indice`);
      else {
        for (const { t, x } of todasLasNotas())
          if (contiene(x, q.prueba_fuera_indice)) E(q, `${q.clase} pero la nota «${t}» contiene el dato (${q.prueba_fuera_indice})`);
        if (q.clase === "C9")
          for (const { t, x } of opciones.otrosTextos?.() ?? [])
            if (contiene(x, q.prueba_fuera_indice)) E(q, `C9 pero el archivo de texto «${t}» contiene el dato (${q.prueba_fuera_indice})`);
      }
    }

    // C5: lo que no debe aparecer en el vault.
    if (q.clase === "C5")
      for (const p of q.no_debe_aparecer ?? [])
        for (const { t, x } of todasLasNotas()) if (contiene(x, p)) E(q, `ausencia, pero «${t}» contiene «${p}»`);

    // § 8, sesgo 1: como máximo dos palabras de contenido compartidas con el título objetivo.
    const pq = palabrasDeContenido(q.pregunta);
    for (const t of planas) {
      const c = compartidas(pq, palabrasDeContenido(t));
      if (c.length > 2) A(q, `comparte ${c.length} palabras con el título «${t}»: ${c.join(", ")}`);
    }

    // C8: ninguna palabra de contenido en común con la sección objetivo. En el
    // vault de Mycelium, con el TEXTO entero de la sección. Con `c8: "encabezados"`
    // (la tesina, donde una sección tiene miles de palabras y compartir ninguna es
    // imposible), con el título de la nota y la cadena de encabezados; y además un
    // grep de las palabras de la pregunta no puede poner la nota entre las
    // primeras `c8Puesto` (§ 8, sesgo 1, hecho mecánico).
    if (q.clase === "C8") {
      if (!q.secciones_clave?.length) E(q, "C8 sin secciones_clave");
      for (const s of q.secciones_clave ?? []) {
        const { nota, ruta } = partirSeccionClave(s);
        if (!inv.titulos.has(nota)) {
          E(q, `sección de una nota que no existe: ${s}`);
          continue;
        }
        const sec = buscarSeccion(leerNota(nota), ruta);
        if (!sec) {
          E(q, `la sección no existe: ${s}`);
          continue;
        }
        const contra = opciones.c8 === "encabezados" ? [nota, ...ruta].join(" ") : sec.texto;
        const c = compartidas(pq, palabrasDeContenido(contra)).filter((w) => !PERMITIDAS_C8.has(w));
        if (c.length) E(q, `C8 comparte vocabulario con «${s}»: ${c.join(", ")}`);
        if (opciones.c8 === "encabezados") {
          const puesto = puestoPorGrep(pq, todasLasNotas(), nota);
          const tope = opciones.c8Puesto ?? 10;
          if (puesto <= tope) E(q, `C8: un grep de sus palabras pone «${nota}» en el puesto ${puesto} (tope ${tope})`);
          else A(q, `C8: un grep de sus palabras pone «${nota}» en el puesto ${puesto}`);
        }
      }
    }

    // Contaminación previsible: el CLAUDE.md entra en todas las sesiones (§ 8, sesgo 2).
    if (q.veredicto === "dato" && gs.length && gs.every((g) => g.some((alt) => contiene(normalizar(claudeMd), alt))))
      A(q, "el CLAUDE.md contiene todas las cadenas de la clave: posible contaminación (lo decide el brazo ciego)");
  }

  // Composición (§ 2 y plan § 4.3): en el vault de Mycelium, tres por clase, dos
  // de desarrollo y una de reserva. Otro vault declara la suya, o ninguna.
  if (composicion) {
    const porClase = {};
    for (const q of preguntas) if (!q.retirada) (porClase[q.clase] ??= []).push(q.conjunto);
    const { desarrollo: ed, reserva: er } = composicion.por_clase;
    for (const c of composicion.clases ?? [...CLASES]) {
      const xs = porClase[c] ?? [];
      const d = xs.filter((x) => x === "desarrollo").length;
      const r = xs.filter((x) => x === "reserva").length;
      if (d !== ed || r !== er) errores.push(`${c}: ${d} de desarrollo y ${r} de reserva (se esperan ${ed} y ${er})`);
    }
  }
  return { errores, avisos };
}

const TEXTO_NO_NOTA = /\.(html?|txt|mjs|js|py|json|csv|canvas|base)$/i;

function principal() {
  const { values: v } = parseArgs({
    options: {
      ...OPCION_VAULT,
      "abrir-reserva": { type: "boolean", default: false },
      borrador: { type: "string" },
      corpus: { type: "string" },
    },
  });
  const corpus = prepararCorpusDe(VAULT, { destino: v.corpus });
  const inv = inventario(corpus.dir);
  const cache = new Map();
  const leerNota = (t) => {
    if (!cache.has(t)) cache.set(t, readFileSync(inv.notas.get(t), "utf8"));
    return cache.get(t);
  };
  const leerCodigo = (ruta) => leerFuente(corpus.dir, ruta);
  const preguntas = v.borrador
    ? JSON.parse(readFileSync(v.borrador, "utf8"))
    : cargarPreguntas(VAULT.preguntas, { abrirReserva: v["abrir-reserva"], rutaClave: VAULT.sello });
  const claudeMd = readFileSync(join(corpus.dir, "CLAUDE.md"), "utf8");
  // Todas las notas y los demás textos, leídos una vez (solo si hacen falta).
  let notas = null;
  let textos = null;
  const recorrer = (filtro) => inv.rutas.filter(filtro).map((p) => ({ t: p.slice(corpus.dir.length + 1), x: normalizar(readFileSync(p, "utf8")) }));
  const opciones = {
    composicion: VAULT.composicion,
    c8: VAULT.c8,
    todasLasNotas: () => (notas ??= recorrer((p) => /\.md$/i.test(p))),
    otrosTextos: () => (textos ??= recorrer((p) => TEXTO_NO_NOTA.test(p))),
  };
  const { errores, avisos } = verificar(preguntas, inv, leerNota, leerCodigo, claudeMd, opciones);
  const selladas = preguntas.filter((q) => q.sellada).length;
  console.log(`Corpus ${corpus.commit.slice(0, 7)} · ${inv.titulos.size} notas · ${preguntas.length} preguntas (${selladas} selladas, no verificadas)`);
  for (const a of avisos) console.log(`aviso  ${a}`);
  for (const e of errores) console.log(`ERROR  ${e}`);
  console.log(errores.length ? `\n${errores.length} errores.` : "\nSin errores.");
  process.exit(errores.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
