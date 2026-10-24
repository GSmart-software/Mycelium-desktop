/**
 * Fuentes de Excalidraw sin respaldo remoto. Módulo aparte y sin imports para
 * que `scripts/smoke-excalidraw-fuentes.mjs` lo pruebe tal cual en Chromium.
 * El porqué está en `cargarExcalidraw()` (`lib/excalidraw.ts`).
 */

/** Prefijo del respaldo remoto que Excalidraw suma a las URLs de sus fuentes. */
const RESPALDO_REMOTO = "https://esm.sh/@excalidraw/";

/**
 * Envuelve `window.FontFace` para que una fuente cuyo `src` traiga el respaldo
 * de esm.sh se cree sin él. Solo toca las entradas `url(https://esm.sh/@excalidraw/…)`
 * de un `src` de texto y deja todo lo demás igual; la subclase mantiene
 * `instanceof FontFace` y `document.fonts.add`. Se instala una sola vez.
 */
export function sinRespaldoRemoto() {
  const Original = window.FontFace;
  if (!Original || (Original as { sinRespaldoRemoto?: boolean }).sinRespaldoRemoto) return;
  class FontFaceLocal extends Original {
    static sinRespaldoRemoto = true;
    constructor(familia: string, src: string | BufferSource, descriptores?: FontFaceDescriptors) {
      super(familia, typeof src === "string" ? quitarRespaldoRemoto(src) : src, descriptores);
    }
  }
  window.FontFace = FontFaceLocal;
}

/**
 * Saca del `src` de una fuente las entradas que apuntan al respaldo remoto de
 * Excalidraw. Si no quedara ninguna, devuelve el `src` intacto: mejor una
 * violación de la CSP que una fuente sin origen.
 */
export function quitarRespaldoRemoto(src: string): string {
  const entradas = src.split(/,\s*(?=url\()/);
  const locales = entradas.filter((e) => !e.trimStart().startsWith(`url(${RESPALDO_REMOTO}`));
  return locales.length > 0 ? locales.join(", ") : src;
}
