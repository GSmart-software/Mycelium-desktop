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
 * La webapp se sirve desde `public/drawio/`, o sea desde el **mismo origen** que
 * la app: por eso no hay que abrir la CSP ni sumar rutas al protocolo de assets
 * de Tauri, y el `postMessage` es directo. La baja `npm run preparar-drawio`.
 *
 * > OJO: este módulo es **puro y sin imports** a propósito — así
 * > `scripts/test-drawio.mjs` puede transpilarlo e importarlo sin build, igual
 * > que `lib/canvas.ts`, `lib/frontmatter.ts`, `lib/bases.ts` y `lib/enlaces.ts`.
 */

export const EXTENSION_DRAWIO = ".drawio";

/** Dónde vive la webapp empaquetada, dentro del export estático. */
export const BASE_DRAWIO = "/drawio/index.html";

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
};

/** Tema del editor: sigue al claro/oscuro de Mycelium (CA6). */
export type TemaDrawio = "claro" | "oscuro";

/**
 * URL del iframe del editor.
 *
 * `lang` va en la URL porque draw.io lee el idioma al arrancar; cambiarlo
 * después obliga a recargar.
 */
export function urlDelEditor(tema: TemaDrawio, lang = "es"): string {
  const params = new URLSearchParams({
    ...PARAMS_DRAWIO,
    lang,
    // `ui=` es el esqueleto visual; `dark=` el modo. `kennedy` es el clásico, el
    // que menos desentona con la barra de Mycelium.
    ui: "kennedy",
    dark: tema === "oscuro" ? "1" : "0",
  });
  return `${BASE_DRAWIO}?${params.toString()}`;
}

/**
 * URL del iframe **oculto** que dibuja las vistas previas de los embeds.
 *
 * Es la misma webapp, pero sin cromado (`chrome=0`) y sin bibliotecas de formas:
 * no se edita nada ahí, solo se carga un XML y se pide el SVG. Un solo iframe
 * atiende a todos los embeds de la nota, uno por vez.
 */
export function urlDelRenderizador(): string {
  const params = new URLSearchParams({
    ...PARAMS_DRAWIO,
    libraries: "0",
    spin: "0",
    chrome: "0",
    lang: "es",
  });
  return `${BASE_DRAWIO}?${params.toString()}`;
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
 * Cuál se poda cuando hay más editores vivos que el tope.
 *
 * `vivas` viene en orden de uso, del más viejo al más reciente. Se elige el más
 * viejo que **no se esté viendo**: podar uno visible lo recargaría delante del
 * usuario, que es exactamente lo que este módulo existe para evitar. Si todos
 * están visibles se devuelve `null` y se pasa del tope, a propósito.
 */
export function claveAPodar(
  vivas: readonly { clave: string; visible: boolean }[],
  max: number,
): string | null {
  if (vivas.length <= max) return null;
  return vivas.find((v) => !v.visible)?.clave ?? null;
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
