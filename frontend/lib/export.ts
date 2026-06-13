import JSZip from "jszip";
import { api } from "@/lib/api";
import { getCachedNote } from "@/lib/idb";
import { useAuthStore } from "@/stores/authStore";
import { useVaultStore } from "@/stores/vaultStore";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5279";
const EXCALIDRAW_RE = /!\[\[([0-9a-f-]+)\.excalidraw\]\]/gi;

/** Nombre de archivo seguro a partir del título de la nota. */
function safeName(titulo: string): string {
  return titulo.replace(/[\\/:*?"<>|]/g, "_").trim() || "nota";
}

/** Descarga un Blob en el cliente (HU-08 CA4). */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Contenido de una nota: backend primero, IndexedDB si no hay conexión (HU-08 CA5). */
export async function fetchNoteContent(notaId: string): Promise<string> {
  try {
    const data = await api<{ contenido: string }>(`/notas/${notaId}/contenido`, {
      token: useAuthStore.getState().accessToken,
    });
    return data.contenido;
  } catch {
    const cached = await getCachedNote(notaId);
    if (cached) return cached.content;
    throw new Error("No se pudo obtener el contenido de la nota.");
  }
}

/** Exporta la nota activa como `.md` crudo, 100% en cliente (HU-08). */
export async function exportNoteMd(notaId: string, titulo: string): Promise<void> {
  const contenido = await fetchNoteContent(notaId);
  downloadBlob(new Blob([contenido], { type: "text/markdown" }), `${safeName(titulo)}.md`);
}

/** Ruta de carpetas de una nota dentro del vault (sin el nombre del archivo). */
function notePath(carpetaId: string | null): string {
  if (!carpetaId) return "";
  const carpetas = useVaultStore.getState().carpetas;
  const byId = new Map(carpetas.map((c) => [c.id, c]));
  const parts: string[] = [];
  let current = byId.get(carpetaId);
  while (current) {
    parts.unshift(safeName(current.nombre));
    current = current.padreId ? byId.get(current.padreId) : undefined;
  }
  return parts.length ? `${parts.join("/")}/` : "";
}

/**
 * Exporta todo el vault como ZIP en el cliente (HU-09): preserva la estructura
 * de carpetas y agrega los diagramas referenciados en `adjuntos/`. La rama
 * servidor para vaults ≥ 200 MB queda diferida (docs/FUTURE_IMPLEMENTATIONS.md).
 */
export async function exportVaultZip(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { notas, vaultId } = useVaultStore.getState();
  const vaultNombre = useAuthStore.getState().vaults.find((v) => v.id === vaultId)?.nombre ?? "vault";
  const token = useAuthStore.getState().accessToken;

  const zip = new JSZip();
  const adjuntos = new Set<string>();
  let done = 0;

  for (const nota of notas) {
    const contenido = await fetchNoteContent(nota.id);
    zip.file(`${notePath(nota.carpetaId)}${safeName(nota.titulo)}.md`, contenido);

    for (const match of contenido.matchAll(EXCALIDRAW_RE)) {
      adjuntos.add(`${nota.id}:${match[1]}`);
    }
    onProgress?.(++done, notas.length);
  }

  // Diagramas Excalidraw referenciados → adjuntos/ (HU-09 CA3)
  for (const ref of adjuntos) {
    const [notaId, diagId] = ref.split(":");
    try {
      const res = await fetch(`${API_URL}/notas/${notaId}/diagramas/${diagId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (res.ok) zip.file(`adjuntos/${diagId}.excalidraw`, await res.text());
    } catch {
      // adjunto inaccesible → se omite
    }
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const fecha = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `vault-${safeName(vaultNombre)}-${fecha}.zip`);
}

/** Exporta la nota como PDF con el tema aplicado, vía backend (HU-10). */
export async function exportNotePdf(
  notaId: string,
  titulo: string,
  pageSize: "A4" | "Letter",
  tema: string,
  modoOscuro: boolean,
): Promise<void> {
  const res = await fetch(`${API_URL}/notas/${notaId}/exportar-pdf`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(useAuthStore.getState().accessToken
        ? { Authorization: `Bearer ${useAuthStore.getState().accessToken}` }
        : {}),
    },
    body: JSON.stringify({ pageSize, tema, modoOscuro }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error((err as { error?: string })?.error ?? "No se pudo exportar el PDF.");
  }
  downloadBlob(await res.blob(), `${safeName(titulo)}.pdf`);
}
