/**
 * Los archivos del vault que Mycelium **no** indexa (`FUN-S-03`).
 *
 * Un PDF, una imagen, un `.txt`, código: están en la carpeta, pero hasta ahora
 * no existían para la app. El explorador mostraba un vault más vacío de lo que
 * es, y no había forma de saber que ahí había algo.
 *
 * Esto solo los hace **visibles**. Abrirlos es otra cosa y tiene su propio
 * ítem (`FUN-L-11`): hace falta un visor por tipo.
 */

/** Un archivo que se lista pero no se indexa. */
export type OtroArchivo = {
  /** Ruta relativa POSIX dentro del vault; identifica la entrada. */
  ruta: string;
  /** Nombre con extensión, tal como se ve en el disco. */
  nombre: string;
  /** Extensión en minúsculas, sin punto. Vacía si no tiene. */
  extension: string;
  /** Carpeta que lo contiene, con el mismo id que usa el árbol (o raíz). */
  carpetaId: string | null;
};

/** ¿Corriendo dentro del webview de Tauri? En web no hay carpeta que recorrer. */
function enTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Lista los archivos no indexados del vault abierto.
 *
 * Devuelve `[]` fuera de Tauri y ante cualquier fallo: es información
 * complementaria del árbol, así que un problema acá no debe dejar al usuario
 * sin explorador.
 */
export async function listarOtrosArchivos(origen: string): Promise<OtroArchivo[]> {
  if (!enTauri() || origen === "") return [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const filas = await invoke<{ rutaRelativa: string; tipo: string }[]>(
      "listar_otros_archivos",
      { origen },
    );
    return filas.map((f) => {
      const corte = f.rutaRelativa.lastIndexOf("/");
      return {
        ruta: f.rutaRelativa,
        nombre: f.rutaRelativa.slice(corte + 1),
        extension: f.tipo,
        carpetaId: corte === -1 ? null : f.rutaRelativa.slice(0, corte),
      };
    });
  } catch (error) {
    console.warn("[explorador] no se pudieron listar los otros archivos:", error);
    return [];
  }
}
