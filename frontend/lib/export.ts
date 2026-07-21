import JSZip from "jszip";
import { api } from "@/lib/api";
import { getCachedNote } from "@/lib/idb";
import { renderMarkdown } from "@/lib/markdown";
import { renderMermaidIn } from "@/lib/mermaid";
import { renderExcalidrawIn } from "@/lib/excalidraw";
import { PRINT_CSS } from "@/lib/printStyles";
import { useAuthStore } from "@/stores/authStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useVaultStore } from "@/stores/vaultStore";

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
    const data = await api<{ contenido: string }>(`/notas/${encodeURIComponent(notaId)}/contenido`, {
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

/** Un archivo del vault listo para escribirse (en un ZIP o en disco). */
export type ArchivoVault = { rutaRelativa: string; contenido: string };

/**
 * Recolecta todo el vault como una lista de archivos de texto: una entrada `.md`
 * por nota (preservando la estructura de carpetas) más los diagramas Excalidraw
 * referenciados en `adjuntos/` (HU-09 CA3). Es la fuente común del export a ZIP
 * y del export a carpeta nativa.
 */
export async function recolectarArchivosVault(
  onProgress?: (done: number, total: number) => void,
): Promise<ArchivoVault[]> {
  const { notas } = useVaultStore.getState();
  const out: ArchivoVault[] = [];
  const adjuntos = new Set<string>();
  let done = 0;

  for (const nota of notas) {
    const contenido = await fetchNoteContent(nota.id);
    out.push({
      rutaRelativa: `${notePath(nota.carpetaId)}${safeName(nota.titulo)}.md`,
      contenido,
    });

    for (const match of contenido.matchAll(EXCALIDRAW_RE)) {
      adjuntos.add(`${nota.id}:${match[1]}`);
    }
    onProgress?.(++done, notas.length);
  }

  // Diagramas Excalidraw referenciados → adjuntos/ (HU-09 CA3)
  for (const ref of adjuntos) {
    const [notaId, diagId] = ref.split(":");
    try {
      const json = await api<string>(`/notas/${encodeURIComponent(notaId)}/diagramas/${diagId}`);
      out.push({ rutaRelativa: `adjuntos/${diagId}.excalidraw`, contenido: json });
    } catch {
      // adjunto inaccesible → se omite
    }
  }

  return out;
}

/**
 * Exporta todo el vault como ZIP en el cliente (HU-09): preserva la estructura
 * de carpetas y agrega los diagramas referenciados en `adjuntos/`. La rama
 * servidor para vaults ≥ 200 MB queda diferida (docs/FUTURE_IMPLEMENTATIONS.md).
 */
export async function exportVaultZip(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { vaultId } = useVaultStore.getState();
  const vaultNombre = useAuthStore.getState().vaults.find((v) => v.id === vaultId)?.nombre ?? "vault";

  const zip = new JSZip();
  for (const archivo of await recolectarArchivosVault(onProgress)) {
    zip.file(archivo.rutaRelativa, archivo.contenido);
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const fecha = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `vault-${safeName(vaultNombre)}-${fecha}.zip`);
}

/**
 * Exporta todo el vault a una carpeta real del SO como árbol de `.md` (escritorio).
 * La escritura la hace el comando Rust `exportar_a_carpeta`, que valida que ninguna
 * ruta se salga del destino. Devuelve cuántos archivos se escribieron.
 */
export async function exportVaultACarpeta(
  destino: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const archivos = await recolectarArchivosVault(onProgress);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<number>("exportar_a_carpeta", {
    destino,
    archivos: archivos.map((a) => ({ ruta_relativa: a.rutaRelativa, contenido: a.contenido })),
  });
}

/**
 * Renderiza la nota a HTML fuera de pantalla, incluyendo los SVG de Mermaid y
 * Excalidraw (HU-10 CA4), para enviarlo al backend tal cual se imprime.
 */
async function renderNoteHtml(notaId: string): Promise<string> {
  const content = await fetchNoteContent(notaId);
  const container = document.createElement("div");
  container.className = "mic-preview";
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.width = "800px";
  container.innerHTML = renderMarkdown(content);
  document.body.appendChild(container);
  try {
    await renderMermaidIn(container);
    await renderExcalidrawIn(container, notaId);
    return container.innerHTML;
  } finally {
    container.remove();
  }
}

/**
 * Exporta la nota como PDF 100% en el cliente (HU-10, escritorio): renderiza el
 * HTML de la nota (con SVG de Mermaid/Excalidraw) en un iframe oculto con el tema
 * y el tamaño de página aplicados, y abre el diálogo de impresión del webview
 * (el usuario elige "Guardar como PDF"). Sustituye la generación por PuppeteerSharp
 * del backend; el resultado puede diferir ligeramente.
 */
export async function exportNotePdf(
  notaId: string,
  titulo: string,
  pageSize: "A4" | "Letter",
  tema: string,
  modoOscuro: boolean,
): Promise<void> {
  const html = await renderNoteHtml(notaId);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    throw new Error("No se pudo preparar la impresión.");
  }

  const darkAttr = modoOscuro ? ' data-dark="true"' : "";
  doc.open();
  doc.write(
    `<!doctype html><html data-theme="${tema}"${darkAttr}><head><meta charset="utf-8">` +
      `<title>${safeName(titulo)}</title>` +
      `<style>@page { size: ${pageSize}; margin: 16mm; } ${PRINT_CSS}</style></head>` +
      `<body><div class="mic-preview">${html}</div></body></html>`,
  );
  doc.close();

  // Dar tiempo a que rendericen SVG/imágenes antes de abrir el diálogo.
  await new Promise((resolve) => setTimeout(resolve, 300));
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  // Retirar el iframe tras cerrar el diálogo (no bloqueante).
  setTimeout(() => iframe.remove(), 1000);
}

/** Atajo de exportación a PDF con el tema activo de preferencias (HU-10). */
export async function exportNotePdfActive(
  notaId: string,
  titulo: string,
  pageSize: "A4" | "Letter",
): Promise<void> {
  const { tema, modoOscuro } = usePreferencesStore.getState();
  try {
    await exportNotePdf(notaId, titulo, pageSize, tema, modoOscuro);
  } catch (error) {
    if (typeof window !== "undefined") window.alert((error as Error).message);
  }
}
