import { api } from "@/lib/api";
import {
  accionCargar,
  accionExportarSvg,
  contenidoParaCargar,
  leerEvento,
  urlDelRenderizador,
} from "@/lib/drawio";
import { resolveWikilink } from "@/lib/editor/wikilink";
import { useVaultStore, type TreeNota } from "@/stores/vaultStore";

/**
 * Vistas previas de los diagramas embebidos en una nota (`FUN-L-20`, CA5).
 *
 * `![[diagrama.drawio]]` se muestra como **imagen**, no como editor: se hace
 * clic y se abre la pestaña. Es la misma decisión que ya tomó Excalidraw con sus
 * embeds, y resuelve la duda que la spec dejó abierta en § 8. Un editor entero
 * por cada embed de una nota sería un iframe por diagrama, cada uno con la
 * webapp completa cargada.
 *
 * > [!note] Quién dibuja el SVG
 * > El XML de mxGraph solo lo entiende draw.io, así que el SVG lo produce la
 * > propia webapp: hay **un** iframe oculto que actúa de servicio de dibujo y
 * > atiende los pedidos de a uno. Se crea la primera vez que hace falta y se
 * > queda para los demás embeds.
 */

/** Cuánto se espera un render antes de darlo por perdido. */
const TIMEOUT_MS = 20000;

let iframe: HTMLIFrameElement | null = null;
let listo: Promise<HTMLIFrameElement> | null = null;
/** Los pedidos se encolan: el iframe tiene un solo diagrama cargado por vez. */
let cola: Promise<unknown> = Promise.resolve();

/** Crea (una sola vez) el iframe oculto y espera a que el editor diga `init`. */
function arrancar(): Promise<HTMLIFrameElement> {
  if (listo !== null) return listo;
  listo = new Promise<HTMLIFrameElement>((resolver, rechazar) => {
    const marco = document.createElement("iframe");
    // Fuera de la vista pero **no** `display:none`: draw.io necesita un tamaño
    // real para calcular el `viewBox` del SVG, y un iframe sin caja lo exporta
    // vacío. Es el motivo de que esté posicionado en vez de oculto.
    marco.style.cssText =
      "position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden";
    marco.setAttribute("aria-hidden", "true");
    marco.setAttribute("tabindex", "-1");
    marco.src = urlDelRenderizador();

    const limite = setTimeout(() => {
      rechazar(new Error("el renderizador de draw.io no arrancó"));
    }, TIMEOUT_MS);

    function alRecibir(ev: MessageEvent) {
      if (ev.source !== marco.contentWindow) return;
      const msg = leerEvento(ev.data);
      if (msg?.event !== "init") return;
      clearTimeout(limite);
      window.removeEventListener("message", alRecibir);
      resolver(marco);
    }

    window.addEventListener("message", alRecibir);
    document.body.appendChild(marco);
    iframe = marco;
  }).catch((e) => {
    // Un arranque fallido no puede dejar la promesa cacheada: el siguiente
    // embed tiene que poder reintentar.
    listo = null;
    if (iframe) iframe.remove();
    iframe = null;
    throw e;
  });
  return listo;
}

/** Carga un XML en el iframe oculto y devuelve el SVG como data URI. */
function pedirSvg(marco: HTMLIFrameElement, xml: string): Promise<string> {
  return new Promise<string>((resolver, rechazar) => {
    const limite = setTimeout(() => {
      window.removeEventListener("message", alRecibir);
      rechazar(new Error("el diagrama tardó demasiado en dibujarse"));
    }, TIMEOUT_MS);

    const enviar = (accion: unknown) =>
      marco.contentWindow?.postMessage(JSON.stringify(accion), "*");

    function alRecibir(ev: MessageEvent) {
      if (ev.source !== marco.contentWindow) return;
      const msg = leerEvento(ev.data);
      if (msg === null) return;
      if (msg.event === "load") {
        // Ya está el diagrama adentro: recién ahora tiene sentido exportarlo.
        enviar(accionExportarSvg());
        return;
      }
      if (msg.event === "export") {
        clearTimeout(limite);
        window.removeEventListener("message", alRecibir);
        if (typeof msg.data === "string" && msg.data.length > 0) resolver(msg.data);
        else rechazar(new Error("la exportación vino vacía"));
      }
    }

    window.addEventListener("message", alRecibir);
    enviar(accionCargar(xml));
  });
}

/** Dibuja un XML de mxGraph y devuelve el SVG como data URI. Encola. */
export function diagramaASvg(xml: string): Promise<string> {
  const pedido = cola
    .catch(() => undefined)
    .then(async () => pedirSvg(await arrancar(), xml));
  cola = pedido.catch(() => undefined);
  return pedido;
}

/** La nota `.drawio` a la que apunta un embed, si existe. */
export function resolverDestinoDrawio(ref: string): TreeNota | undefined {
  const { notas, carpetas } = useVaultStore.getState();
  const destino = resolveWikilink(ref, notas, carpetas);
  return destino && destino.tipo === "drawio" ? destino : undefined;
}

/**
 * Convierte un placeholder en la vista previa del diagrama.
 *
 * Nunca lanza: un diagrama que no se puede dibujar deja un bloque con el motivo
 * y la nota sigue leyéndose. Devuelve el id de la nota destino, que es lo que
 * necesita quien maneja el clic para abrir la pestaña.
 */
async function dibujarEn(bloque: HTMLElement, ref: string): Promise<string | null> {
  bloque.classList.add("mic-drawio-block");
  bloque.setAttribute("data-diag", ref);
  const destino = resolverDestinoDrawio(ref);
  if (!destino) {
    bloque.classList.add("mic-drawio-error");
    bloque.textContent = `No existe el diagrama "${ref}".`;
    return null;
  }
  bloque.setAttribute("data-nota", destino.id);
  bloque.title = "Clic para abrir el diagrama";
  try {
    const r = await api<{ contenido?: string }>(
      `/notas/${encodeURIComponent(destino.id)}/contenido`,
    );
    const svg = await diagramaASvg(contenidoParaCargar(r.contenido));
    const img = document.createElement("img");
    img.src = svg;
    img.alt = `Diagrama ${destino.titulo}`;
    img.className = "mic-drawio-img";
    bloque.replaceChildren(img);
  } catch (e) {
    bloque.classList.add("mic-drawio-error");
    bloque.textContent = `No se pudo dibujar "${ref}": ${
      e instanceof Error ? e.message : String(e)
    }`;
  }
  return destino.id;
}

/**
 * Reemplaza los placeholders `a.mic-drawio[data-diag]` del preview por la vista
 * previa del diagrama. Espeja a `renderExcalidrawIn`.
 */
export async function renderDrawioIn(container: HTMLElement): Promise<void> {
  const anclas = container.querySelectorAll<HTMLElement>("a.mic-drawio[data-diag]");
  for (const ancla of Array.from(anclas)) {
    const ref = ancla.getAttribute("data-diag");
    if (!ref) continue;
    const bloque = document.createElement("div");
    ancla.replaceWith(bloque);
    await dibujarEn(bloque, ref);
  }
}
