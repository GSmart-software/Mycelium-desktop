import { useAuthStore } from "@/stores/authStore";

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
): Promise<void> {
  const anchors = container.querySelectorAll<HTMLElement>(
    "a.mic-excalidraw[data-diag]",
  );
  for (const anchor of Array.from(anchors)) {
    const diagId = anchor.getAttribute("data-diag");
    if (!diagId) continue;

    const block = document.createElement("div");
    block.className = "mic-excalidraw-block";
    block.setAttribute("data-diag", diagId);
    block.title = "Clic para editar el diagrama";

    try {
      const scene = await loadDiagram(notaId, diagId);
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
      error.textContent = `No se pudo cargar el diagrama "${diagId}".`;
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
