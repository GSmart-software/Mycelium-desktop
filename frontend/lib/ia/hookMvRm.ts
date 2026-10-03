/**
 * El hook `PreToolUse` del vault (`FUN-L-09`, Parte 3): cuando la IA corre
 * `mv` o `rm` sobre notas o carpetas con el control encendido, le recuerda
 * `mycelium_renombrar` / `_mover` / `_borrar` (el script, `scripts/hook-mv-rm.mjs`,
 * viaja en `lib/ia/skillsGeneradas.ts` como `HOOK_MV_RM`).
 *
 * Se registra en `.claude/settings.json`, que **puede ser del usuario** (sus
 * permisos, sus propios hooks). Como con el `.mcp.json` (`lib/ia/mcpJson.ts`):
 * se **fusiona** —se agrega o reemplaza solo nuestra entrada, reconocible por
 * la ruta del script— y si el archivo no es JSON o no tiene la forma esperada,
 * **no se toca** y se dice por qué.
 *
 * Se instala solo con el control encendido (igual que el `.mcp.json`): lo
 * escribe y lo quita `lib/mcpControl.ts`. Módulo **puro** (lo prueba
 * `scripts/test-framework-ia.mjs`).
 */

/** Dónde va el script, relativo a la raíz del vault. */
export const RUTA_HOOK = ".claude/hooks/mycelium-mv-rm.mjs";

/** Los ajustes del proyecto de Claude Code, donde se registra. */
export const ARCHIVO_SETTINGS = ".claude/settings.json";

/** Lo que identifica nuestra entrada entre los hooks del usuario. */
const FIRMA = "mycelium-mv-rm.mjs";

/**
 * Cómo lo corre Claude Code. `$CLAUDE_PROJECT_DIR` es la raíz del proyecto (el
 * vault): el hook funciona aunque el agente haya hecho `cd` a una subcarpeta.
 */
export const COMANDO_HOOK = `node "$CLAUDE_PROJECT_DIR/${RUTA_HOOK}"`;

/** Las herramientas de shell de Claude Code: Bash y, en Windows, PowerShell. */
export const MATCHER_HOOK = "Bash|PowerShell";

/** La marca que dice que el script en disco lo escribió Mycelium. */
const MARCA = "<!-- mycelium-ia v";

/** Nuestra entrada en `hooks.PreToolUse`. */
export function entradaHook(): Record<string, unknown> {
  return { matcher: MATCHER_HOOK, hooks: [{ type: "command", command: COMANDO_HOOK }] };
}

/**
 * ¿Se puede escribir el script en `RUTA_HOOK`? Si no hay nada, o lo que hay
 * lo escribió Mycelium. Un archivo del usuario con ese nombre no se pisa (y
 * entonces tampoco se registra el hook: correría su script, no el nuestro).
 */
export function scriptLibre(existente: string | null): boolean {
  return existente === null || existente.includes(MARCA);
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const esNuestra = (e: unknown): boolean =>
  esObjeto(e) &&
  Array.isArray(e.hooks) &&
  e.hooks.some((h) => esObjeto(h) && typeof h.command === "string" && h.command.includes(FIRMA));

function leerObjeto(texto: string): Record<string, unknown> {
  let crudo: unknown;
  try {
    crudo = JSON.parse(texto);
  } catch {
    throw new Error(`${ARCHIVO_SETTINGS} no es JSON válido: no se toca, y el hook de mv/rm no se instaló.`);
  }
  if (!esObjeto(crudo)) throw new Error(`${ARCHIVO_SETTINGS} no es un objeto JSON: no se toca.`);
  if ("hooks" in crudo && !esObjeto(crudo.hooks)) throw new Error(`En ${ARCHIVO_SETTINGS}, «hooks» no es un objeto: no se toca.`);
  const hooks = (crudo.hooks ?? {}) as Record<string, unknown>;
  if ("PreToolUse" in hooks && !Array.isArray(hooks.PreToolUse)) {
    throw new Error(`En ${ARCHIVO_SETTINGS}, «hooks.PreToolUse» no es una lista: no se toca.`);
  }
  return crudo;
}

const formatear = (o: Record<string, unknown>) => JSON.stringify(o, null, 2) + "\n";

/**
 * El contenido con nuestro hook registrado. `cambia` es `false` si ya estaba
 * así; `creado`, si no había archivo.
 */
export function fusionarSettings(existente: string | null): { texto: string; cambia: boolean; creado: boolean } {
  const nuestra = entradaHook();
  if (existente === null || existente.trim() === "") {
    return { texto: formatear({ hooks: { PreToolUse: [nuestra] } }), cambia: true, creado: existente === null };
  }
  const o = leerObjeto(existente);
  const hooks = esObjeto(o.hooks) ? o.hooks : {};
  const lista = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const i = lista.findIndex(esNuestra);
  if (i >= 0 && JSON.stringify(lista[i]) === JSON.stringify(nuestra)) return { texto: existente, cambia: false, creado: false };
  // Reemplazar en su lugar no reordena los hooks del usuario.
  const nueva = i >= 0 ? lista.map((e, j) => (j === i ? nuestra : e)) : [...lista, nuestra];
  return { texto: formatear({ ...o, hooks: { ...hooks, PreToolUse: nueva } }), cambia: true, creado: false };
}

/**
 * El contenido sin nuestro hook. `null` = no queda nada: el archivo se puede
 * borrar si era nuestro. `cambia` es `false` si no estaba.
 */
export function quitarDeSettings(existente: string): { texto: string | null; cambia: boolean } {
  if (existente.trim() === "") return { texto: null, cambia: false };
  const o = leerObjeto(existente);
  if (!esObjeto(o.hooks) || !Array.isArray(o.hooks.PreToolUse)) {
    return { texto: Object.keys(o).length === 0 ? null : existente, cambia: false };
  }
  const lista = o.hooks.PreToolUse.filter((e) => !esNuestra(e));
  const cambia = lista.length !== o.hooks.PreToolUse.length;
  const hooks: Record<string, unknown> = { ...o.hooks, PreToolUse: lista };
  if (lista.length === 0) delete hooks.PreToolUse;
  const resto: Record<string, unknown> = { ...o, hooks };
  if (Object.keys(hooks).length === 0) delete resto.hooks;
  if (Object.keys(resto).length === 0) return { texto: null, cambia };
  return { texto: cambia ? formatear(resto) : existente, cambia };
}
