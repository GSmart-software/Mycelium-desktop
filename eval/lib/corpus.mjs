// El corpus: una copia del vault en un commit fijo, fuera del repo.
//
// Por qué una copia y no el repo mismo:
//  1. `eval/` vive en el repo y trae las claves. Un brazo que hace `grep` en el
//     repo encontraría las respuestas en `eval/preguntas.jsonl`. La copia se hace
//     SIN `eval/`.
//  2. § 7, regla 2: el vault fijo en un commit. El repo se mueve; la copia no.
//  3. El control (§ 1) es el `CLAUDE.md` —que está en git— más la skill
//     `mycelium-memoria` y los comandos `/vault-*`, que viven en `.claude/`,
//     ignorado por git. Se copian desde una instalación real y se les toma hash.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { sha256 } from "./sello.mjs";

/**
 * Dónde viven los corpus. NO puede estar bajo el home: Claude Code sube desde el
 * `cwd` buscando `.claude/CLAUDE.md` en cada ancestro, y en el home encuentra el
 * `~/.claude/CLAUDE.md` del usuario y lo carga **como instrucciones de proyecto**
 * —aunque `--setting-sources` deje afuera las de usuario—. Verificado en la
 * primera corrida de prueba (2026-09-24). Por defecto, en la raíz de la unidad.
 */
export const RAIZ_EVAL = process.env.MYCELIUM_EVAL_RAIZ || join(parse(homedir()).root, "mycelium-eval");

function git(repo, args, opciones = {}) {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", ...opciones });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/** La raíz del checkout principal (donde vive `.claude/` con la skill instalada). */
export function checkoutPrincipal(repo) {
  const comun = resolve(repo, git(repo, ["rev-parse", "--git-common-dir"]));
  return dirname(comun);
}

export function shaCompleto(repo, commit) {
  return git(repo, ["rev-parse", `${commit}^{commit}`]);
}

/** Qué se copia del `.claude/` de la instalación: la parte del control. */
const CONTROL = [".claude/skills/mycelium-memoria", ".claude/skills/mycelium-vault", ".claude/commands", ".mycignore"];

/**
 * Prepara (o reutiliza) el corpus del commit dado. Devuelve su descripción, que
 * también queda escrita al lado —no adentro, para no meterle un archivo más al
 * vault— como `<dir>.json`.
 */
export function prepararCorpus({ repo, commit, control = checkoutPrincipal(repo), destino } = {}) {
  const sha = shaCompleto(repo, commit);
  const dir = destino ?? join(RAIZ_EVAL, "corpus", sha.slice(0, 12));
  const meta = `${dir}.json`;
  if (existsSync(meta) && existsSync(join(dir, "CLAUDE.md"))) return JSON.parse(readFileSync(meta, "utf8"));

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // El .tar va DENTRO del destino y se nombra relativo: el tar de Git Bash lee
  // «C:» como un host remoto, y el de Windows no conoce --force-local.
  const nombreTar = `.corpus-${sha.slice(0, 12)}.tar`;
  git(repo, ["archive", "--format=tar", "-o", join(dir, nombreTar), sha]);
  const x = spawnSync("tar", ["-xf", nombreTar, "--exclude=eval", "--exclude=eval/*"], { cwd: dir, encoding: "utf8" });
  rmSync(join(dir, nombreTar), { force: true });
  if (x.status !== 0) throw new Error(`tar: ${x.stderr}`);
  rmSync(join(dir, "eval"), { recursive: true, force: true });

  const copiados = [];
  for (const rel of CONTROL) {
    const desde = join(control, rel);
    if (!existsSync(desde)) continue;
    cpSync(desde, join(dir, rel), { recursive: true });
    copiados.push(rel);
  }
  // De los comandos, solo los del framework del vault: el resto no es control.
  const cmds = join(dir, ".claude", "commands");
  if (existsSync(cmds))
    for (const f of readdirSync(cmds)) if (!/^vault-/.test(f)) rmSync(join(cmds, f), { recursive: true, force: true });

  const desc = {
    dir,
    commit: sha,
    control,
    copiados,
    hash_claude_md: hashArchivo(join(dir, "CLAUDE.md")),
    hash_skill_memoria: hashArchivo(join(dir, ".claude", "skills", "mycelium-memoria", "SKILL.md")),
    preparado: new Date().toISOString(),
  };
  writeFileSync(meta, JSON.stringify(desc, null, 2));
  return desc;
}

export function hashArchivo(ruta) {
  return existsSync(ruta) ? sha256(readFileSync(ruta, "utf8")).slice(0, 16) : null;
}

const SALTAR = new Set(["node_modules", ".git", "target", ".next", "out"]);

/** Títulos de nota (`.md` sin extensión) y nombres base del resto de archivos. */
export function inventario(dir) {
  const titulos = new Set();
  const archivos = new Set();
  const notas = new Map(); // título → ruta (para el validador de claves)
  const pila = [dir];
  while (pila.length) {
    const d = pila.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SALTAR.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) pila.push(p);
      else if (/\.md$/i.test(e.name)) {
        const t = e.name.slice(0, -3).normalize("NFC");
        titulos.add(t);
        if (!notas.has(t)) notas.set(t, p);
      } else archivos.add(e.name.normalize("NFC"));
    }
  }
  return { titulos, archivos, notas };
}

/**
 * Huella barata del corpus (ruta, tamaño y fecha de cada archivo). Los brazos con
 * herramientas corren con permisos abiertos: si uno escribe en el corpus, las
 * corridas siguientes ya no leen el mismo vault (§ 7, regla 2).
 */
export function huella(dir) {
  const partes = [];
  const pila = [dir];
  while (pila.length) {
    const d = pila.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) pila.push(p);
      else {
        const s = statSync(p);
        partes.push(`${p}|${s.size}|${s.mtimeMs}`);
      }
    }
  }
  return sha256(partes.sort().join("\n"));
}

/** Tira un corpus para que el próximo `prepararCorpus` lo rehaga desde git. */
export function invalidarCorpus(desc) {
  rmSync(`${desc.dir}.json`, { force: true });
}

/** Busca la transcripción de una sesión en `~/.claude/projects/*`. */
export function rutaTranscripcion(sessionId) {
  const raiz = join(homedir(), ".claude", "projects");
  if (!existsSync(raiz)) return null;
  for (const d of readdirSync(raiz)) {
    const p = join(raiz, d, `${sessionId}.jsonl`);
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

export { basename };
