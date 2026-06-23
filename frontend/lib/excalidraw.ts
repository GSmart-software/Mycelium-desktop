import { useAuthStore } from "@/stores/authStore";
import type { TreeNota } from "@/stores/vaultStore";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5279";

/** Escena .excalidraw mínima que persistimos (HU-16 CA4/CA5). */
export type ExcalidrawScene = {
  type?: string;
  version?: number;
  source?: string;
  elements: readonly unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown> | null;
};

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function loadDiagram(
  notaId: string,
  diagId: string,
): Promise<ExcalidrawScene | null> {
  const response = await fetch(`${API_URL}/notas/${notaId}/diagramas/${diagId}`, {
    credentials: "include",
    headers: authHeaders(),
  });
  if (!response.ok) return null;
  return (await response.json()) as ExcalidrawScene;
}

/**
 * Carga la escena de un archivo .excalidraw del vault (nota tipo 'excalidraw'),
 * cuyo contenido es el JSON de la escena (igual que cualquier nota). Permite
 * embeber `![[archivo.excalidraw]]` apuntando a un archivo independiente.
 */
export async function loadNotaScene(notaId: string): Promise<ExcalidrawScene | null> {
  const response = await fetch(`${API_URL}/notas/${notaId}/contenido`, {
    credentials: "include",
    headers: authHeaders(),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { contenido?: string };
  if (!data.contenido) return { elements: [] };
  try {
    const parsed = JSON.parse(data.contenido);
    return {
      elements: parsed.elements ?? [],
      appState: parsed.appState,
      files: parsed.files ?? null,
    };
  } catch {
    return { elements: [] };
  }
}

export async function saveDiagram(
  notaId: string,
  diagId: string,
  scene: ExcalidrawScene,
): Promise<void> {
  await fetch(`${API_URL}/notas/${notaId}/diagramas/${diagId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "micelio",
      ...scene,
    }),
  });
}

function exportDarkMode(): boolean {
  return document.documentElement.dataset.dark === "true";
}

async function sceneToSvg(scene: ExcalidrawScene): Promise<SVGSVGElement> {
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  return exportToSvg({
    elements: scene.elements as never,
    appState: {
      ...scene.appState,
      exportWithDarkMode: exportDarkMode(),
      exportBackground: false,
    } as never,
    files: (scene.files ?? null) as never,
  });
}

/**
 * Reemplaza los placeholders `a.mic-excalidraw[data-diag]` del preview por
 * el diagrama renderizado como SVG inline (HU-16 CA2). Error de carga →
 * placeholder sin romper la nota (CA6).
 */
export async function renderExcalidrawIn(
  container: HTMLElement,
  notaId: string,
  resolveNota?: (ref: string) => TreeNota | undefined,
): Promise<void> {
  const anchors = container.querySelectorAll<HTMLElement>(
    "a.mic-excalidraw[data-diag]",
  );
  for (const anchor of Array.from(anchors)) {
    const ref = anchor.getAttribute("data-diag");
    if (!ref) continue;

    const block = document.createElement("div");
    block.className = "mic-excalidraw-block";
    block.setAttribute("data-diag", ref);

    try {
      // 1) Archivo .excalidraw del vault (nota independiente) referenciado por
      //    título/ruta. 2) Si no, diagrama embebido bajo la nota actual (legado).
      let scene: ExcalidrawScene | null = null;
      const target = resolveNota?.(ref);
      if (target && target.tipo === "excalidraw") {
        scene = await loadNotaScene(target.id);
        block.setAttribute("data-nota", target.id); // clic → abrir el archivo
        block.title = "Clic para abrir el dibujo";
      } else {
        scene = await loadDiagram(notaId, ref);
        block.title = "Clic para editar el diagrama";
      }
      if (!scene) throw new Error("no encontrado");
      if (scene.elements.length === 0) {
        block.classList.add("mic-excalidraw-empty");
        block.textContent = "Diagrama vacío — clic para dibujar";
      } else {
        block.appendChild(await sceneToSvg(scene));
      }
      anchor.replaceWith(block);
    } catch {
      const error = document.createElement("div");
      error.className = "mic-excalidraw-error";
      error.textContent = `No se pudo cargar el diagrama "${ref}".`;
      anchor.replaceWith(error);
    }
  }
}

/** Exporta un diagrama como PNG o SVG y dispara la descarga (HU-17). */
export async function exportDiagram(
  notaId: string,
  diagId: string,
  format: "png" | "svg",
): Promise<void> {
  const scene = await loadDiagram(notaId, diagId);
  if (!scene) return;

  let blob: Blob;
  if (format === "png") {
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    blob = await exportToBlob({
      elements: scene.elements as never,
      appState: {
        ...scene.appState,
        exportWithDarkMode: exportDarkMode(),
      } as never,
      files: (scene.files ?? null) as never,
      mimeType: "image/png",
    });
  } else {
    const svg = await sceneToSvg(scene);
    blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${diagId}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
