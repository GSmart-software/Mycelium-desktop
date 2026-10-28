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
 * El destino de una dirección escrita **suelta** en el texto (`DEF-132`): lo que
 * el parser de GFM reconoce como enlace sin corchetes —`https://…`, `www.…`, un
 * correo— o entre `<…>`. Le falta el esquema en dos casos, y se lo pone igual
 * que GitHub: `www.` va a `https://` y un correo a `mailto:`. Lo demás pasa tal
 * cual; quien lo use igual lo filtra con `destinoExterno`.
 */
export function destinoDeUrlSuelta(texto: string): string {
  const limpio = texto.trim();
  if (/^www\./i.test(limpio)) return `https://${limpio}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(limpio) && limpio.includes("@")) return `mailto:${limpio}`;
  return limpio;
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
 *
 * > [!danger] Si el clic cae en un `<a>`, la navegación se corta SIEMPRE (`DEF-160`)
 * > Antes solo se cortaba cuando el enlace era externo y permitido: un
 * > `javascript:` —o cualquier esquema rechazado— volvía `false` sin
 * > `preventDefault()` y la webview lo **ejecutaba**. Ahora el `<a>` nunca
 * > navega por su cuenta: o lo abre este módulo, o lo atiende quien llama
 * > (wikilinks, etiquetas), o no pasa nada.
 *
 * `objetivo` es el elemento del clic; se busca el `<a>` más cercano. Para las
 * vistas que no usan `<a>` —la edición en vivo pinta el enlace como texto— se
 * puede pasar el `href` a mano con `hrefExplicito`; sin `<a>` no hay navegación
 * que cortar, así que ahí solo se corta si el destino se abre.
 */
export function manejarClicDeEnlace(
  evento: { preventDefault: () => void; target: EventTarget | null },
  hrefExplicito?: string | null,
): boolean {
  const ancla = anclaDe(evento.target);
  // El orden importa: cortar la navegación ANTES de decidir o abrir nada.
  if (ancla) evento.preventDefault();
  const href = hrefExplicito ?? ancla?.getAttribute("href") ?? null;
  if (!esEnlaceExterno(href)) return false;
  if (!ancla) evento.preventDefault();
  void abrirEnNavegador(href as string);
  return true;
}

/** Lo que una vista sabe hacer con un enlace interno. */
export interface AccionesDeEnlace {
  /** `[[Nota]]` / `[[Nota#Encabezado]]`: el destino ya decodificado. */
  abrirNota?: (destino: string) => void;
}

/**
 * EL manejador de clic de una vista que muestra HTML renderizado (`DEF-160`):
 * lectura, tarjetas de lienzo, detalle de recordatorios, visor lateral, preview
 * vinculado y notas de actualización.
 *
 * Si el clic no cae en un `<a>`, devuelve `false` y no toca el evento. Si cae,
 * **siempre** corta la navegación y después decide:
 * - `#wikilink:` → `acciones.abrirNota`, si la vista sabe abrir notas;
 * - externo permitido (`http:`, `https:`, `mailto:`) → el navegador del sistema;
 * - cualquier otra cosa (`#tag:`, un ancla, una ruta, un esquema rechazado) →
 *   nada. La webview no navega nunca.
 *
 * Devuelve `true` cuando el clic era de un enlace (lo haya abierto o no).
 */
export function atenderClicEnEnlace(
  evento: { preventDefault: () => void; target: EventTarget | null },
  acciones: AccionesDeEnlace = {},
): boolean {
  const ancla = anclaDe(evento.target);
  if (!ancla) return false;
  evento.preventDefault();
  const href = ancla.getAttribute("href") ?? "";
  if (href.startsWith("#wikilink:")) {
    let destino: string;
    try {
      destino = decodeURIComponent(href.slice("#wikilink:".length));
    } catch {
      return true; // un `%` mal formado: no es un destino que se pueda abrir
    }
    acciones.abrirNota?.(destino);
    return true;
  }
  if (esEnlaceExterno(href)) void abrirEnNavegador(href);
  return true;
}

/** El `<a>` más cercano al objetivo de un evento, o `null`. */
function anclaDe(objetivo: EventTarget | null): Element | null {
  const el = objetivo as { closest?: (sel: string) => Element | null } | null;
  return el?.closest?.("a") ?? null;
}

// ── Saneo de URLs del HTML renderizado (`DEF-160`) ────────────────────────────
//
// La segunda capa: aunque un clic se escapara del manejador, en el HTML no queda
// ningún `href`/`src` con un esquema que no sea de los nuestros. El pipeline de
// Markdown (`lib/markdown.ts`) lo aplica a todo lo que produce, antes de pasarlo
// a texto.

/** Para qué se usa una URL: decide qué esquemas valen. */
export type UsoDeUrl = "enlace" | "imagen" | "marco";

const ENTIDADES: Record<string, string> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  sol: "/",
  bsol: "\\",
  lpar: "(",
  rpar: ")",
  period: ".",
  num: "#",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: String.fromCharCode(0xa0),
};

/** Decodifica las referencias de carácter HTML (`&#106;`, `&#x6A;`, `&colon;`). */
function decodificarEntidades(s: string): string {
  return s.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi,
    (m: string, hex?: string, dec?: string, nombre?: string) => {
      if (hex !== undefined || dec !== undefined) {
        const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec as string, 10);
        return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
      }
      return ENTIDADES[String(nombre).toLowerCase()] ?? m;
    },
  );
}

