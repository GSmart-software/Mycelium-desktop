// Qué vault se evalúa: de dónde sale su copia, qué se le quita, y dónde viven
// sus preguntas, sus resultados, su sello y el registro de vaults del MCP.
//
// El arnés nació para el vault de Mycelium (este repo) y ese sigue siendo el
// vault por defecto, con las MISMAS rutas de siempre: sin `--vault`, nada cambia.
// Otro vault se describe con un JSON (`vault.json`) que vive FUERA del repo —sus
// preguntas y claves llevan contenido de ese vault, y el repo se publica—, y se
// elige con `--vault <ruta al json>` o con la variable `MYCELIUM_EVAL_VAULT`.
//
// Forma del JSON (las rutas relativas se resuelven contra la carpeta del json):
//
//   {
//     "nombre": "tesina",
//     "repo": "C:\\ruta\\al\\repo\\del\\vault",      // solo se LEE: git archive
//     "commit_vault": "<sha>",
//     "excluir": [".claude/metrics", ...],             // rutas del commit que no van a la copia
//     "excluir_motivo": { ".claude/metrics": "por qué" },
//     "control": "commit",                             // "commit": el CLAUDE.md y .claude/ vienen en el commit
//                                                      // "checkout": se copian de la instalación (vault de Mycelium)
//     "corpus": "corpus",                              // carpeta donde van las copias
//     "preguntas": "preguntas.jsonl", "resultados": "resultados.jsonl",
//     "juicios": "juicios.jsonl", "patron": "patron-juez.jsonl", "planilla": "patron-juez.md",
//     "corridas": "corridas", "mcp_config": "mcp.json", "app_mcp": "app",
//     "sello": "sello.key",
//     "composicion": null,                             // o { "por_clase": { "desarrollo": 2, "reserva": 1 } }
//     "protocolo": { ... }                             // pisa claves de eval/config.json (modelos, reps, ...)
//   }

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RAIZ_EVAL, prepararCorpus } from "./corpus.mjs";
import { RUTA_CLAVE_DEFECTO } from "./sello.mjs";

/** La carpeta `eval/` del repo. */
export const EVAL = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** El protocolo común (§ 7 y § 9.5): modelos, repeticiones, herramientas. */
export function configBase() {
  return JSON.parse(readFileSync(join(EVAL, "config.json"), "utf8"));
}

/** Qué se copia de la instalación cuando el control no viene en el commit. */
export const CONTROL_CHECKOUT = [".claude/skills/mycelium-memoria", ".claude/skills/mycelium-vault", ".claude/commands", ".mycignore"];

/**
 * El vault de Mycelium, tal como lo usó el arnés desde el principio. Cada ruta
 * es la que estaba escrita en los scripts antes de generalizarlos.
 */
