/**
 * El idioma y la región del sistema, para elegir diccionario (`FUN-L-12`).
 *
 * El usuario ve **un solo «Español»**, que por debajo es la variante de la
 * región del sistema: con el de España, el voseo («tenés», «vení») sale todo
 * marcado. Sin región, o si no se publica una variante para ella, es-ES (el
 * `porDefecto` del manifiesto). Decisión del usuario del 2026-09-27.
 *
 * Módulo **puro** —sin imports—: los locales se reciben por parámetro. Quién
 * los consulta (`Intl`, `navigator`) es `localesDelSistema`, la única función
 * que toca el entorno, y a propósito no se prueba.
 */

/**
 * Los locales del sistema, del más al menos preferido. Primero el de `Intl`,
 * que en WebView2 refleja la configuración regional de Windows (en la PC del
 * usuario, `es-AR`), después los del navegador.
 */
export function localesDelSistema(): string[] {
  const locales: string[] = [];
  try {
    locales.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // Sin Intl no hay región: se sigue con lo que diga el navegador.
  }
  if (typeof navigator !== "undefined") {
    locales.push(...(navigator.languages ?? []), navigator.language);
  }
  return locales.filter((l): l is string => typeof l === "string" && l.length > 0);
}

/**
 * Lengua y región de un locale BCP 47: `es-AR` → `{ lengua: "es", region: "AR" }`,
 * `es-419` → región `419`, `zh-Hant-TW` → región `TW` (el script se saltea),
 * `es` → región `null`. Inválido → `null`.
 */
export function partesDeLocale(locale: string): { lengua: string; region: string | null } | null {
  const m = /^([a-z]{2,3})(?:[-_][A-Za-z]{4})?(?:[-_]([A-Za-z]{2}|\d{3}))?(?:[-_].*)?$/i.exec(locale.trim());
  if (!m) return null;
  return { lengua: m[1].toLowerCase(), region: m[2] ? m[2].toUpperCase() : null };
}

/**
 * La región del sistema: la del **primer** locale que la tenga. Es la región
 * del usuario aunque su Windows esté en inglés (`en-AR` sigue siendo Argentina).
 */
export function regionDelSistema(locales: string[]): string | null {
  for (const l of locales) {
    const p = partesDeLocale(l);
    if (p?.region) return p.region;
  }
  return null;
}

/** La lengua del sistema (`es`, `en`, `it`…): la del primer locale válido. */
export function lenguaDelSistema(locales: string[]): string | null {
  for (const l of locales) {
    const p = partesDeLocale(l);
    if (p) return p.lengua;
  }
  return null;
}

/** Lo mínimo que hace falta de un idioma del manifiesto para elegir variante. */
export type IdiomaConVariantes<V extends { id: string; region: string }> = {
  variantes: V[];
  porDefecto: string;
};

/**
 * La variante de un idioma para una región: la de esa región si se publica; si
 * no, la `porDefecto`; y si el manifiesto la nombrara mal, la primera. Para un
 * idioma de una sola variante (inglés, italiano) siempre es esa.
 *
 * `es-AR` → es-AR · `es-UY` sin variante uruguaya → es-ES · sin región → es-ES.
 */
export function elegirVariante<V extends { id: string; region: string }>(
  idioma: IdiomaConVariantes<V>,
  region: string | null,
): V | null {
  const { variantes } = idioma;
  if (region) {
    const exacta = variantes.find((v) => v.region.toUpperCase() === region.toUpperCase());
    if (exacta) return exacta;
  }
  return variantes.find((v) => v.id === idioma.porDefecto) ?? variantes[0] ?? null;
}