/**
 * La forma de una URL que se usa SOLO para leer su esquema: sin entidades HTML,
 * sin espacios ni caracteres de control en ningún lugar (el navegador ignora el
 * tab y el salto dentro de `java\tscript:`) y en minúsculas. Se decodifica hasta
 * que no cambie, para que `&amp;#106;` no esconda nada.
 */
export function formaParaEsquema(valor: string): string {
  let s = valor;
  for (let i = 0; i < 4; i++) {
    const d = decodificarEntidades(s);
    if (d === s) break;
    s = d;
  }
  return Array.from(s)
    .filter((c) => !esInvisible(c.codePointAt(0) ?? 0))
    .join("")
    .toLowerCase();
}

/** Espacios, controles C0/C1, el espacio duro y los invisibles de ancho cero. */
function esInvisible(cp: number): boolean {
  return (
    cp <= 0x20 ||
    (cp >= 0x7f && cp <= 0xa0) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0xfeff
  );
}

/**
 * ¿Puede quedar esta URL en el HTML para este uso?
 *
 * - Siempre: vacía, un ancla (`#…`, que cubre `#wikilink:`, `#tag:`,
 *   `#excalidraw`, `#drawio`) y una ruta relativa sin esquema.
 * - `http:` y `https:`: siempre.
 * - `mailto:` y `ayuda:` (páginas de la ayuda integrada): solo en un enlace.
 * - `data:image/…`: solo en una imagen (`![](data:image/png;base64,…)`).
 * - Cualquier otro esquema (`javascript:`, `vbscript:`, `data:text/html`,
 *   `file:`, `search-ms:`…): no.
 */
export function urlPermitida(valor: unknown, uso: UsoDeUrl = "enlace"): boolean {
  if (typeof valor !== "string") return false;
  const plano = formaParaEsquema(valor);
  if (plano === "" || plano.startsWith("#")) return true;
  const m = /^([a-z][a-z0-9+.-]*):/.exec(plano);
  if (!m) return true; // relativa: es del vault, y no ejecuta nada
  const esquema = `${m[1]}:`;
  if (esquema === "http:" || esquema === "https:") return true;
  // `ayuda:` es el enlace entre páginas de la ayuda integrada (`lib/ayuda/`),
  // que se renderiza con este mismo pipeline. No ejecuta nada: lo atiende
  // `VentanaAyuda`, y en cualquier otra vista el clic se corta y no pasa nada.
  if (uso === "enlace") return esquema === "mailto:" || esquema === ESQUEMA_AYUDA_INTERNO;
  if (uso === "imagen") return plano.startsWith("data:image/");
  return false;
}

/** El esquema de `ESQUEMA_AYUDA` (`lib/ayuda/indice.ts`); copiado para no importar. */
const ESQUEMA_AYUDA_INTERNO = "ayuda:";

/** Atributos (en nombres de propiedad de hast) que llevan una URL. */
const ATRIBUTOS_DE_URL: Record<string, UsoDeUrl | "src"> = {
  href: "enlace",
  xLinkHref: "enlace",
  action: "enlace",
  formAction: "enlace",
  cite: "enlace",
  src: "src",
  poster: "imagen",
  background: "imagen",
  data: "marco",
};

/** Un nodo de hast, con lo poco que hace falta para recorrerlo. */
export interface NodoHast {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: NodoHast[];
}

/** El `title` de un enlace neutralizado: dice por qué no lleva a ninguna parte. */
export const TITULO_ENLACE_BLOQUEADO = "Enlace bloqueado: Mycelium no abre este tipo de dirección";

/**
 * Recorre un árbol hast y quita toda URL que `urlPermitida` rechace. El
 * elemento se queda —un enlace neutralizado se sigue leyendo, solo que ya no
 * lleva a ninguna parte— y se le pone un `title` que dice por qué.
 */
export function sanearUrlsHast(nodo: NodoHast): void {
  if (nodo.type === "element" && nodo.properties) {
    const props = nodo.properties;
    for (const [clave, uso] of Object.entries(ATRIBUTOS_DE_URL)) {
      const valor = props[clave];
      if (valor === undefined || valor === null) continue;
      const efectivo: UsoDeUrl =
        uso === "src" ? (nodo.tagName === "img" ? "imagen" : "marco") : uso;
      if (urlPermitida(Array.isArray(valor) ? valor.join(" ") : valor, efectivo)) continue;
      delete props[clave];
      if (clave === "href") props.title = TITULO_ENLACE_BLOQUEADO;
    }
    const srcSet = props.srcSet;
    if (srcSet !== undefined && srcSet !== null) {
      const fuentes = Array.isArray(srcSet) ? srcSet : String(srcSet).split(",");
      const ok = fuentes.every(
        (f) => typeof f === "string" && urlPermitida(f.trim().split(/\s+/)[0] ?? "", "imagen"),
      );
      if (!ok) delete props.srcSet;
    }
  }
  if (nodo.children) for (const hijo of nodo.children) sanearUrlsHast(hijo);
}