export function vaultMycelium() {
  const config = configBase();
  return {
    nombre: "mycelium",
    dir: EVAL,
    repo: resolve(EVAL, ".."),
    commit_vault: config.commit_vault,
    // `eval/` trae las claves: un brazo que hace grep en la copia las encontraría.
    excluir: ["eval"],
    control: "checkout",
    raiz_corpus: join(RAIZ_EVAL, "corpus"),
    preguntas: join(EVAL, "preguntas.jsonl"),
    resultados: join(EVAL, "resultados.jsonl"),
    juicios: join(EVAL, "juicios.jsonl"),
    patron: join(EVAL, "patron-juez.jsonl"),
    planilla: join(EVAL, "patron-juez.md"),
    corridas: join(EVAL, "corridas"),
    mcp_config: join(EVAL, "mcp.json"),
    app_mcp: join(RAIZ_EVAL, "app"),
    sello: process.env.MYCELIUM_EVAL_SELLO || RUTA_CLAVE_DEFECTO,
    composicion: { por_clase: { desarrollo: 2, reserva: 1 }, clases: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"] },
    // La § 9 de «MCP de Mycelium - evaluacion», congelada. Otro vault puede
    // declarar "costo-y-tiempo" (lib/regla-tiempo.mjs).
    regla: "§9",
    config,
  };
}

const RUTAS = ["preguntas", "resultados", "juicios", "patron", "planilla", "corridas", "mcp_config", "app_mcp", "sello"];

/** Un vault descrito por su JSON. */
export function cargarVault(rutaJson) {
  const ruta = resolve(rutaJson);
  if (!existsSync(ruta)) throw new Error(`No existe la configuración de vault ${ruta}`);
  const j = JSON.parse(readFileSync(ruta, "utf8"));
  const dir = dirname(ruta);
  const abs = (p) => (p == null ? null : isAbsolute(p) ? p : join(dir, p));
  for (const k of ["nombre", "repo", "commit_vault"]) if (!j[k]) throw new Error(`${ruta}: falta «${k}»`);
  if (resolve(j.repo) === resolve(EVAL, "..") && j.nombre !== "mycelium")
    throw new Error(`${ruta}: el repo de Mycelium es el vault por defecto; no hace falta un json para él`);
  const base = configBase();
  const v = {
    nombre: j.nombre,
    dir,
    json: ruta,
    repo: j.repo,
    commit_vault: j.commit_vault,
    excluir: j.excluir ?? [],
    excluir_motivo: j.excluir_motivo ?? {},
    control: j.control ?? "commit",
    raiz_corpus: abs(j.corpus ?? "corpus"),
    composicion: j.composicion ?? null,
    regla: j.regla ?? "§9",
    config: { ...base, ...(j.protocolo ?? {}), commit_vault: j.commit_vault },
  };
  const defectos = {
    preguntas: "preguntas.jsonl",
    resultados: "resultados.jsonl",
    juicios: "juicios.jsonl",
    patron: "patron-juez.jsonl",
    planilla: "patron-juez.md",
    corridas: "corridas",
    mcp_config: "mcp.json",
    app_mcp: "app",
    sello: "sello.key",
  };
  for (const k of RUTAS) v[k] = abs(j[k] ?? defectos[k]);
  if (!["commit", "checkout"].includes(v.control)) throw new Error(`${ruta}: control «${v.control}» (se espera commit o checkout)`);
  if (!["§9", "costo-y-tiempo"].includes(v.regla)) throw new Error(`${ruta}: regla «${v.regla}» (se espera §9 o costo-y-tiempo)`);
  return v;
}

/**
 * El vault de esta invocación: `--vault <json>` en los argumentos, si no
 * `MYCELIUM_EVAL_VAULT`, si no el de Mycelium. Se lee de `argv` directamente
 * porque los valores por defecto de cada script dependen de él y se calculan
 * antes de `parseArgs` (que igual declara `--vault` para no rechazarlo).
 */
export function vaultDeArgs(argv = process.argv, env = process.env) {
  let ruta = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vault") ruta = argv[i + 1] ?? null;
    else if (argv[i].startsWith("--vault=")) ruta = argv[i].slice("--vault=".length);
  }
  ruta ??= env.MYCELIUM_EVAL_VAULT || null;
  return ruta ? cargarVault(ruta) : vaultMycelium();
}

/**
 * El corpus del vault: su copia en el commit fijo, con sus exclusiones. `commit`
 * permite pedir otro (el de una fila vieja, al re-puntuar).
 */
export function prepararCorpusDe(v, { commit = v.commit_vault, destino } = {}) {
  return prepararCorpus({
    repo: v.repo,
    commit,
    destino,
    excluir: v.excluir,
    raiz: v.raiz_corpus,
    // `undefined` deja que corpus.mjs busque el checkout principal, como siempre.
    control: v.control === "checkout" ? undefined : null,
  });
}

/** La opción que cada script agrega a su `parseArgs`. */
export const OPCION_VAULT = { vault: { type: "string" } };
