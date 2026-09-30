import { api } from "@/lib/api";
import { resolveWikilink } from "@/lib/editor/wikilink";
import { useVaultStore } from "@/stores/vaultStore";
import type { TreeNota } from "@/stores/vaultStore";
import { diagnosticarExcalidraw, motivoDeExcepcion } from "@/lib/archivosIlegibles";

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
 * El contenido de un `.excalidraw` no se pudo leer (`DEF-119`). `message` es el
 * motivo, para mostrarlo tal cual en el aviso.
 */
export class DibujoIlegible extends Error {}

/** Escena ya restaurada, lista para `initialData` o `updateScene`. */
export type EscenaLeida = ExcalidrawScene & { files: Record<string, unknown> | null };

/** Lo que resulta de leer el contenido de un `.excalidraw`. */
export type LecturaEscena = { escena: EscenaLeida } | { ilegible: string };

/**
 * Lee el contenido de un `.excalidraw` y lo pasa por `restoreElements`: lo mismo
 * que hace Excalidraw con `initialData`, y lo que hace falta para `updateScene`,
 * que NO restaura (un archivo escrito a mano —por una IA— puede traer elementos
 * con campos de menos).
 *
 * Un archivo **vacío** (recién creado) es un dibujo en blanco. Uno que no se
 * puede leer **no** lo es (`DEF-119`): antes caía en la misma escena vacía, sin
 * aviso, y lo primero que se dibujara encima se guardaba sobre el original. El
 * criterio de forma vive en `diagnosticarExcalidraw`; acá se suma el segundo
 * filtro, `restoreElements`, que todavía puede tirar con algo que tiene la forma
 * correcta (una flecha sin `points`).
 */
export async function leerEscena(contenido: string): Promise<LecturaEscena> {
  const diagnostico = diagnosticarExcalidraw(contenido);
  if (diagnostico.estado === "ilegible") return { ilegible: diagnostico.motivo };
  if (diagnostico.estado === "vacio") return { escena: { elements: [], files: null } };
  const crudo = JSON.parse(contenido) as {
    elements: unknown[];
    appState?: unknown;
    files?: unknown;
  };
  const { restoreElements } = await import("@excalidraw/excalidraw");
  let elementos: readonly unknown[];
  try {
    elementos = restoreElements(crudo.elements as never, null);
  } catch (e) {
    return { ilegible: `Excalidraw no pudo reconstruir el dibujo: ${motivoDeExcepcion(e)}` };
  }
  return {
    escena: {
      elements: elementos,
      appState:
        crudo.appState && typeof crudo.appState === "object"
          ? (crudo.appState as Record<string, unknown>)
          : undefined,
      files:
        crudo.files && typeof crudo.files === "object"
          ? (crudo.files as Record<string, unknown>)
          : null,
    },
  };
}

/**
 * Carga la escena de un archivo .excalidraw del vault (nota tipo 'excalidraw'),
 * cuyo contenido es el JSON de la escena (igual que cualquier nota). Un archivo
 * vacío —recién creado— es una escena vacía; `null` si no se pudo leer del
 * disco, y tira `DibujoIlegible` si se leyó pero no es un dibujo (`DEF-119`).
 */
export async function loadNotaScene(notaId: string): Promise<ExcalidrawScene | null> {
  let data: { contenido?: string };
  try {
    data = await api<{ contenido?: string }>(`/notas/${encodeURIComponent(notaId)}/contenido`);
  } catch {
    return null;
  }
  const lectura = await leerEscena(data.contenido ?? "");
  if ("ilegible" in lectura) throw new DibujoIlegible(lectura.ilegible);
  return lectura.escena;
}


/**
 * Cómo se encuadra un dibujo al abrirlo (`FUN-L-26`): todo lo dibujado a la
 * vista, con margen, sin agrandar un dibujo chico más allá del 100 %
 * (`fitToContent` ya trae ese tope) y sin que la barra de herramientas de
 * Excalidraw —que flota sobre la franja de arriba— ni los controles de zoom y
 * deshacer de abajo tapen nada: `canvasOffsets` saca esas franjas del área útil.
 */
const ENCUADRE_AL_ABRIR = {
  fitToContent: true,
  viewportZoomFactor: 0.9,
  animate: false,
  canvasOffsets: { top: 64, right: 0, bottom: 56, left: 0 },
};

/** Lo que `encuadrarDibujo` necesita de la API imperativa de Excalidraw. */
export type ApiEncuadre = {
  scrollToContent: (target?: undefined, opts?: typeof ENCUADRE_AL_ABRIR) => void;
};

/**
 * ¿La escena tiene algo que encuadrar? Los borrados no cuentan: Excalidraw los
 * conserva en la escena (`isDeleted`), pero no se ven.
 */
export function hayAlgoDibujado(elementos: readonly unknown[]): boolean {
  return elementos.some((e) => !(e as { isDeleted?: boolean } | null)?.isDeleted);
}

/**
 * Encuadra el dibujo (ver `ENCUADRE_AL_ABRIR`). Va en el cuadro siguiente: la
 * primera `onChange` con la escena cargada puede llegar antes de que Excalidraw
 * termine de medir su contenedor.
 *
 * Lo llama la vista **solo al montar el editor**: la recarga desde disco
 * (`updateScene`) conserva la cámara a propósito, y volver a encuadrar en cada
 * cambio de afuera movería el dibujo debajo del usuario.
 */
export function encuadrarDibujo(api: ApiEncuadre): void {
  requestAnimationFrame(() => api.scrollToContent(undefined, ENCUADRE_AL_ABRIR));
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
  } catch (e) {
    block.classList.add("mic-excalidraw-error");
    // Un dibujo ilegible (`DEF-119`) ya NO se muestra como «vacío — clic para
    // dibujar»: eso invitaba a dibujar encima y pisar el original. Se dice qué
    // pasa; el clic abre el modal, que tampoco deja editarlo.
    block.textContent =
      e instanceof DibujoIlegible
        ? `No se pudo leer el dibujo "${ref}": ${e.message} El archivo no se modificó.`
        : `No se pudo cargar el diagrama "${ref}".`;
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
  let scene: ExcalidrawScene | null;
  try {
    scene = await loadNotaScene(target.id);
  } catch {
    return; // ilegible (`DEF-119`): el embed ya lo dice y no hay nada que exportar
  }
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
