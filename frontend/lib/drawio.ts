/**
 * draw.io (`FUN-L-20`): diagramas formales —figuras y conectores que se
 * enganchan— como un tipo de archivo más del vault. Ver `docs/features/drawio.md`.
 *
 * A diferencia de Excalidraw, draw.io **no publica un componente React**: lo que
 * ofrece es su aplicación entera en modo embebido, un `iframe` que habla por
 * `postMessage`. Este módulo es el lado Mycelium de ese protocolo: arma la URL
 * del iframe, y entiende y construye los mensajes. El `iframe` en sí lo monta
 * `components/drawio/DrawioView.tsx`.
 *
 * La webapp (`public/drawio/`, la baja `npm run preparar-drawio`) vive en **su
 * propio origen** (`DEF-168`): Rust la sirve por el esquema `drawio`
 * (`src-tauri/src/drawio_origen.rs`), que en Windows queda en
 * `http://drawio.localhost/` y en macOS/Linux en `drawio://localhost/`. La app le
 * habla solo por `postMessage`, con el origen de destino fijado, y solo acepta
 * los mensajes que vienen de su iframe y de ese origen (`esMensajeDeDrawio`).
 *
 * > OJO: este módulo es **puro y sin imports** a propósito — así
 * > `scripts/test-drawio.mjs` puede transpilarlo e importarlo sin build, igual
 * > que `lib/canvas.ts`, `lib/frontmatter.ts`, `lib/bases.ts` y `lib/enlaces.ts`.
 */

export const EXTENSION_DRAWIO = ".drawio";

/** El esquema del protocolo propio de draw.io (`drawio_origen.rs::ESQUEMA`). */
export const ESQUEMA_DRAWIO = "drawio";

type ConvertirRuta = (ruta: string, protocolo: string) => string;

/**
 * La raíz desde la que se sirve draw.io, terminada en `/`.
 *
 * La arma `convertFileSrc` de Tauri, que conoce la forma del esquema en cada
 * sistema (y si la app usa `https`). Fuera de Tauri (tests, bancos de prueba) se
 * usa la forma de Windows.
 */
export function baseDrawio(
  convertir: ConvertirRuta | undefined = (
    globalThis as { __TAURI_INTERNALS__?: { convertFileSrc?: ConvertirRuta } }
  ).__TAURI_INTERNALS__?.convertFileSrc,
): string {
  const url = convertir ? convertir("", ESQUEMA_DRAWIO) : `http://${ESQUEMA_DRAWIO}.localhost/`;
  return url.endsWith("/") ? url : `${url}/`;
}

/** El origen (`esquema://host`) de una raíz como la de `baseDrawio`. */
export function origenDeBase(base: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(base);
  return m ? m[1] : base.replace(/\/+$/, "");
}

/** ¿El origen es `http(s)`? Solo esos los entiende `postMessage` como destino. */
function esOrigenWeb(origen: string): boolean {
  return /^https?:\/\//i.test(origen);
}

/**
 * Con qué `targetOrigin` se le habla al iframe.
 *
 * En Windows es el origen exacto (`http://drawio.localhost`): si el iframe
 * mostrara otra cosa, el mensaje no se entrega. Con un esquema propio
 * (`drawio://localhost`, macOS/Linux) el navegador no lo admite como destino,
 * así que va `*`; lo que viaja es el XML del diagrama que se le está pasando.
 */
export function destinoDeMensajes(origen: string): string {
  return esOrigenWeb(origen) ? origen : "*";
}

/**
 * ¿Este mensaje es del iframe de draw.io que se espera?
 *
 * Tienen que coincidir la ventana (`source`: el `contentWindow` de ESE iframe,
 * no de otro editor) y el origen. Con un esquema propio (macOS/Linux) el motor
 * puede informar el origen como `"null"`; ahí se acepta eso también, y la
 * ventana sigue siendo la que decide.
 */
export function esMensajeDeDrawio(
  ev: { source: unknown; origin: string },
  ventana: unknown,
  origen: string,
): boolean {
  if (ventana == null || ev.source !== ventana) return false;
  if (ev.origin === origen) return true;
  return !esOrigenWeb(origen) && ev.origin === "null";
}

/**
 * Lo que se le permite al iframe del editor (`sandbox`). Sin `allow-top-navigation`:
 * no puede llevarse la ventana. `allow-same-origin` es para su propio
 * almacenamiento (preferencias, bibliotecas): al ser otro origen, no le da nada
 * de la app. Descargas, ventanas emergentes y diálogos, para exportar e imprimir
 * como antes.
 */
export const SANDBOX_EDITOR =
  "allow-scripts allow-same-origin allow-downloads allow-popups allow-modals";

