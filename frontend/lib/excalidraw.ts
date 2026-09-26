import { api } from "@/lib/api";
import { resolveWikilink } from "@/lib/editor/wikilink";
import { useVaultStore } from "@/stores/vaultStore";
import type { TreeNota } from "@/stores/vaultStore";

/**
 * Dibujos de Excalidraw (HU-16/HU-17). Un dibujo es **un archivo del vault**
 * (`.excalidraw`, nota de tipo `excalidraw`) cuyo contenido es el JSON de la
 * escena; una nota lo muestra con `![[título.excalidraw]]`.
 *
 * > [!info] Hubo un segundo mecanismo, retirado en `FUN-M-40` (D6, `DEF-112`)
 * > Soltar un `.excalidraw` sobre el editor guardaba la escena en una tabla
 * > `diagramas` del índice, colgada de la nota, e insertaba `![[<uuid>.excalidraw]]`.
 * > Ese dibujo no existía en disco: reconstruir el índice lo perdía sin aviso.
 * > Ahora el drop crea un archivo como la barra de herramientas, y
 * > `lib/db/legado.ts` exporta a archivos lo que un índice viejo todavía tenga.
 */

/** Escena .excalidraw mínima que persistimos (HU-16 CA4/CA5). */
export type ExcalidrawScene = {
  type?: string;
  version?: number;
  source?: string;
  elements: readonly unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown> | null;
};

/**
 * Carga la escena de un archivo .excalidraw del vault (nota tipo 'excalidraw'),
 * cuyo contenido es el JSON de la escena (igual que cualquier nota). Un archivo
 * vacío —recién creado— es una escena vacía.
 */
export async function loadNotaScene(notaId: string): Promise<ExcalidrawScene | null> {
  let data: { contenido?: string };
  try {
    data = await api<{ contenido?: string }>(`/notas/${encodeURIComponent(notaId)}/contenido`);
  } catch {
    return null;
  }
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

/** Guarda la escena en el CONTENIDO de un archivo .excalidraw del vault. */
export async function saveNotaScene(notaId: string, scene: ExcalidrawScene): Promise<void> {
  const contenido = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "micelio",
    elements: scene.elements,
    appState: scene.appState ?? {},
    files: scene.files ?? {},
  });
  await api(`/notas/${encodeURIComponent(notaId)}/contenido`, {
    method: "PUT",
    body: { contenido },
  });
}

/** Resuelve `![[ref.excalidraw]]` a un archivo .excalidraw del vault (por título
 *  o ruta), o undefined si no corresponde a una nota tipo excalidraw. */
export function resolveExcalidrawTarget(ref: string): TreeNota | undefined {
  const { notas, carpetas } = useVaultStore.getState();
  const target = resolveWikilink(ref, notas, carpetas);
  return target && target.tipo === "excalidraw" ? target : undefined;
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
 * Renderiza el dibujo referenciado por `ref` dentro de `block` (SVG inline) y
 * marca `data-nota` con el id del archivo (clic → editarlo). Si `ref` no nombra
 * un archivo .excalidraw del vault, deja el aviso de error sin romper la nota
 * (HU-16 CA6). Devuelve el id del archivo, o `null`.
 */
export async function renderExcalidrawInto(
  block: HTMLElement,
  ref: string,
): Promise<string | null> {
  block.classList.add("mic-excalidraw-block");
  block.setAttribute("data-diag", ref);
  const target = resolveExcalidrawTarget(ref);
  try {
    if (!target) throw new Error("no encontrado");
    block.setAttribute("data-nota", target.id);
    block.title = "Clic para editar el dibujo";
    const scene = await loadNotaScene(target.id);
    if (!scene) throw new Error("no encontrado");
    if (scene.elements.length === 0) {
      block.classList.add("mic-excalidraw-empty");
      block.textContent = "Diagrama vacío — clic para dibujar";
    } else {
      block.appendChild(await sceneToSvg(scene));
    }
  } catch {
    block.classList.add("mic-excalidraw-error");
    block.textContent = `No se pudo cargar el diagrama "${ref}".`;
  }
  return target?.id ?? null;
}

/**
 * Reemplaza los placeholders `a.mic-excalidraw[data-diag]` del preview por
 * el diagrama renderizado como SVG inline (HU-16 CA2). Error de carga →
 * placeholder sin romper la nota (CA6).
 */
export async function renderExcalidrawIn(container: HTMLElement): Promise<void> {
  const anchors = container.querySelectorAll<HTMLElement>(
    "a.mic-excalidraw[data-diag]",
  );
  for (const anchor of Array.from(anchors)) {
    const ref = anchor.getAttribute("data-diag");
    if (!ref) continue;
    const block = document.createElement("div");
    await renderExcalidrawInto(block, ref);
    anchor.replaceWith(block);
  }
}

/**
 * Exporta como PNG o SVG el dibujo que nombra `ref` y dispara la descarga
 * (HU-17). El archivo descargado lleva el título del dibujo.
 */
export async function exportDiagram(ref: string, format: "png" | "svg"): Promise<void> {
  const target = resolveExcalidrawTarget(ref);
  if (!target) return;
  const scene = await loadNotaScene(target.id);
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
  link.download = `${target.titulo}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
