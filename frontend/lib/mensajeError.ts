/**
 * El texto de un error, venga de donde venga (`DEF-136`). Módulo **puro**: sin
 * imports, para probarlo headless (`scripts/test-mensaje-error.mjs`).
 *
 * > [!important] `invoke` de Tauri rechaza con un STRING, no con un `Error`
 * > Un comando de Rust que devuelve `Result<_, String>` —y el plugin SQL, que
 * > serializa sus errores como texto— llega al `catch` como `"UNIQUE constraint
 * > failed: notas.id"`, no como `new Error(…)`. El patrón `e instanceof Error ?
 * > e.message : "Error desconocido"` tiraba ese texto y dejaba al usuario —y al
 * > registro— sin saber qué pasó.
 *
 * Acepta: un `Error` (su `message`), un texto, o un objeto con `message` o `error`
 * de texto (lo que serializa un error estructurado de Rust). Si no hay nada
 * legible, devuelve `porDefecto`.
 */
export function mensajeDeError(err: unknown, porDefecto = "Error desconocido"): string {
  if (typeof err === "string") return err.trim() !== "" ? err : porDefecto;
  if (err instanceof Error) return err.message.trim() !== "" ? err.message : porDefecto;
  if (err !== null && typeof err === "object") {
    const o = err as { message?: unknown; error?: unknown };
    if (typeof o.message === "string" && o.message.trim() !== "") return o.message;
    if (typeof o.error === "string" && o.error.trim() !== "") return o.error;
  }
  return porDefecto;
}
