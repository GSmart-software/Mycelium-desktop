import JSZip from "jszip";
import { EXTENSIONES_DE_NOTA } from "@/lib/extensionesDeTipo";
import { useVaultStore } from "@/stores/vaultStore";

/**
 * Importar al vault (HU-07/11). Un vault de desktop **es** una carpeta, así que
 * importar es copiar un árbol de archivos dentro de ella y reindexar
 * (`FUN-M-40`, D9):
 *
 * - una carpeta del disco → `importarCarpeta`: el comando Rust `copiar_arbol`
 *   la copia entera —notas, imágenes, PDF, lo que haya— respetando su
 *   `.mycignore` (o el default, que deja fuera `.obsidian/` y `.git/`);
 * - lo que no llega como carpeta —un `.zip`, archivos soltados o elegidos con
 *   el selector— → `importarArchivos`: se baja a una carpeta temporal y sigue
 *   el mismo camino.
 *
 * Antes era la tubería de la web: cada nota se creaba con `POST` + `PUT` por el
 * dispatcher, los adjuntos se contaban como «no soportados» y «reemplazar»
 * dejaba un duplicado.
 */

export type CollectedFile = { path: string; file: File };

/** Qué hacer con un archivo cuyo nombre ya existe en el destino. */
export type ConflictChoice = "reemplazar" | "renombrar" | "cancelar";

export type ImportSummary = {
  notas: number;
  adjuntos: number;
  omitidos: string[];
};

type Opciones = {
  /** Se llama una vez por archivo en conflicto (su nombre) y espera la decisión. */
  resolveConflict?: (nombre: string) => Promise<ConflictChoice>;
  onProgress?: (done: number, total: number) => void;
};

async function invocar<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Lee archivos sueltos o de un selector de carpeta (webkitdirectory). */
export function collectFromFileList(files: FileList): CollectedFile[] {
  return Array.from(files).map((file) => ({
    // webkitRelativePath en selector de carpeta; si no, el nombre plano
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  }));
}

/** Recorre un DataTransfer (drag & drop), recursando directorios (HU-07 CA3). */
export async function collectFromDataTransfer(dt: DataTransfer): Promise<CollectedFile[]> {
  const entries = Array.from(dt.items)
    .map((item) => (item.kind === "file" ? item.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);

  if (entries.length === 0) {
    return Array.from(dt.files).map((file) => ({ path: file.name, file }));
  }

  const out: CollectedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej),
      );
      out.push({ path: `${prefix}${entry.name}`, file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children = await new Promise<FileSystemEntry[]>((res, rej) =>
        reader.readEntries(res, rej),
      );
      for (const child of children) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}

/** Extrae los archivos de un .zip (p. ej. un vault de Obsidian, HU-11 CA1). */
export async function collectFromZip(zipFile: File): Promise<CollectedFile[]> {
  const zip = await JSZip.loadAsync(zipFile);
  const out: CollectedFile[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const blob = await entry.async("blob");
    out.push({ path: entry.name, file: new File([blob], entry.name.split("/").pop() ?? entry.name) });
  }
  return out;
}

/** Si una ruta es una nota del vault (el resto son adjuntos). */
function esNota(ruta: string): boolean {
  const i = ruta.lastIndexOf(".");
  return i > 0 && EXTENSIONES_DE_NOTA.includes(ruta.slice(i + 1).toLowerCase());
}

/** El vault abierto (su carpeta) y la carpeta destino relativa a él. */
async function destino(destFolderId: string | null): Promise<{ vault: string; destinoRel: string }> {
  const { getVaultActual } = await import("@/lib/db/vaultContext");
  // En desktop el id de una carpeta ES su ruta relativa; `null` = la raíz.
  return { vault: getVaultActual(), destinoRel: destFolderId ?? "" };
}

/**
 * Copia la carpeta `origen` del disco dentro de `destFolderId` y reindexa. Los
 * archivos que ya existen en el destino se preguntan uno por uno; «reemplazar»
 * pisa el que estaba, «renombrar» conserva los dos (`nota 1.md`) y «cancelar»
 * lo omite.
 */
export async function importarCarpeta(
  origen: string,
  destFolderId: string | null,
  opts: Opciones = {},
): Promise<ImportSummary> {
  const { vault, destinoRel } = await destino(destFolderId);
  const args = { vaultRuta: vault, origen, destinoRel };

  const conflictos = await invocar<string[]>("conflictos_de_copia", args);
  const decisiones: Record<string, ConflictChoice> = {};
  for (const ruta of conflictos) {
    decisiones[ruta] = (await opts.resolveConflict?.(ruta)) ?? "renombrar";
  }

  const resultado = await invocar<{ copiados: string[]; omitidos: string[] }>("copiar_arbol", {
    ...args,
    decisiones,
  });

  // Un solo indexado para todo lo copiado (el watcher lo vería archivo por
  // archivo), y el árbol al día sin recargar (HU-07 CA5).
  const { indexarVault } = await import("@/lib/db/indexer");
  const indexado = await indexarVault(vault);
  const store = useVaultStore.getState();
  store.setOtros(indexado.otros);
  if (store.vaultId) await store.loadTree(store.vaultId);

  const notas = resultado.copiados.filter(esNota).length;
  return {
    notas,
    adjuntos: resultado.copiados.length - notas,
    omitidos: resultado.omitidos,
  };
}

/**
 * Cuántos bytes se mandan por llamada al bajar archivos a la carpeta temporal.
 * Van como un arreglo de números en el JSON del IPC (unas cuatro veces su
 * tamaño): con tandas chicas ningún mensaje se vuelve enorme.
 */
const TANDA_BYTES = 4 * 1024 * 1024;

/**
 * Importa archivos que no llegan como carpeta (un .zip, archivos soltados o
 * elegidos): se bajan a una carpeta temporal, por tandas, y de ahí sigue
 * `importarCarpeta`. La carpeta temporal se borra al terminar.
 */
export async function importarArchivos(
  files: CollectedFile[],
  destFolderId: string | null,
  opts: Opciones = {},
): Promise<ImportSummary> {
  let dir: string | null = null;
  try {
    let tanda: { ruta_relativa: string; bytes: number[] }[] = [];
    let bytesTanda = 0;
    const volcar = async () => {
      dir = await invocar<string>("escribir_temporal_importacion", { dir, archivos: tanda });
      tanda = [];
      bytesTanda = 0;
    };
    let hechos = 0;
    for (const f of files) {
      const bytes = new Uint8Array(await f.file.arrayBuffer());
      tanda.push({ ruta_relativa: f.path, bytes: Array.from(bytes) });
      bytesTanda += bytes.length;
      if (bytesTanda >= TANDA_BYTES) await volcar();
      opts.onProgress?.(++hechos, files.length);
    }
    if (tanda.length > 0 || dir === null) await volcar();
    return await importarCarpeta(dir!, destFolderId, opts);
  } finally {
    if (dir !== null) {
      await invocar<void>("borrar_temporal_importacion", { dir }).catch(() => {
        // Queda en el temporal del sistema, que el SO limpia: no es fatal.
      });
    }
  }
}
