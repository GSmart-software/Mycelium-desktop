import { confirm as confirmarTauri } from "@tauri-apps/plugin-dialog";

/**
 * Pregunta al usuario y espera su respuesta (`DEF-051`).
 *
 * **No usar `window.confirm` en esta app.** Tauri lo sustituye por el diálogo
 * nativo, que es **asíncrono**: devuelve una promesa, no un booleano. Y una
 * promesa siempre es *truthy*, así que un `if (window.confirm(…))` se cumple
 * SIEMPRE — la pregunta no se ve y la acción se ejecuta igual. Es exactamente lo
 * que pasaba al borrar una carpeta: se borraba sin preguntar.
 *
 * El tipo de `window.confirm` dice `boolean`, así que TypeScript no avisa de
 * nada: el error solo se ve ejecutando. Por eso conviene que haya un único sitio
 * del que salga la confirmación.
 *
 * @returns `true` si el usuario aceptó. Si el diálogo falla, devuelve `false`:
 *          ante la duda, **no** se ejecuta la acción destructiva.
 */
export async function confirmar(mensaje: string, titulo = "Mycelium"): Promise<boolean> {
  try {
    return await confirmarTauri(mensaje, { title: titulo, kind: "warning" });
  } catch {
    return false;
  }
}
