#!/usr/bin/env node
// Hook `PreToolUse` de Claude Code para un vault de Mycelium con el control de
// la IA encendido (`FUN-L-09`, Parte 3; spec en docs/features/mcp-control.md).
//
// Cuando la IA corre `mv` o `rm` (o sus pares de PowerShell: Move-Item,
// Rename-Item, Remove-Item…) sobre **notas o carpetas del vault**, le recuerda
// las herramientas que corresponden: `mycelium_renombrar` / `mycelium_mover`
// reparan los [[enlaces]] y `mycelium_borrar` usa la papelera de Mycelium. Un
// `mv` no repara nada y un `rm` no pasa por la papelera.
//
// NO es un bloqueo duro: si las herramientas no están o no responden
// (APP_CERRADA, MCP_DESACTIVADO), la IA repite el comando con
// `MYCELIUM_SIN_MCP=1` delante y pasa —y entonces arregla los enlaces ella—.
// Tampoco frena nada con el control apagado (lo lee de
// `.mycelium/preferencias.json` en cada llamada), ni lo que no es una nota:
// archivos que no se indexan, carpetas que empiezan con punto, node_modules.
//
// Lo instala Mycelium en `.claude/hooks/` con el control encendido y lo
// registra en `.claude/settings.json`. Sin dependencias: solo `node:*`.
//
// Entrada (stdin): el JSON del hook (`tool_name`, `tool_input.command`, `cwd`).
// Salida: nada (deja pasar) o la decisión `deny` con el motivo.
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Las extensiones de lo que Mycelium indexa como nota (las que tienen enlaces que reparar). */
const NOTA = /\.(md|canvas|base|excalidraw|drawio)$/i;

/** El escape explícito: con esto en el comando, el hook deja pasar. */
export const ESCAPE = "MYCELIUM_SIN_MCP";

/** Verbo de cada comando que mueve o borra. `null` si no es uno de esos. */
function verbo(palabras) {
  const p = palabras.map((x) => x.toLowerCase());
  if (p[0] === "git" && (p[1] === "mv" || p[1] === "rm")) return { verbo: p[1], resto: palabras.slice(2) };
  const mover = ["mv", "move-item", "mi", "move", "rename-item", "rni", "ren"];
  const borrar = ["rm", "rmdir", "unlink", "remove-item", "ri", "del", "erase", "rd"];
  if (mover.includes(p[0])) return { verbo: "mv", resto: palabras.slice(1) };
  if (borrar.includes(p[0])) return { verbo: "rm", resto: palabras.slice(1) };
  return null;
}

/** Las palabras de un tramo de comando, sin comillas. Simple a propósito: no es un shell. */
function palabrasDe(tramo) {
  return [...tramo.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/**
 * Qué decide el hook. `vault`: la raíz; `cwd`: desde dónde corre el comando;
 * `control`: si está encendido; `tipo(ruta)`: `"archivo"`, `"carpeta"` o
 * `null` si no existe. Devuelve `null` (deja pasar) o `{ verbo, rutas }` con lo
 * del vault que el comando movería o borraría.
 */
export function decidir({ comando, cwd, vault, control, tipo }) {
  if (!control || typeof comando !== "string" || comando.includes(ESCAPE)) return null;
  const encontradas = [];
  const verbos = new Set();
  for (const tramo of comando.split(/&&|\|\||[;|\n]/)) {
    let palabras = palabrasDe(tramo.trim());
    // Asignaciones de entorno y prefijos que no cambian el verbo.
    while (palabras.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(palabras[0]) || ["sudo", "command", "builtin", "&"].includes(palabras[0]))) {
      palabras = palabras.slice(1);
    }
    const v = verbo(palabras);
    if (!v) continue;
    for (const arg of v.resto) {
      if (arg.startsWith("-")) continue;
      const ruta = resolve(cwd, arg);
      const rel = relative(vault, ruta).replace(/\\/g, "/");
      if (rel.startsWith("..") || isAbsolute(rel)) continue;
      const primero = rel.split("/")[0];
      if (primero.startsWith(".") || primero === "node_modules") continue;
      const comodin = /[*?[]/.test(arg);
      const t = comodin ? null : tipo(ruta);
      const esNota = comodin ? NOTA.test(arg) || /\*$/.test(arg) : t === "carpeta" || (t === "archivo" && NOTA.test(arg));
      if (!esNota) continue;
      encontradas.push(rel === "" ? "." : rel);
      verbos.add(v.verbo);
    }
  }
  if (encontradas.length === 0) return null;
  return { verbo: verbos.size > 1 ? "mv+rm" : [...verbos][0], rutas: [...new Set(encontradas)] };
}

/** El motivo que lee la IA cuando el hook la frena. */
export function motivo(d) {
  const que = d.rutas.slice(0, 5).join(", ") + (d.rutas.length > 5 ? ` y ${d.rutas.length - 5} más` : "");
  const partes = [`Mycelium tiene el control de la IA encendido en este vault, y este comando toca notas o carpetas (${que}).`];
  if (d.verbo !== "rm") {
    partes.push(
      "Para renombrar o mover usá mycelium_renombrar / mycelium_mover: reparan los [[enlaces]] que llegan ahí; un mv los deja rotos.",
    );
  }
  if (d.verbo !== "mv") {
    partes.push("Para borrar usá mycelium_borrar: va a la papelera de Mycelium y se puede restaurar; un rm no.");
  }
  partes.push(
    `Si esas herramientas no están o contestan APP_CERRADA o MCP_DESACTIVADO, repetí el comando con ${ESCAPE}=1 delante ` +
      "y arreglá vos los enlaces (regla dura 2 del CLAUDE.md).",
  );
  return partes.join(" ");
}

function controlEncendido(vault) {
  try {
    return JSON.parse(readFileSync(resolve(vault, ".mycelium", "preferencias.json"), "utf8")).controlIa === true;
  } catch {
    return false;
  }
}

function tipoEnDisco(ruta) {
  try {
    return statSync(ruta).isDirectory() ? "carpeta" : "archivo";
  } catch {
    return null;
  }
}

function principal() {
  let entrada = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (entrada += d));
  process.stdin.on("end", () => {
    let datos;
    try {
      datos = JSON.parse(entrada);
    } catch {
      return; // Sin entrada legible no se frena nada.
    }
    // Este archivo vive en <vault>/.claude/hooks/.
    const vault = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const d = decidir({
      comando: datos?.tool_input?.command,
      cwd: typeof datos?.cwd === "string" ? datos.cwd : process.cwd(),
      vault,
      control: controlEncendido(vault),
      tipo: tipoEnDisco,
    });
    if (!d) return;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: motivo(d) },
      }),
    );
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) principal();
