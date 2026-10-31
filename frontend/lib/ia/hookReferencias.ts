/**
 * El hook `PostToolUse` de las referencias sin enlazar (`FUN-S-10`): cuando la
 * IA escribe o edita una nota y deja un `[texto](otra.md)` o una forma del
 * léxico sin corchetes, le avisa con la forma `[[…]]` que Mycelium sí cuenta.
 * El script es `scripts/hook-referencias.mjs` y viaja en
 * `lib/ia/skillsGeneradas.ts` como `HOOK_REFERENCIAS`.
 *
 * A diferencia del de `mv`/`rm`, es parte del **framework de IA**: lo instala
 * `generarFramework` siempre, con el control encendido o apagado, porque no
 * depende del MCP —solo lee archivos—. Se registra en `.claude/settings.json`
 * con la misma fusión (`fusionarSettings` de `lib/ia/hookMvRm.ts`, con esta
 * definición): lo del usuario no se toca, y un archivo que no es JSON tampoco.
 *
 * Módulo **puro** y sin imports de valor (lo transpila y prueba
 * `scripts/test-framework-ia.mjs`).
 */
import type { DefinicionHook } from "./hookMvRm";

/** Dónde va el script, relativo a la raíz del vault. */
export const RUTA_HOOK_REFERENCIAS = ".claude/hooks/mycelium-referencias.mjs";

/** El hook, como definición para la fusión con `settings.json`. */
export const HOOK_REFERENCIAS_DEF: DefinicionHook = {
  evento: "PostToolUse",
  // Las tres herramientas de Claude Code que escriben un archivo.
  matcher: "Write|Edit|MultiEdit",
  // `$CLAUDE_PROJECT_DIR` es la raíz del vault, aunque la IA haya hecho `cd`.
  comando: `node "$CLAUDE_PROJECT_DIR/${RUTA_HOOK_REFERENCIAS}"`,
  firma: "mycelium-referencias.mjs",
  nombre: "el aviso de referencias sin enlazar",
};