/** El renderizador de los embeds no tiene interfaz: solo scripts. */
export const SANDBOX_RENDERIZADOR = "allow-scripts allow-same-origin";

/** Permisos del editor: el portapapeles (copiar y pegar formas) y pantalla completa. */
export const ALLOW_EDITOR = "clipboard-read; clipboard-write; fullscreen";

/**
 * Parámetros del modo embebido.
 *
 * > [!warning] `offline=1` **enciende** el service worker de draw.io
 * > Lo dice `js/diagramly/Editor.js`: `enableServiceWorker` es cierto cuando
 * > `offline=1`. Acá no aporta nada —la webapp ya se sirve del disco— y sí
 * > arriesga servir una versión vieja después de actualizar el paquete, así que
 * > se apaga con `pwa=0`. Se descubrió leyendo el código, no la documentación.
 *
 * `stealth=1` corta las salidas a la red (logging, sincronización remota):
 * es lo que sostiene el CA7.
 */
export const PARAMS_DRAWIO: Record<string, string> = {
  embed: "1",
  proto: "json",
  offline: "1",
  stealth: "1",
  pwa: "0",
  // Las bibliotecas de formas: es lo que distingue a draw.io de Excalidraw, así
  // que van encendidas.
  libraries: "1",
  // El host decide cuándo se guarda; el editor solo avisa. `modified` hace que
  // el editor reporte el estado «sin guardar» en vez de inventarse uno.
  modified: "unsavedChanges",
  // Sin «guardar y salir»: la pestaña de Mycelium ya es el contenedor, no hay
  // a dónde salir.
  saveAndExit: "0",
  // Sin el soporte del traductor del navegador (`FUN-M-58`). En Chrome/WebView2
  // draw.io lo enciende solo y, para notar si la página se traduce, intenta
  // colgar un `MutationObserver` de **su iframe** sobre el `<html>` del padre.
  // Cuando draw.io compartía origen con la app, ese registro sobrevivía a
  // quitar el iframe y retenía su reino JS entero (~9–17 MB de heap y ~70–80 MB
  // privados por editor soltado). Desde `DEF-168` el padre es de otro origen y
  // no lo alcanza, pero se sigue apagando: en una app de escritorio no hay
  // traductor del navegador que soportar.
  "browser-translate": "0",
};

/** Tema del editor: sigue al claro/oscuro de Mycelium (CA6). */
export type TemaDrawio = "claro" | "oscuro";

/**
 * URL del iframe del editor.
 *
 * `lang` va en la URL porque draw.io lee el idioma al arrancar; cambiarlo
 * después obliga a recargar.
 */
export function urlDelEditor(tema: TemaDrawio, lang = "es", base = baseDrawio()): string {
  const params = new URLSearchParams({
    ...PARAMS_DRAWIO,
    lang,
    // `ui=` es el esqueleto visual; `dark=` el modo. `kennedy` es el clásico, el
    // que menos desentona con la barra de Mycelium.
    ui: "kennedy",
    dark: tema === "oscuro" ? "1" : "0",
  });
  return `${base}index.html?${params.toString()}`;
}

/**
 * URL del iframe **oculto** que dibuja las vistas previas de los embeds.
 *
 * Es la misma webapp, pero sin cromado (`chrome=0`) y sin bibliotecas de formas:
 * no se edita nada ahí, solo se carga un XML y se pide el SVG. Un solo iframe
 * atiende a todos los embeds de la nota, uno por vez.
 */
export function urlDelRenderizador(base = baseDrawio()): string {
  const params = new URLSearchParams({
    ...PARAMS_DRAWIO,
    libraries: "0",
    spin: "0",
    chrome: "0",
    lang: "es",
  });
  return `${base}index.html?${params.toString()}`;
}

// ── El protocolo ──────────────────────────────────────────────────────────────

/** Lo que el editor le manda al host. */
export type EventoDrawio = {
  event: string;
  xml?: string;
  data?: string;
  modified?: boolean;
  message?: unknown;
};

/** Lo que el host le manda al editor. */
export type AccionDrawio = Record<string, unknown> & { action: string };

/**
 * Interpreta un mensaje del iframe. Devuelve `null` si no es del protocolo:
 * por la misma ventana pasan mensajes de otras cosas, y tragárselos todos sería
 * confundir un `postMessage` ajeno con un guardado.
 */
