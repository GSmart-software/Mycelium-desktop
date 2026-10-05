/**
 * Recorre lo que se suelta desde el explorador del SO (`FileSystemEntry` de
 * `DataTransferItem.webkitGetAsEntry`), recursando carpetas. Módulo puro —sin
 * imports— para probarlo con entradas falsas (`scripts/test-soltar-archivos.mjs`).
 *
 * Solo usa la forma mínima de la API de entradas, así un objeto cualquiera con
 * esos métodos sirve de doble de prueba.
 */

/** Lo que se usa de `FileSystemEntry` (y de sus dos variantes). */
export type EntradaSoltada = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  /** Solo en archivos (`FileSystemFileEntry.file`). */
  file?: (ok: (f: File) => void, error?: (e: unknown) => void) => void;
  /** Solo en carpetas (`FileSystemDirectoryEntry.createReader`). */
  createReader?: () => LectorDeCarpeta;
};

/** Lo que se usa de `FileSystemDirectoryReader`. */
export type LectorDeCarpeta = {
  readEntries: (ok: (entradas: EntradaSoltada[]) => void, error?: (e: unknown) => void) => void;
};

export type ArchivoSoltado = { path: string; file: File };

/**
 * Todas las entradas de una carpeta. `readEntries` **no** devuelve la carpeta
 * entera: Chromium (y WebView2) entrega como mucho 100 entradas por llamada, y
 * hay que repetirla hasta que vuelva vacía. Llamarla una sola vez dejaba fuera,
 * sin aviso, todo lo que pasara de 100 (`DEF-128`).
 */
export async function leerTodasLasEntradas(lector: LectorDeCarpeta): Promise<EntradaSoltada[]> {
  const todas: EntradaSoltada[] = [];
  for (;;) {
    const tanda = await new Promise<EntradaSoltada[]>((ok, error) => lector.readEntries(ok, error));
    if (tanda.length === 0) return todas;
    todas.push(...tanda);
  }
}

/**
 * Una carpeta soltada que no se copia: las ocultas (`.git/`, `.obsidian/`…),
 * que el default del `.mycignore` deja fuera de todos modos al copiar
 * (`copiar_arbol`). Saltarlas acá evita leer y mandar por IPC un `.git` entero
 * para después descartarlo.
 */
function carpetaOmitida(nombre: string): boolean {
  return nombre.startsWith(".");
}

/**
 * Los archivos de `entradas`, con su ruta relativa POSIX (la carpeta soltada
 * incluida: soltar `Fotos/` da `Fotos/a.png`). Las carpetas vacías no
 * aparecen: no tienen archivos que copiar.
 */
export async function recorrerEntradas(entradas: EntradaSoltada[]): Promise<ArchivoSoltado[]> {
  const out: ArchivoSoltado[] = [];
  const recorrer = async (entrada: EntradaSoltada, prefijo: string): Promise<void> => {
    if (entrada.isFile && entrada.file) {
      // Llamado como método: `file` es nativo y, separado de su entrada
      // (`const leer = entrada.file`), WebView2 lo rechaza con «Illegal invocation».
      const file = await new Promise<File>((ok, error) => entrada.file!(ok, error));
      out.push({ path: `${prefijo}${entrada.name}`, file });
    } else if (entrada.isDirectory && entrada.createReader) {
      if (carpetaOmitida(entrada.name)) return;
      const hijos = await leerTodasLasEntradas(entrada.createReader());
      for (const hijo of hijos) await recorrer(hijo, `${prefijo}${entrada.name}/`);
    }
  };
  for (const entrada of entradas) await recorrer(entrada, "");
  return out;
}
