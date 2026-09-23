/**
 * Vídeos embebidos en una nota (`FUN-S-21`): `![](https://youtu.be/ID)` muestra
 * el reproductor, como en Obsidian.
 *
 * > [!important] Esto hace que la app cargue contenido remoto — y no contradice
 * > a draw.io
 * > `FUN-L-20` empaquetó la webapp de draw.io entera, 100 MB, justamente para
 * > **no depender de la red**. Acá pasa lo contrario y es correcto: allí se
 * > trataba de que *la aplicación* funcione sin conexión —el vault es una
 * > carpeta en el disco, y el índice, la búsqueda y el grafo no tocan la red—;
 * > acá la conexión **la pide el usuario**, explícitamente, al pegar el enlace
 * > de un vídeo que vive en YouTube. Un vídeo remoto sin conexión degrada a un
 * > recuadro con su enlace; el editor de diagramas sin conexión era trabajo
 * > perdido. Queda escrito porque dentro de seis meses parece un descuido.
 *
 * > [!note] Por `youtube-nocookie.com`
 * > Es el mismo reproductor, servido por Google sin las cookies de seguimiento
 * > hasta que el usuario le da al play. No es privacidad completa —la petición
 * > del vídeo sale igual— pero es gratis y es estrictamente mejor.
 *
 * > OJO: este módulo es **puro y sin imports** a propósito — así
 * > `scripts/test-video.mjs` puede transpilarlo e importarlo sin build, igual
 * > que `lib/drawio.ts`, `lib/canvas.ts` y `lib/frontmatter.ts`.
 */

/** De dónde sale el vídeo. */
export type ProveedorVideo = "youtube" | "vimeo";

export type VideoEmbebido = {
  proveedor: ProveedorVideo;
  /** El id del vídeo en su proveedor. */
  id: string;
  /** La URL que va en el `src` del iframe. */
  src: string;
  /** El enlace original, para poder ofrecerlo si el reproductor no carga. */
  url: string;
};

/** Un id de YouTube son 11 caracteres de `[A-Za-z0-9_-]`. */
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;
/** Un id de Vimeo son solo dígitos. */
const ID_VIMEO = /^\d+$/;

/**
 * Host sin `www.`, en minúsculas. Compararlo entero —y no por sufijo— es lo que
 * evita que `youtube.com.evil.net` se cuele como si fuera YouTube.
 */
function hostDe(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Interpreta una URL de vídeo. Devuelve `null` si no lo es.
 *
 * Acepta las formas que la gente pega de verdad:
 * - `youtube.com/watch?v=ID`
 * - `youtu.be/ID`
 * - `youtube.com/shorts/ID`
 * - `youtube.com/embed/ID` y `youtube-nocookie.com/embed/ID`
 * - `youtube.com/live/ID`
 * - `vimeo.com/123456789`
 */
export function leerVideo(href: string | null | undefined): VideoEmbebido | null {
  if (typeof href !== "string") return null;
  const limpio = href.trim();
  if (limpio.length === 0) return null;

  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return null;
  }
  // Solo `http(s)`: nada de esquemas raros disfrazados de vídeo.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = hostDe(url);
  // Los segmentos no vacíos de la ruta (`/shorts/ID/` → `["shorts", "ID"]`).
  const partes = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    return armarYoutube(partes[0], limpio);
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (partes.length === 0) {
      // `youtube.com/watch?v=ID`: el id va en la consulta, no en la ruta.
      return armarYoutube(url.searchParams.get("v"), limpio);
    }
    if (partes[0] === "watch") return armarYoutube(url.searchParams.get("v"), limpio);
    if (partes[0] === "shorts" || partes[0] === "embed" || partes[0] === "live") {
      return armarYoutube(partes[1], limpio);
    }
    return null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    // `vimeo.com/123` y `player.vimeo.com/video/123`.
    const id = partes[0] === "video" ? partes[1] : partes[0];
    if (id !== undefined && ID_VIMEO.test(id)) {
      return {
        proveedor: "vimeo",
        id,
        src: `https://player.vimeo.com/video/${id}`,
        url: limpio,
      };
    }
    return null;
  }
  return null;
}

function armarYoutube(id: string | null | undefined, url: string): VideoEmbebido | null {
  if (id === null || id === undefined || !ID_YOUTUBE.test(id)) return null;
  return {
    proveedor: "youtube",
    id,
    // `nocookie` y sin sugerencias de otros canales al terminar (`rel=0`).
    src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
    url,
  };
}

/** ¿Este `href` es un vídeo que sabemos embeber? */
export function esVideo(href: string | null | undefined): boolean {
  return leerVideo(href) !== null;
}

/**
 * Los permisos del iframe del reproductor.
 *
 * > [!warning] `allow-same-origin` hace falta, y no es lo que parece
 * > Sin él el reproductor **no arranca**: el usuario ve un recuadro negro y
 * > nada más. Medido con el reproductor real (2026-09-23): sin
 * > `allow-same-origin`, cero peticiones del reproductor y el marco liso; con
 * > él, el póster dibujado y el reproductor pidiendo su vídeo.
 * >
 * > Lo que concede **no** es acceso a Mycelium. `allow-same-origin` significa
 * > «no le pongas un origen opaco a este documento», así que el iframe conserva
 * > el **suyo** —`youtube-nocookie.com`—, que sigue siendo distinto del de la
 * > app: la política de mismo origen le impide igual tocar el `localStorage`,
 * > las cookies o el DOM de Mycelium. Lo que rompía era el propio YouTube, que
 * > necesita su almacenamiento para funcionar.
 * >
 * > Lo que sí hay que seguir negando es `allow-top-navigation`: con eso el
 * > iframe podría llevarse la ventana entera, que es justo el `DEF-101`.
 *
 * `allow-presentation` es lo que permite la pantalla completa del reproductor.
 */
export const SANDBOX_VIDEO =
  "allow-scripts allow-popups allow-presentation allow-same-origin";

/** Lo que el iframe puede pedirle al navegador. */
export const ALLOW_VIDEO = "accelerometer; encrypted-media; picture-in-picture; fullscreen";

/** Título accesible del reproductor. */
export function tituloDeVideo(v: VideoEmbebido): string {
  return v.proveedor === "youtube" ? `Vídeo de YouTube ${v.id}` : `Vídeo de Vimeo ${v.id}`;
}
