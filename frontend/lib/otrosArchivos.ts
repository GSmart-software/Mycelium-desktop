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

// ── Abrirlos: pestaña de visor de solo lectura (`FUN-L-11`) ──────────────────

/**
 * Prefijo de las pestañas de visor en el `tabsStore` (patrón `terminal:`).
 *
 * Un archivo que no es nota **no entra al índice**: no tiene fila en `notas`,
 * no aparece en la búsqueda del vault, ni en el autocompletado de `[[`, ni en
 * el grafo. Abrirlo no lo convierte en una nota. Por eso la pestaña se
 * identifica con un id sentinela —`archivo:<ruta relativa>`— igual que la
 * terminal (`FUN-L-07`): así hereda gratis la reconciliación, la división de
 * paneles, el arrastre entre paneles y la persistencia por vault.
 */
export const ARCHIVO_TAB_PREFIX = "archivo:";

/** Id de pestaña ↔ ruta relativa del archivo. */
export const tabIdDeArchivo = (ruta: string) => `${ARCHIVO_TAB_PREFIX}${ruta}`;
export const rutaDeTabArchivo = (tabId: string) => tabId.slice(ARCHIVO_TAB_PREFIX.length);
export const esTabArchivo = (tabId: string) => tabId.startsWith(ARCHIVO_TAB_PREFIX);

/** Nombre del archivo (sin carpetas) a partir de su ruta relativa. */
export const nombreDeRuta = (ruta: string) => ruta.slice(ruta.lastIndexOf("/") + 1);

/** Extensión en minúsculas y sin punto de una ruta. Vacía si no tiene. */
export function extensionDeRuta(ruta: string): string {
  const nombre = nombreDeRuta(ruta);
  const punto = nombre.lastIndexOf(".");
  return punto <= 0 ? "" : nombre.slice(punto + 1).toLowerCase();
}

/** Qué visor le toca a un archivo según su extensión. */
export type VisorTipo = "texto" | "imagen" | "pdf" | "desconocido";

/**
 * Extensiones que se muestran como imagen. `svg` **no** está: es XML y el
 * webview lo trataría como documento (scripts incluidos). Se lee como texto,
 * que además es lo útil para un `.svg` guardado en un vault.
 */
const IMAGENES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);

/**
 * Extensiones binarias frecuentes en un vault. No se intentan leer como texto:
 * el resultado sería el aviso de «no se puede mostrar» después de una lectura
 * inútil de varios MB. Se ofrece abrirlas con el sistema directamente.
 */
const BINARIOS = new Set([
  "zip", "rar", "7z", "gz", "tar", "exe", "dll", "msi", "bin", "iso",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "mp3", "wav", "ogg", "flac", "mp4", "mkv", "avi", "mov", "webm",
  "ttf", "otf", "woff", "woff2", "psd", "ai", "sqlite", "db",
]);

/**
 * Visor que corresponde a una extensión (en minúsculas, sin punto).
 *
 * Todo lo que no se reconoce cae en `texto`, no en `desconocido`: es la apuesta
 * correcta —un `.conf`, un `.env`, un `Makefile` sin extensión son texto— y si
 * se equivoca no hace daño, porque el lector detecta que no decodifica y lo
 * dice en vez de volcar caracteres de reemplazo.
 */
export function tipoDeVisor(extension: string): VisorTipo {
  const ext = extension.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (IMAGENES.has(ext)) return "imagen";
  if (BINARIOS.has(ext)) return "desconocido";
  return "texto";
}

/** Lo que devuelve `leer_archivo_visor`. Ver el comando en `archivos.rs`. */
export type ArchivoVisor = {
  contenido: string;
  bytes: number;
  truncado: boolean;
  binario: boolean;
  /**
   * `mtime` del archivo al leerlo, en ms epoch (0 si el SO no lo expone).
   *
   * Es la foto contra la que se compara al guardar (`FUN-M-26`): estos archivos
   * no se vigilan ni se respaldan, así que la única defensa contra pisar lo que
   * otro programa escribió mientras tanto es haber anotado cómo estaban.
   */
  mtime: number;
};

