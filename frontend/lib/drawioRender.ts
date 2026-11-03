import { api } from "@/lib/api";
import { analizarXml, diagnosticarDrawio } from "@/lib/archivosIlegibles";
import {
  accionCargar,
  accionExportarSvg,
  baseDrawio,
  CacheLru,
  contenidoParaCargar,
  destinoDeMensajes,
  esMensajeDeDrawio,
  huellaXml,
  leerEvento,
  origenDeBase,
  SANDBOX_RENDERIZADOR,
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
 * > atiende los pedidos de a uno. Se crea la primera vez que hace falta.
 *
 * > [!note] Y se suelta cuando no se usa (`FUN-M-58`)
 * > Ese iframe es la webapp entera: +95 MB medidos en Chromium con GPU
 * > (auditoría de eficiencia del 2026-11-01, C-H2), y antes se quedaba toda la
 * > sesión por un solo embed visto al pasar. Ahora se suelta tras `OCIOSO_MS`
 * > sin pedidos y se recrea en el próximo; y los SVG ya dibujados se guardan en
 * > una caché por huella del XML, así que re-renderizar la misma nota (cambiar
 * > de vista, volver a la pestaña) ni siquiera despierta al iframe.
 */

/** Cuánto se espera un render antes de darlo por perdido. */
const TIMEOUT_MS = 20000;

let iframe: HTMLIFrameElement | null = null;
/** El origen de draw.io (`DEF-168`): se fija al crear el iframe. */
let origen = "";
let listo: Promise<HTMLIFrameElement> | null = null;
/** Los pedidos se encolan: el iframe tiene un solo diagrama cargado por vez. */
let cola: Promise<unknown> = Promise.resolve();

/**
 * Tiempo sin pedidos tras el cual se suelta el iframe renderizador. Un minuto
 * cubre el ir y venir dentro de una nota (cada edición cerca de un embed lo
 * re-renderiza) sin retener 95 MB por un embed que se vio una vez.
 */
const OCIOSO_MS = 60_000;

/**
 * Tope de la caché de SVG: 32 diagramas o 8 M caracteres (~16 MB en UTF-16), lo
 * que llegue primero. Un SVG de un diagrama mediano ronda los 20–100 KB como
 * data URI, así que 32 es varias notas llenas de embeds, y el tope de tamaño
 * impide que un puñado de diagramas enormes se lleve lo que ahorró soltar el
 * iframe.
 */
const CACHE_MAX_ENTRADAS = 32;
const CACHE_MAX_CARACTERES = 8_000_000;

/** Pedidos aceptados que todavía no terminaron (encolados o en vuelo). */
let pendientes = 0;
let ocioso: ReturnType<typeof setTimeout> | null = null;
const cache = new CacheLru(CACHE_MAX_ENTRADAS, CACHE_MAX_CARACTERES);
/** El mismo XML pedido dos veces a la vez comparte el render. */
const enVuelo = new Map<string, Promise<string>>();

/**
 * Suelta el iframe renderizador. Solo actúa sin pedidos pendientes: con uno
 * encolado o en vuelo, `pendientes` lo impide (y `diagramaASvg` cancela el
 * temporizador al aceptar uno nuevo, así que esto es una segunda red).
 */
function soltarRenderizador() {
  ocioso = null;
  if (pendientes > 0) return;
  if (iframe) iframe.remove();
  iframe = null;
  listo = null;
}

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
    // Su propio origen, sin interfaz y sin poder navegar la ventana (`DEF-168`).
    const base = baseDrawio();
    origen = origenDeBase(base);
    marco.setAttribute("sandbox", SANDBOX_RENDERIZADOR);
    marco.setAttribute("referrerpolicy", "no-referrer");
    marco.src = urlDelRenderizador(base);

    const limite = setTimeout(() => {
      rechazar(new Error("el renderizador de draw.io no arrancó"));
    }, TIMEOUT_MS);

    function alRecibir(ev: MessageEvent) {
      if (!esMensajeDeDrawio(ev, marco.contentWindow, origen)) return;
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
      marco.contentWindow?.postMessage(JSON.stringify(accion), destinoDeMensajes(origen));

    function alRecibir(ev: MessageEvent) {
      if (!esMensajeDeDrawio(ev, marco.contentWindow, origen)) return;
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
        // Va al `src` de un <img>: solo un SVG como data URI, nada más.
        if (typeof msg.data === "string" && /^data:image\/svg\+xml[;,]/.test(msg.data)) resolver(msg.data);
        else rechazar(new Error("la exportación vino vacía o no es un SVG"));
      }
    }

    window.addEventListener("message", alRecibir);
    enviar(accionCargar(xml));
  });
}

/**
 * Dibuja un XML de mxGraph y devuelve el SVG como data URI. Encola.
 *
 * Primero mira la caché; solo lo que no está ahí despierta (o crea) el iframe.
 */
export function diagramaASvg(xml: string): Promise<string> {
  const huella = huellaXml(xml);
  const guardado = cache.get(huella);
  if (guardado !== undefined) return Promise.resolve(guardado);
  const yaVa = enVuelo.get(huella);
  if (yaVa) return yaVa;

  pendientes++;
  if (ocioso !== null) {
    clearTimeout(ocioso);
    ocioso = null;
  }
  const pedido = cola
    .catch(() => undefined)
    .then(async () => pedirSvg(await arrancar(), xml))
    .then((svg) => {
      cache.set(huella, svg);
      return svg;
    })
    .finally(() => {
      enVuelo.delete(huella);
      pendientes--;
      if (pendientes === 0 && ocioso === null) {
        ocioso = setTimeout(soltarRenderizador, OCIOSO_MS);
      }
    });
  enVuelo.set(huella, pedido);
  cola = pedido.catch(() => undefined);
  return pedido;
}

/** Para los tests: si el iframe renderizador existe y cuántos SVG hay guardados. */
export function estadoRenderizador(): { vivo: boolean; enCache: number } {
  return { vivo: iframe !== null, enCache: cache.tamano };
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
export async function dibujarDrawioEn(
  bloque: HTMLElement,
  ref: string,
): Promise<string | null> {
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
    // Un diagrama ilegible (`DEF-119`) se dice como tal, en vez de dibujar uno
    // en blanco que lo hacía pasar por vacío.
    const lectura = diagnosticarDrawio(r.contenido ?? "", analizarXml);
    if (lectura.estado === "ilegible") {
      throw new Error(`${lectura.motivo} El archivo no se modificó.`);
    }
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
    await dibujarDrawioEn(bloque, ref);
  }
}
