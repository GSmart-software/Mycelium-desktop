import { type AccionClaudeMd, FRAMEWORK_IA_VERSION, generarFramework } from "./framework";
import { asegurarIntegracion } from "@/lib/mcpControl";

/**
 * Generar o actualizar las instrucciones de IA del vault: lo que hace el botón
 * de Configuración → Vault y el «Actualizar» del aviso de «Actividad de la IA»
 * (`FUN-S-45`). Una sola acción para los dos. Este módulo arrastra
 * `framework.ts` (y sus ~350 KB de skills): se importa con `import()`, desde
 * `stores/instruccionesIaStore.ts`.
 */

/**
 * Qué le pasó a `CLAUDE.md` al generar las instrucciones IA (`FUN-L-29`): lo
 * de fuera del bloque de Mycelium es del usuario y nunca se toca.
 */
const QUE_PASO_CON_CLAUDE_MD: Record<AccionClaudeMd, string> = {
  creado: "se creó CLAUDE.md con el bloque de Mycelium.",
  actualizado: "se actualizó el bloque de Mycelium en CLAUDE.md; lo demás del archivo no se tocó.",
  insertado:
    "el bloque de Mycelium quedó al principio de tu CLAUDE.md; lo tuyo sigue debajo, sin cambios.",
  reemplazado: "el CLAUDE.md de la versión anterior se reemplazó por el bloque de Mycelium.",
  "insertado-sobre-anterior":
    "⚠ tu CLAUDE.md tenía las instrucciones de la versión anterior, editadas: el bloque nuevo " +
    "quedó al principio y no se borró nada. Debajo siguen las viejas (empiezan en «# Este vault " +
    "es tu memoria»): bórralas y deja solo lo tuyo.",
};

/**
 * Escribe las instrucciones en el vault y devuelve qué pasó, para contárselo
 * al usuario. Con el control encendido, también registra el servidor en
 * `.mcp.json` y el hook de mv/rm en `.claude/settings.json` (spec § 4):
 * regenerar deja todo lo de la IA al día. Lanza si algo falla.
 */
export async function actualizarInstrucciones(rutaVault: string, controlIa: boolean): Promise<string> {
  const resultado = await generarFramework(rutaVault);
  if (controlIa) await asegurarIntegracion(rutaVault);
  let texto = `Instrucciones IA v${FRAMEWORK_IA_VERSION}: ${QUE_PASO_CON_CLAUDE_MD[resultado.claudeMd]}`;
  if (resultado.conservados.length > 0) {
    texto +=
      ` Quedaron como tuyos ${resultado.conservados.length} comando(s) de la versión anterior que ` +
      `habías editado (${resultado.conservados.join(" · ")}); los de Mycelium están ahora en ` +
      `.claude/commands/mycelium/.`;
  }
  // El aviso de referencias sin enlazar (`FUN-S-10`) no impide lo demás:
  // si no se pudo instalar, se dice por qué.
  if (resultado.avisoHook) texto += ` ${resultado.avisoHook}`;
  return texto;
}
