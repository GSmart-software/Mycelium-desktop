import JSZip from "jszip";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useVaultStore } from "@/stores/vaultStore";

export type CollectedFile = { path: string; file: File };

export type ConflictChoice = "reemplazar" | "renombrar" | "cancelar";

export type ImportSummary = {
  notas: number;
  adjuntos: number;
  omitidos: string[];
};

const token = () => useAuthStore.getState().accessToken;

const isInsideObsidian = (path: string) => /(^|\/)\.obsidian\//.test(path);
const isMarkdown = (path: string) => /\.md$/i.test(path);
const ADJUNTO_RE = /\.(excalidraw|png|jpe?g|gif|svg|webp|pdf)$/i;

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

/**
 * Lee una carpeta real del SO elegida con el diálogo nativo (escritorio). El
 * recorrido recursivo lo hace el comando Rust `leer_carpeta` (ignora directorios
 * ocultos como `.git`/`.obsidian`); aquí solo se envuelve cada resultado en un
 * `File` para que encaje con el pipeline de importación existente.
 */
export async function collectFromNativeFolder(origen: string): Promise<CollectedFile[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const archivos = await invoke<{ ruta_relativa: string; contenido: string }[]>("leer_carpeta", {
    origen,
  });
  return archivos.map(({ ruta_relativa: path, contenido }) => ({
    path,
    file: new File([contenido], path.split("/").pop() ?? path, { type: "text/markdown" }),
  }));
}

/** Extrae archivos de un .zip de Obsidian (HU-11 CA1). */
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

/**
 * Importa un conjunto de archivos al vault preservando la jerarquía (HU-07/11).
 * Crea las carpetas necesarias, resuelve conflictos de nombre y sincroniza el
 * contenido. Los adjuntos/diagramas se cuentan pero no se almacenan en esta
 * versión (sin subsistema de adjuntos — docs/FUTURE_IMPLEMENTATIONS.md).
 */
export async function importFiles(
  files: CollectedFile[],
  destFolderId: string | null,
  opts: {
    onProgress?: (done: number, total: number) => void;
    resolveConflict?: (nombre: string) => Promise<ConflictChoice>;
  } = {},
): Promise<ImportSummary> {
  const { vaultId } = useVaultStore.getState();
  if (!vaultId) throw new Error("Sin vault activo.");

  const usables = files.filter((f) => !isInsideObsidian(f.path)); // HU-11 CA3
  const mdFiles = usables.filter((f) => isMarkdown(f.path));
  const adjuntos = usables.filter((f) => !isMarkdown(f.path) && ADJUNTO_RE.test(f.path));

  const summary: ImportSummary = { notas: 0, adjuntos: 0, omitidos: [] };

  // Adjuntos: no almacenables aún → se reportan como omitidos (honesto, HU-11 CA6)
  for (const a of adjuntos) {
    summary.omitidos.push(`${a.path} (adjunto no soportado)`);
  }

  // Caché de carpetas creadas: ruta relativa → id (raíz = destFolderId)
  const folderCache = new Map<string, string | null>([["", destFolderId]]);
  const ensureFolder = async (dir: string): Promise<string | null> => {
    if (folderCache.has(dir)) return folderCache.get(dir)!;
    const segments = dir.split("/").filter(Boolean);
    let parentPath = "";
    let parentId = destFolderId;
    for (const seg of segments) {
      const path = parentPath ? `${parentPath}/${seg}` : seg;
      if (folderCache.has(path)) {
        parentId = folderCache.get(path)!;
      } else {
        const res = await api<{ id: string }>(`/vaults/${vaultId}/carpetas`, {
          method: "POST",
          token: token(),
          body: { nombre: seg, padreId: parentId },
        });
        folderCache.set(path, res.id);
        parentId = res.id;
      }
      parentPath = path;
    }
    folderCache.set(dir, parentId);
    return parentId;
  };

  // Títulos ya existentes/creados por carpeta destino, para detectar conflictos
  const existing = useVaultStore.getState().notas;
  const keyOf = (cid: string | null, titulo: string) => `${cid ?? "root"}::${titulo.toLowerCase()}`;
  const seen = new Set(existing.map((n) => keyOf(n.carpetaId, n.titulo)));

  let done = 0;
  for (const f of mdFiles) {
    const text = await f.file.text();
    if (text.includes("�")) {
      summary.omitidos.push(`${f.path} (no es UTF-8)`); // HU-07 CA6
      opts.onProgress?.(++done, mdFiles.length);
      continue;
    }

    const parts = f.path.split("/");
    const filename = parts.pop()!;
    const dir = parts.join("/");
    const carpetaId = await ensureFolder(dir);

    let titulo = filename.replace(/\.md$/i, "");
    if (seen.has(keyOf(carpetaId, titulo))) {
      const choice = (await opts.resolveConflict?.(titulo)) ?? "renombrar";
      if (choice === "cancelar") {
        summary.omitidos.push(`${f.path} (cancelado por conflicto)`);
        opts.onProgress?.(++done, mdFiles.length);
        continue;
      }
      if (choice === "renombrar") {
        let i = 1;
        while (seen.has(keyOf(carpetaId, `${titulo}-${i}`))) i++;
        titulo = `${titulo}-${i}`;
      }
      // "reemplazar": se crea igual; el título queda duplicado lógico, pero el
      // contenido nuevo entra como nota nueva (no hay merge destructivo).
    }

    const created = await api<{ id: string }>(`/vaults/${vaultId}/notas`, {
      method: "POST",
      token: token(),
      body: { titulo, carpetaId },
    });
    await api(`/notas/${created.id}/contenido`, {
      method: "PUT",
      token: token(),
      body: { contenido: text },
    });
    seen.add(keyOf(carpetaId, titulo));
    summary.notas++;
    opts.onProgress?.(++done, mdFiles.length);
  }

  await useVaultStore.getState().loadTree(vaultId); // disponible sin recargar (CA5)
  return summary;
}