export function leerEvento(data: unknown): EventoDrawio | null {
  if (typeof data !== "string" || data.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const evento = (parsed as { event?: unknown }).event;
  if (typeof evento !== "string") return null;
  return parsed as EventoDrawio;
}

/** Le pide al editor que cargue este XML y que avise de cada cambio. */
export function accionCargar(xml: string): AccionDrawio {
  return { action: "load", xml, autosave: 1 };
}

/**
 * Le pide al editor que guarde.
 *
 * > [!note] No existe `action: 'save'`
 * > El guardado es una **acción del editor** (el botón, o Ctrl+S), no una acción
 * > del protocolo: se dispara con `invokeAction`. Está en
 * > `js/diagramly/Menus.js`, donde el modo embebido reemplaza `actions.get('save')`
 * > por el que hace `postMessage`. Se descubrió probándolo (`smoke-drawio.mjs`).
 */
export function accionGuardar(): AccionDrawio {
  return { action: "invokeAction", actionName: "save" };
}

/** Le pide al editor un SVG del diagrama, para la vista previa de los embeds. */
export function accionExportarSvg(): AccionDrawio {
  return { action: "export", format: "xmlsvg" };
}

// ── El archivo ────────────────────────────────────────────────────────────────

/**
 * Un `.drawio` recién creado.
 *
 * Es un `mxfile` con una página vacía, no una cadena vacía: así el editor abre
 * mostrando un lienzo en blanco en vez de tratarlo como archivo corrupto, y el
 * archivo se ve como cualquier diagrama en un draw.io de afuera.
 */
export function diagramaInicial(): string {
  return (
    '<mxfile host="Mycelium">\n' +
    '  <diagram name="Página 1">\n' +
    '    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" ' +
    'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" ' +
    'pageWidth="827" pageHeight="1169" math="0" shadow="0">\n' +
    "      <root>\n" +
    '        <mxCell id="0" />\n' +
    '        <mxCell id="1" parent="0" />\n' +
    "      </root>\n" +
    "    </mxGraphModel>\n" +
    "  </diagram>\n" +
    "</mxfile>\n"
  );
}

/**
 * ¿Esto parece un diagrama de draw.io?
 *
 * Sirve para no mandarle basura al editor: un archivo vacío o con otra cosa se
 * abre como diagrama nuevo en vez de dejar el iframe colgado.
 */
export function esDiagramaDrawio(contenido: string): boolean {
  const t = contenido.trim();
  if (t.length === 0) return false;
  return /^<(\?xml|mxfile|mxGraphModel)\b/.test(t) || /<mxfile\b/.test(t.slice(0, 2000));
}

/** El contenido que hay que cargarle al editor: el del archivo, o uno nuevo. */
export function contenidoParaCargar(contenido: string | null | undefined): string {
  return esDiagramaDrawio(contenido ?? "") ? (contenido as string) : diagramaInicial();
}

// ── Vida de un editor abierto ─────────────────────────────────────────────────
//
// Las reglas viven acá —y no en `lib/drawioInstancias.ts`, que las aplica—
// porque son decisiones puras y son justo las que, si se equivocan, destruyen
// un editor que el usuario estaba mirando. Acá se pueden probar sin navegador.

/** Prefijo de las claves que NO son pestañas (el panel lateral anclado). */
export const CLAVE_LATERAL = "sidebar:";

/** ¿Esta clave es la de una pestaña del área de trabajo? */
export function claveEsDePestana(clave: string): boolean {
  return !clave.startsWith(CLAVE_LATERAL);
}

/**
 * Qué editores hay que soltar porque su pestaña ya no existe.
 *
 * El panel lateral no está en el árbol de pestañas, así que sus claves nunca
 * son huérfanas: olvidarlo cerraría el diagrama anclado cada vez que se cierra
 * cualquier pestaña.
 */
export function clavesHuerfanas(
  vivas: Iterable<string>,
  pestanasAbiertas: ReadonlySet<string>,
): string[] {
  const fuera: string[] = [];
  for (const clave of vivas) {
    if (!claveEsDePestana(clave)) continue;
    if (!pestanasAbiertas.has(clave)) fuera.push(clave);
  }
  return fuera;
}

/**
 * Cuál se poda cuando hay más editores **ocultos** vivos que el tope.
 *
 * El tope cuenta solo los ocultos (`FUN-M-58`): los que se están viendo —una
 * pestaña por pane, más el panel lateral— no entran en la cuenta y nunca se
 * podan, porque soltar uno visible lo recargaría delante del usuario, que es
 * exactamente lo que este módulo existe para evitar.
 *
 * `vivas` viene en orden de uso, del más viejo al más reciente. Se elige el
 * oculto más viejo **sin cambios sin guardar** (`sucio`): uno sucio se queda
 * aunque se pase del tope, y se vuelve a podar cuando su guardado sale. Si no
 * hay a quién soltar se devuelve `null`.
 */
export function claveAPodar(
  vivas: readonly { clave: string; visible: boolean; sucio?: boolean }[],
  maxOcultos: number,
): string | null {
  const ocultos = vivas.filter((v) => !v.visible);
  if (ocultos.length <= maxOcultos) return null;
  return ocultos.find((v) => !v.sucio)?.clave ?? null;
}

// ── Caché de las vistas previas (`FUN-M-58`) ──────────────────────────────────

/**
 * Huella de un XML para la caché de SVG: largo + hash de 53 bits (cyrb53).
 *
 * No se usa el XML como clave porque un diagrama grande pesa cientos de KB y la
 * caché retendría dos copias (clave y SVG). Con 53 bits y el largo adelante,
 * una colisión entre dos diagramas del mismo vault es despreciable (~1 en 10¹⁵
 * por par); y el peor caso es ver la imagen de otro diagrama, no perder datos.
 */
export function huellaXml(xml: string): string {
  let h1 = 0xdeadbeef ^ xml.length;
  let h2 = 0x41c6ce57 ^ xml.length;
  for (let i = 0; i < xml.length; i++) {
    const c = xml.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const h = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `${xml.length}:${h.toString(36)}`;
}

/**
 * Caché LRU acotada por cantidad y por tamaño total (en caracteres).
 *
 * Un `Map` recuerda el orden de inserción: leer una entrada la vuelve a meter al
 * final, así que la primera es siempre la menos usada. Un valor más grande que
 * el tope de tamaño no se guarda (desalojaría todo lo demás por una sola).
 */
export class CacheLru {
  private readonly mapa = new Map<string, string>();
  private total = 0;
  private readonly maxEntradas: number;
  private readonly maxCaracteres: number;

  constructor(maxEntradas: number, maxCaracteres: number) {
    this.maxEntradas = maxEntradas;
    this.maxCaracteres = maxCaracteres;
  }

  get(clave: string): string | undefined {
    const v = this.mapa.get(clave);
    if (v === undefined) return undefined;
    this.mapa.delete(clave);
    this.mapa.set(clave, v);
    return v;
  }

  set(clave: string, valor: string): void {
    const previo = this.mapa.get(clave);
    if (previo !== undefined) {
      this.mapa.delete(clave);
      this.total -= previo.length;
    }
    if (valor.length > this.maxCaracteres) return;
    this.mapa.set(clave, valor);
    this.total += valor.length;
    while (this.mapa.size > this.maxEntradas || this.total > this.maxCaracteres) {
      const [vieja, v] = this.mapa.entries().next().value as [string, string];
      this.mapa.delete(vieja);
      this.total -= v.length;
    }
  }

  get tamano(): number {
    return this.mapa.size;
  }

  get caracteres(): number {
    return this.total;
  }

  vaciar(): void {
    this.mapa.clear();
    this.total = 0;
  }
}

/**
 * Expresión de un embed `![[diagrama.drawio]]` en una nota.
 *
 * Es una **fábrica** y no una constante porque los dos caminos que la usan
 * —`lib/markdown.ts` (vista de lectura) y `lib/editor/livePreview.ts` (vista en
 * vivo)— la recorren con `matchAll`, y compartir un `RegExp` con `/g` entre
 * llamadas es pedirle a `lastIndex` que sorprenda a alguien.
 *
 * > [!important] Una sola definición para las dos vistas
 * > La vista en vivo **no comparte código** con la de lectura. Cuando cada una
 * > tenía su propia copia de esta expresión, agregar el embed tocó solo la de
 * > lectura: el diagrama se veía al leer y desaparecía al editar. Tenerla acá
 * > es lo que hace imposible arreglar una y olvidar la otra.
 *
 * La extensión va **dentro** de la captura, al revés que en el de excalidraw:
 * el destino se resuelve por nombre de archivo, y `resolveWikilink` ya sabe
 * quitarle la extensión (`lib/extensionesDeTipo`).
 */
export function embedDrawioRe(): RegExp {
  return /!\[\[([^[\]]+\.drawio)\]\]/gi;
}

/**
 * Nombre de archivo al que apunta un embed `![[diagrama.drawio]]`.
 *
 * El destino puede venir con la extensión o sin ella, y con alias
 * (`[[diagrama.drawio|Arquitectura]]`). Devuelve `null` si no es un `.drawio`.
 */
export function destinoDeEmbed(destino: string): string | null {
  const sinAlias = destino.split("|")[0].trim();
  if (sinAlias.length === 0) return null;
  return /\.drawio$/i.test(sinAlias) ? sinAlias : null;
}