/**
 * Cuánto texto se pinta como máximo. El tamaño no tiene techo natural —un log
 * de 500 MB está a un clic— y pintarlo entero cuelga el webview. Con esto el
 * visor muestra el principio y ofrece abrir el archivo con el sistema.
 */
export const MAX_BYTES_VISOR = 2 * 1024 * 1024;

/** Lee un archivo de texto del vault para mostrarlo (solo lectura). */
export async function leerArchivoVisor(origen: string, ruta: string): Promise<ArchivoVisor> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ArchivoVisor>("leer_archivo_visor", {
    origen,
    ruta,
    maxBytes: MAX_BYTES_VISOR,
  });
}

/**
 * URL con la que el webview puede pedirle el archivo al protocolo `asset:`.
 *
 * Un PDF o una imagen **no** viajan por IPC: serializados en base64 pesarían un
 * tercio más, se duplicarían en memoria y bloquearían el hilo. El protocolo los
 * sirve como los sirve un servidor web —en trozos, con `Range`—, que es lo que
 * el visor de PDF del webview necesita para paginar sin cargarlo entero.
 *
 * El ámbito se abre en Rust al registrar el vault (`ventanas::registrar_vault`)
 * y cubre **solo** su carpeta.
 */
export function urlDeArchivo(vault: string, ruta: string): string {
  const base = vault.replace(/[\\/]+$/, "");
  return convertirRutaAUrl(`${base}/${ruta}`);
}

/**
 * `convertFileSrc` del API de Tauri, tomado del global que el webview inyecta.
 *
 * Se lee de ahí y no con `import("@tauri-apps/api/core")` porque esto se usa
 * **durante el render** y tiene que ser síncrono. Fuera de Tauri devuelve la
 * ruta tal cual: no hay nada que servir y no debe reventar el render.
 */
function convertirRutaAUrl(ruta: string): string {
  const g = window as unknown as {
    __TAURI_INTERNALS__?: { convertFileSrc?: (ruta: string, protocolo?: string) => string };
  };
  return g.__TAURI_INTERNALS__?.convertFileSrc?.(ruta) ?? ruta;
}

/** Abre el archivo con la aplicación que el SO tenga asociada a su tipo. */
export async function abrirConSistema(vault: string, ruta: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("abrir_con_sistema", { vaultRuta: vault, rutaRel: ruta });
}

/** Tamaño legible para los avisos del visor (`1,4 MB`). */
export function formatearBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unidades = ["KB", "MB", "GB", "TB"];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return `${valor.toFixed(valor >= 10 ? 0 : 1)} ${unidades[i]}`;
}

/**
 * Si un archivo del visor se puede editar (`FUN-M-26`).
 *
 * > [!danger] Un archivo truncado NO se edita jamás
 * > El visor corta a `MAX_BYTES_VISOR` y muestra el principio. Guardar ese
 * > fragmento **borraría todo el resto del archivo**, en silencio y sin vuelta
 * > atrás. Tampoco se edita lo que no decodificó como UTF-8: si Mycelium no
 * > pudo leerlo, no puede reescribirlo sin destruirlo.
 */
export function sePuedeEditar(archivo: ArchivoVisor): boolean {
  return !archivo.truncado && !archivo.binario;
}

/** Lo que devuelve `escribir_archivo_visor`. */
export type EscrituraVisor = {
  /** `false` si NO se escribió nada porque el archivo cambió desde fuera. */
  guardado: boolean;
  /** `mtime` en disco al terminar: el nuevo, o el actual si hubo conflicto. */
  mtime: number;
};

/**
 * Guarda un archivo de texto editado en el visor.
 *
 * Un conflicto —el archivo cambió en disco desde que se abrió— **no es un
 * error**: vuelve como `guardado: false` para que lo decida el usuario. Tratarlo
 * como excepción obligaría a distinguirlo leyendo el texto del mensaje.
 */
export async function escribirArchivoVisor(
  origen: string,
  ruta: string,
  contenido: string,
  mtimeEsperado: number | null,
): Promise<EscrituraVisor> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<EscrituraVisor>("escribir_archivo_visor", {
    origen,
    ruta,
    contenido,
    mtimeEsperado,
  });
}
