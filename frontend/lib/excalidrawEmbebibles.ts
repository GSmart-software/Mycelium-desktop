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
