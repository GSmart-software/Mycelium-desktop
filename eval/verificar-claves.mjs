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

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inventario, prepararCorpus } from "./lib/corpus.mjs";
import { cargarPreguntas } from "./lib/preguntas.mjs";
import { buscarSeccion, partirSeccionClave } from "./lib/secciones.mjs";
import { contiene, normalizar, palabrasDeContenido } from "./lib/texto.mjs";

const EVAL = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(EVAL, "..");
const CONFIG = JSON.parse(readFileSync(join(EVAL, "config.json"), "utf8"));

const CLASES = new Set(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]);
const FUENTES = new Set(["bandeja", "transcripcion", "sembrada"]);
/** Palabras que una pregunta puede compartir con cualquier sección: nombres propios del producto. */
const PERMITIDAS_C8 = new Set(["mycelium", "vault", "app", "nota", "notas"]);

function mismaPalabra(a, b) {
  return a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
}
function compartidas(a, b) {
  return [...a].filter((x) => [...b].some((y) => mismaPalabra(x, y)));
}

/** Grupos de alternativas del dato: `requeridas`, o `aceptadas` como un solo grupo. */
function grupos(q) {
  if (q.requeridas?.length) return q.requeridas;
  return q.aceptadas?.length ? [q.aceptadas] : [];
}

export function verificar(preguntas, inv, leerNota, leerCodigo, claudeMd) {
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

    // El dato tiene que estar sostenido por las notas clave (o por el código, en C7).
    if (q.veredicto === "dato") {
      const fuentes =
        q.clase === "C7"
          ? (q.fuentes_codigo ?? []).map((f) => ({ t: f, x: normalizar(leerCodigo(f)) }))
          : planas.filter((t) => inv.titulos.has(t)).map((t) => ({ t, x: normalizar(leerNota(t)) }));
      if (!fuentes.length) E(q, q.clase === "C7" ? "C7 sin fuentes_codigo" : "sin notas clave");
      for (const g of gs)
        if (!fuentes.some((f) => g.some((alt) => contiene(f.x, alt))))
          E(q, `ninguna fuente clave contiene el grupo [${g.join(" | ")}]`);
      // Cada alternativa de la lista de notas clave tiene que sostener algo por sí sola.
      if (q.clase !== "C7")
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

    // C7: el dato NO puede estar escrito en una nota (es la definición de la clase).
    if (q.clase === "C7") {
      if (!q.prueba_fuera_indice) E(q, "C7 sin prueba_fuera_indice");
      else
        for (const t of inv.titulos) {
          const x = normalizar(leerNota(t));
          if (contiene(x, q.prueba_fuera_indice)) E(q, `C7 pero la nota «${t}» contiene el dato (${q.prueba_fuera_indice})`);
        }
    }

    // C5: lo que no debe aparecer en el vault.
    if (q.clase === "C5")
      for (const p of q.no_debe_aparecer ?? [])
        for (const t of inv.titulos) if (contiene(normalizar(leerNota(t)), p)) E(q, `ausencia, pero «${t}» contiene «${p}»`);

    // § 8, sesgo 1: como máximo dos palabras de contenido compartidas con el título objetivo.
    const pq = palabrasDeContenido(q.pregunta);
    for (const t of planas) {
      const c = compartidas(pq, palabrasDeContenido(t));
      if (c.length > 2) A(q, `comparte ${c.length} palabras con el título «${t}»: ${c.join(", ")}`);
    }

    // C8: ninguna palabra de contenido en común con la sección objetivo.
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
        const c = compartidas(pq, palabrasDeContenido(sec.texto)).filter((w) => !PERMITIDAS_C8.has(w));
        if (c.length) E(q, `C8 comparte vocabulario con «${s}»: ${c.join(", ")}`);
      }
    }

    // Contaminación previsible: el CLAUDE.md entra en todas las sesiones (§ 8, sesgo 2).
    if (q.veredicto === "dato" && gs.length && gs.every((g) => g.some((alt) => contiene(normalizar(claudeMd), alt))))
      A(q, "el CLAUDE.md contiene todas las cadenas de la clave: posible contaminación (lo decide el brazo ciego)");
  }

  // Composición (§ 2 y plan § 4.3): tres por clase, dos de desarrollo y una de reserva.
  const porClase = {};
  for (const q of preguntas) if (!q.retirada) (porClase[q.clase] ??= []).push(q.conjunto);
  for (const c of CLASES) {
    const xs = porClase[c] ?? [];
    const d = xs.filter((x) => x === "desarrollo").length;
    const r = xs.filter((x) => x === "reserva").length;
    if (d !== 2 || r !== 1) errores.push(`${c}: ${d} de desarrollo y ${r} de reserva (se esperan 2 y 1)`);
  }
  return { errores, avisos };
}

function principal() {
  const { values: v } = parseArgs({
    options: {
      "abrir-reserva": { type: "boolean", default: false },
      borrador: { type: "string" },
      corpus: { type: "string" },
    },
  });
  const corpus = prepararCorpus({ repo: REPO, commit: CONFIG.commit_vault, destino: v.corpus });
  const inv = inventario(corpus.dir);
  const cache = new Map();
  const leerNota = (t) => {
    if (!cache.has(t)) cache.set(t, readFileSync(inv.notas.get(t), "utf8"));
    return cache.get(t);
  };
  const leerCodigo = (ruta) => readFileSync(join(corpus.dir, ruta), "utf8");
  const preguntas = v.borrador
    ? JSON.parse(readFileSync(v.borrador, "utf8"))
    : cargarPreguntas(join(EVAL, "preguntas.jsonl"), { abrirReserva: v["abrir-reserva"] });
  const claudeMd = readFileSync(join(corpus.dir, "CLAUDE.md"), "utf8");
  const { errores, avisos } = verificar(preguntas, inv, leerNota, leerCodigo, claudeMd);
  const selladas = preguntas.filter((q) => q.sellada).length;
  console.log(`Corpus ${corpus.commit.slice(0, 7)} · ${inv.titulos.size} notas · ${preguntas.length} preguntas (${selladas} selladas, no verificadas)`);
  for (const a of avisos) console.log(`aviso  ${a}`);
  for (const e of errores) console.log(`ERROR  ${e}`);
  console.log(errores.length ? `\n${errores.length} errores.` : "\nSin errores.");
  process.exit(errores.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
