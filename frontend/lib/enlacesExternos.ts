/**
 * Qué pasa al hacer clic en un enlace a algo que no es una nota (`FUN-S-20`).
 *
 * Corrige `DEF-101`, que era el defecto más grave del catálogo: en la vista de
 * lectura, un clic en `[texto](https://…)` **navegaba la webview** y se llevaba
 * Mycelium entero —el marco de ventana es propio (`FUN-M-31`), así que no
 * quedaba barra de dirección ni botón de volver—. En la vista en vivo, el mismo
 * enlace no hacía nada.
 *
 * > [!important] Esto vive en UN solo sitio, y es lo que más importa del arreglo
 * > Los clics en enlaces se atienden en cinco lugares distintos: la vista de
 * > lectura (`NoteEditor`), la vista en vivo (`livePreview`), el widget de
 * > tablas, el de propiedades y el canvas. Arreglar uno dejaría enlaces que
 * > abren bien en una vista y **se llevan la app** en otra. Es exactamente la
 * > forma del defecto de las tres copias de la extensión (`FUN-L-20`).
 *
 * > OJO: la parte de decidir es **pura y sin imports**, para que
 * > `scripts/test-enlaces-externos.mjs` la pruebe sin navegador. Lo único que
 * > toca Tauri es `abrirEnNavegador`, con un `import()` perezoso.
 */

/**
 * Los únicos esquemas que se le entregan al sistema.
 *
 * > [!danger] La lista es corta a propósito
 * > Una nota puede venir importada, escrita por otra persona o generada por una
 * > IA. Pasarle al sistema un `file://`, un `javascript:` o un protocolo que
 * > registró otra aplicación (`ms-msdt:`, `search-ms:`…) es abrirle una puerta
 * > a cualquiera que consiga que abras una nota. Si algo no está acá, no se
 * > abre: no se intenta y se avisa.
 */
export const ESQUEMAS_PERMITIDOS = ["http:", "https:", "mailto:"] as const;

/** ¿Este `href` apunta afuera de Mycelium, con un esquema que sabemos abrir? */
export function esEnlaceExterno(href: string | null | undefined): boolean {
  return destinoExterno(href) !== null;
}

/**
 * El destino externo de un `href`, ya normalizado, o `null` si no lo es.
 *
 * Devuelve `null` —o sea, «esto no es cosa mía»— para:
 * - los enlaces internos de Mycelium (`#wikilink:`, `#tag:`, `#excalidraw`…);
 * - las anclas dentro de la misma nota (`#un-titulo`);
 * - las rutas relativas (`otra-nota.md`, `./imagen.png`), que son del vault;
 * - cualquier esquema que no esté en `ESQUEMAS_PERMITIDOS`.
 */
export function destinoExterno(href: string | null | undefined): string | null {
  if (typeof href !== "string") return null;
  const limpio = href.trim();
  if (limpio.length === 0) return null;
  // Un ancla o un enlace interno de la app: lo atiende quien lo puso.
  if (limpio.startsWith("#")) return null;

  // `URL` sin base: si no lanza, es absoluta. Una ruta relativa lanza, y es
  // justo lo que queremos descartar sin tener que adivinar su forma.
  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return null;
  }
  if (!(ESQUEMAS_PERMITIDOS as readonly string[]).includes(url.protocol)) return null;
  return url.href;
}

/**
 * Abre `href` en el navegador predeterminado del sistema.
 *
 * No lanza: si el esquema no está permitido o el plugin falla, lo deja anotado
 * en la consola y sigue. Un enlace que no abre es un incordio; una excepción
 * suelta en un manejador de clic puede dejar la vista a medio pintar.
 */
export async function abrirEnNavegador(href: string): Promise<boolean> {
  const destino = destinoExterno(href);
  if (destino === null) {
    console.warn(`[enlaces] no se abre un destino con esquema no permitido: ${href}`);
    return false;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(destino);
    return true;
  } catch (e) {
    console.warn(`[enlaces] no se pudo abrir ${destino}:`, e);
    return false;
  }
}

/**
 * Atiende un clic que podría ser un enlace externo.
 *
 * Devuelve `true` si lo tomó (y entonces quien llama no debe hacer nada más).
 * **Siempre** hace `preventDefault()` cuando toma el enlace: sin eso la webview
 * navega igual y vuelve `DEF-101`.
 *
 * `objetivo` es el elemento del clic; se busca el `<a>` más cercano. Para las
 * vistas que no usan `<a>` —la edición en vivo pinta el enlace como texto— se
 * puede pasar el `href` a mano con `hrefExplicito`.
 */
export function manejarClicDeEnlace(
  evento: { preventDefault: () => void; target: EventTarget | null },
  hrefExplicito?: string | null,
): boolean {
  let href = hrefExplicito ?? null;
  if (href === null) {
    const elemento = evento.target as HTMLElement | null;
    href = elemento?.closest?.("a")?.getAttribute("href") ?? null;
  }
  if (!esEnlaceExterno(href)) return false;
  // El orden importa: cortar la navegación ANTES de abrir nada.
  evento.preventDefault();
  void abrirEnNavegador(href as string);
  return true;
}
