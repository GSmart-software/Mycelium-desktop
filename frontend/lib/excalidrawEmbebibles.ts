/**
 * Qué se puede embeber en un dibujo de Excalidraw (`DEF-167`).
 *
 * Solo **videos de YouTube y Vimeo**, con las formas de URL que Excalidraw
 * convierte en un reproductor (`https://www.youtube.com/embed/…` o
 * `https://player.vimeo.com/video/…`, los mismos orígenes que admite la CSP en
 * `frame-src`). Cualquier otra dirección —otros sitios, otros esquemas, otros
 * subdominios, mayúsculas en el dominio— no se monta: Excalidraw deja el
 * recuadro con el enlace escrito, sin contenido.
 *
 * Es puro —sin imports— para que lo pruebe `scripts/test-excalidraw-embebibles.mjs`.
 */

/** Identificador de un video o de una lista de YouTube. */
const ID = "[A-Za-z0-9_-]+";
/**
 * Parámetros extra admitidos (`&t=30`, `?si=…`). Solo caracteres que no cambian
 * al normalizar el enlace: sin `%`, `;`, `#`, comillas ni espacios.
 */
const PARAMS = "(?:[?&][A-Za-z0-9_.-]+=[A-Za-z0-9_.-]*)*";

const FORMAS_PERMITIDAS: readonly RegExp[] = [
  // youtube.com/watch?v=…, /playlist?list=…
  new RegExp(`^https://(?:www\\.)?youtube\\.com/(?:watch\\?v=|playlist\\?list=)${ID}${PARAMS}$`),
  // youtube.com/embed/…, /shorts/…, /embed/videoseries?list=…
  new RegExp(`^https://(?:www\\.)?youtube\\.com/(?:embed/videoseries\\?list=|embed/|shorts/)${ID}${PARAMS}$`),
  // youtu.be/…
  new RegExp(`^https://youtu\\.be/${ID}${PARAMS}$`),
  // vimeo.com/123 y player.vimeo.com/video/123
  new RegExp(`^https://(?:www\\.)?vimeo\\.com/\\d+${PARAMS}$`),
  new RegExp(`^https://player\\.vimeo\\.com/video/\\d+${PARAMS}$`),
];

/** Dominios de los que se aceptan videos. */
const DOMINIOS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

/**
 * ¿Se puede embeber esta dirección en un dibujo? Va como `validateEmbeddable`
 * en toda instancia de `<Excalidraw>`: devuelve siempre un booleano, así que
 * Excalidraw no cae en su propia lista de sitios.
 */
export function esEmbebiblePermitido(url: unknown): boolean {
  if (typeof url !== "string" || url.length > 2048) return false;
  if (!FORMAS_PERMITIDAS.some((re) => re.test(url))) return false;
  // Segunda comprobación, con el parser del navegador: el dominio que resulta
  // tiene que ser exactamente uno de la lista, sin usuario ni puerto.
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      DOMINIOS.has(u.hostname) &&
      u.username === "" &&
      u.password === "" &&
      u.port === ""
    );
  } catch {
    return false;
  }
}

/**
 * Quita el HTML guardado en los elementos `iframe` de Excalidraw
 * (`customData.generationData`, que su función de generación de interfaces
 * muestra como página). Mycelium no tiene esa función: el elemento queda como
 * un recuadro sin contenido. Devuelve el mismo arreglo si no hay nada que quitar.
 */
export function sinContenidoGenerado<T>(elementos: readonly T[]): readonly T[] {
  let cambio = false;
  const salida = elementos.map((el) => {
    const e = el as { type?: unknown; customData?: unknown } | null;
    if (
      !e ||
      e.type !== "iframe" ||
      !e.customData ||
      typeof e.customData !== "object" ||
      !("generationData" in e.customData)
    ) {
      return el;
    }
    cambio = true;
    const { generationData: _quitado, ...resto } = e.customData as Record<string, unknown>;
    void _quitado;
    return { ...e, customData: resto } as T;
  });
  return cambio ? salida : elementos;
}

/**
 * Va como `onPaste` de `<Excalidraw>`: limpia (`sinContenidoGenerado`) los
 * elementos que llegan por el portapapeles antes de que entren a la escena.
 * Devuelve `true`: el pegado sigue su curso normal.
 */
export function pegadoSinContenidoGenerado(datos: { elements?: readonly unknown[] }): true {
  if (datos.elements) datos.elements = sinContenidoGenerado(datos.elements);
  return true;
}

/**
 * La biblioteca de Excalidraw con `sinContenidoGenerado` aplicado a cada ítem,
 * o `null` si no había nada que quitar (para no volver a escribirla).
 */
export function bibliotecaSinContenidoGenerado<T extends { elements: readonly unknown[] }>(
  items: readonly T[],
): T[] | null {
  let cambio = false;
  const salida = items.map((item) => {
    const elementos = sinContenidoGenerado(item.elements);
    if (elementos === item.elements) return item;
    cambio = true;
    return { ...item, elements: elementos };
  });
  return cambio ? salida : null;
}

/** Los únicos `src` que puede tener un iframe dentro de un dibujo. */
const SRC_PERMITIDO = /^https:\/\/(?:www\.youtube\.com\/embed\/|player\.vimeo\.com\/video\/)[A-Za-z0-9_?=&.%-]+$/;

/** Deja en blanco un iframe que no muestra un video de YouTube o Vimeo. */
function vaciarSiNoPermitido(iframe: HTMLIFrameElement): void {
  if (iframe.hasAttribute("srcdoc")) iframe.removeAttribute("srcdoc");
  const src = iframe.getAttribute("src");
  if (src !== null && src !== "about:blank" && !SRC_PERMITIDO.test(src)) {
    iframe.setAttribute("src", "about:blank");
  }
}

/**
 * Vigila los iframes que Excalidraw crea dentro de `contenedor` y deja en blanco
 * los que no muestran un video de YouTube o Vimeo, sin importar cómo llegó el
 * elemento al dibujo (abrir un archivo, soltarlo sobre el lienzo, la biblioteca).
 * El observador corre al terminar el cambio del DOM: un `srcdoc` no llega a
 * mostrarse, y una dirección ajena se reemplaza por `about:blank` (la primera
 * petición puede haber salido; para eso está antes `esEmbebiblePermitido`).
 * Devuelve la función que deja de vigilar.
 */
export function vigilarIframes(contenedor: HTMLElement): () => void {
  const revisar = (raiz: ParentNode) => {
    raiz.querySelectorAll("iframe").forEach(vaciarSiNoPermitido);
  };
  const observador = new MutationObserver((cambios) => {
    for (const c of cambios) {
      if (c.type === "attributes") {
        if (c.target instanceof HTMLIFrameElement) vaciarSiNoPermitido(c.target);
        continue;
      }
      c.addedNodes.forEach((n) => {
        if (n instanceof HTMLIFrameElement) vaciarSiNoPermitido(n);
        else if (n instanceof Element) revisar(n);
      });
    }
  });
  observador.observe(contenedor, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcdoc"],
  });
  revisar(contenedor);
  return () => observador.disconnect();
}
