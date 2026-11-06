/**
 * Los niveles del teclado sobre el DOM (`FUN-XL-04`, rediseño del
 * 2026-11-06; teclas de la segunda vuelta): Ctrl+flechas se mueve en el
 * nivel actual, Enter entra y Alt solo o Esc salen. Las decisiones están en `niveles.ts` (puras, con test); acá se buscan
 * los elementos y se mueve el foco.
 *
 * **Qué es cada nivel en el DOM**:
 * - **Sección**: un `[data-zona]`. Seleccionada = el foco en el contenedor
 *   mismo (se le da `tabindex=-1` mientras lo tiene) y la marca
 *   `data-zona-seleccionada` (la pone `useTecladoZonas`).
 * - **Elementos de una sección**: lo enfocable dentro de la zona que no está
 *   en una zona anidada (el panel de enlaces vive dentro del documento de su
 *   panel) ni dentro del documento; el documento (`[data-documento]`) cuenta
 *   como un elemento, y también la barra del documento
 *   (`[data-barra-documento]`: la barra de herramientas de una nota).
 * - **Dentro del documento**: lo enfocable del documento, salvo su barra.
 * - **Grupos** (2026-11-06): un `[data-grupo="<nombre>"]` dentro de una sección
 *   junta elementos que solo se alcanzan entrando a él. Su **asa** —lo que lo
 *   representa en el nivel de arriba— es su título (`[data-grupo-titulo]`, hijo directo, el
 *   encabezado plegable, con `aria-expanded`) o, si no tiene, el grupo mismo
 *   (que recibe el foco como una sección: `tabindex=-1` mientras lo tiene).
 *   `data-grupo-principal` marca el grupo al que se entra la primera vez. El
 *   grupo elegido (el foco en su asa) lleva `data-grupo-seleccionado`, y el que
 *   tiene el foco adentro, `data-grupo-activo` (los pone `useTecladoZonas`).
 */
import { useTabsStore } from "@/stores/tabsStore";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import {
  SEL_ENFOCABLE,
  claseDelActivo,
  documentoDe,
  documentoDelPanel,
  entrarAEscribir,
  hayModalAbierto,
  primerEnfocable,
  seleccionarDocumento,
  seleccionarSeccion,
  visible,
  zonaDe,
} from "./focoDom";
import {
  ctrlFlechaMueve,
  entradaDe,
  flechaEnGrupo,
  nivelDeMovimiento,
  vecinoPorCajas,
  type Caja,
  type Lugar,
} from "./niveles";
import type { Direccion } from "./navegacion";

const SEL_BARRA = "[data-barra-documento]";
const SEL_ZONA = "[data-zona]";
/** Donde el teclado es del componente: la consola y Excalidraw. */
export const SEL_TECLADO_PROPIO = ".xterm, .excalidraw, [data-esc-propio]";

/**
 * Lo que cuenta como un elemento de un nivel: lo enfocable por Tab y lo que
 * tiene un rol interactivo con `tabindex=-1` (el foco itinerante del árbol,
 * las pestañas, los días del calendario), más el documento de un panel.
 */
const SEL_ELEMENTO = [
  SEL_ENFOCABLE,
  "[role='treeitem']",
  "[role='tab']",
  "[role='gridcell'][tabindex]",
  "[role='option'][tabindex]",
  "[role='row'][tabindex]",
  "[role='separator'][tabindex]",
  "tbody tr[tabindex]",
  "[data-nodo][tabindex]",
  "[data-documento]",
].join(", ");

/** ¿Se le puede dar el foco? (Nativo, o con `tabindex`.) */
const enfocable = (el: HTMLElement) =>
  (el.tabIndex >= 0 || el.hasAttribute("tabindex")) &&
  !(el as HTMLButtonElement).disabled &&
  el.getAttribute("aria-disabled") !== "true";

// ── los grupos ───────────────────────────────────────────────────────────

const SEL_GRUPO = "[data-grupo]";
const SEL_TITULO_GRUPO = "[data-grupo-titulo]";

/**
 * El asa de un grupo: su título, o el grupo mismo si no tiene. El título es
 * un **hijo directo** del grupo: se mira por cada elemento al calcular un
 * nivel, y buscarlo en todo el árbol de Archivos (miles de filas) por cada
 * fila sería cuadrático.
 */
export function tituloDeGrupo(grupo: HTMLElement): HTMLElement {
  for (const t of grupo.children) {
    if (t instanceof HTMLElement && t.hasAttribute("data-grupo-titulo")) return t;
  }
  return grupo;
}

/** El grupo cuya asa es `el` (su título o él mismo), o `null`. */
export function grupoDeAsa(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (!el.matches(`${SEL_GRUPO}, ${SEL_TITULO_GRUPO}`)) return null;
  const g = el.closest<HTMLElement>(SEL_GRUPO);
  return g && tituloDeGrupo(g) === el && zonaDe(g) === zonaDe(el) ? g : null;
}

/**
 * El grupo **en el que está** `el` como elemento: el que hay que abrir para
 * alcanzarlo. El asa de un grupo no está en él sino en el nivel de arriba (en
 * el grupo que lo contiene, o en la sección). Solo cuenta un grupo de la misma
 * sección y del mismo documento: el panel de enlaces vive dentro del documento
 * pero es otra sección.
 */
export function grupoDe(el: Element | null): HTMLElement | null {
  if (!el) return null;
  let g = el.closest<HTMLElement>(SEL_GRUPO);
  if (g && tituloDeGrupo(g) === el) g = g.parentElement?.closest<HTMLElement>(SEL_GRUPO) ?? null;
  if (!g || zonaDe(g) !== zonaDe(el) || documentoDe(g) !== documentoDe(el)) return null;
  return g;
}

/** ¿El grupo está desplegado? `null` si no se pliega (su título no lleva `aria-expanded`). */
function expandido(grupo: HTMLElement): boolean | null {
  const v = tituloDeGrupo(grupo).getAttribute("aria-expanded");
  return v === null ? null : v === "true";
}

/**
 * Deja elegido un grupo: el foco en su asa. Un grupo sin título recibe el foco
 * él mismo, con `tabindex=-1` solo mientras lo tiene (como una sección).
 */
export function seleccionarGrupo(grupo: HTMLElement) {
  const asa = tituloDeGrupo(grupo);
  if (asa === grupo && !grupo.hasAttribute("tabindex")) {
    grupo.setAttribute("tabindex", "-1");
    grupo.addEventListener("blur", () => grupo.removeAttribute("tabindex"), { once: true });
  }
  asa.focus({ preventScroll: true });
  asa.scrollIntoView({ block: "nearest" });
}

// ── dónde está el foco ───────────────────────────────────────────────────

export type Ubicacion = {
  lugar: Lugar;
  zona: HTMLElement | null;
  doc: HTMLElement | null;
  /**
   * El grupo en el que está lo enfocado (`grupoDe`): el contenedor de su
   * nivel. Con el foco en el asa de un grupo, el que lo contiene (o `null`).
   */
  grupo: HTMLElement | null;
};

/** El lugar del foco visto como niveles (`niveles.ts`). */
export function ubicar(foco: Element | null): Ubicacion {
  if (!foco || foco === document.body) return { lugar: "fuera", zona: null, doc: null, grupo: null };
  const zona = zonaDe(foco);
  if (!zona) return { lugar: "fuera", zona: null, doc: null, grupo: null };
  if (foco === zona) return { lugar: "seccion", zona, doc: null, grupo: null };
  const grupo = grupoDe(foco);
  const doc = documentoDe(foco);
  const docDeZona = doc && zona.contains(doc) ? doc : null;
  if (grupoDeAsa(foco)) return { lugar: "grupo", zona, doc: docDeZona, grupo };
  if (docDeZona) {
    if (foco === docDeZona) return { lugar: "documento", zona, doc: docDeZona, grupo };
    if (foco.closest(SEL_BARRA)) return { lugar: "elemento", zona, doc: docDeZona, grupo };
    return { lugar: "dentro", zona, doc: docDeZona, grupo };
  }
  const panel = foco.closest("[role='tabpanel'][aria-labelledby]");
  if (panel && panel !== foco && zona.contains(panel)) return { lugar: "contenido-de-pestana", zona, doc: null, grupo };
  return { lugar: "elemento", zona, doc: null, grupo };
}

/**
 * Los elementos de una sección, de un grupo o de dentro de un documento. Un
 * grupo cuenta como **un** elemento (su asa) en el nivel que lo contiene; lo
 * de adentro, solo en el suyo. Un grupo sin título y sin nada a la vista, no.
 */
export function elementosDe(contenedor: HTMLElement): HTMLElement[] {
  const esDoc = contenedor.matches("[data-documento]");
  const esGrupo = !esDoc && contenedor.matches(SEL_GRUPO) && !contenedor.matches(SEL_ZONA);
  const zona = esDoc || esGrupo ? zonaDe(contenedor) : contenedor;
  const nivel = esGrupo ? contenedor : null;
  return [...contenedor.querySelectorAll<HTMLElement>(`${SEL_ELEMENTO}, ${SEL_GRUPO}`)].filter((el) => {
    if (zonaDe(el) !== zona || !visible(el)) return false;
    const esContenedorDeGrupo = el.matches(SEL_GRUPO);
    const grupoSinTitulo = esContenedorDeGrupo && tituloDeGrupo(el) === el;
    // Un grupo con título está representado por su título (un botón).
    if (esContenedorDeGrupo && !grupoSinTitulo) return false;
    if (!grupoSinTitulo && !enfocable(el)) return false;
    if (grupoDe(el) !== nivel) return false;
    if (grupoSinTitulo && elementosDe(el).length === 0) return false;
    if (esDoc) return !el.closest(SEL_BARRA);
    const d = documentoDe(el);
    return !(d && contenedor.contains(d) && d !== el && !el.closest(SEL_BARRA));
  });
}

/**
 * La caja de un elemento para medir distancias. La del documento empieza
 * debajo de su barra (que está adentro, arriba): sin esto, desde el documento
 * Ctrl+↑ no veía la barra «arriba» y desde la barra Ctrl+↓ no veía el documento.
 */
function cajaDe(el: HTMLElement): Caja {
  const r = el.getBoundingClientRect();
  const caja = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  if (el.matches("[data-documento]")) {
    for (const b of el.querySelectorAll<HTMLElement>(SEL_BARRA)) {
      if (zonaDe(b) !== zonaDe(el) || !visible(b)) continue;
      caja.top = Math.max(caja.top, Math.min(b.getBoundingClientRect().bottom, caja.bottom - 1));
    }
  }
  return caja;
}

// ── seleccionar una sección ──────────────────────────────────────────────

export { seleccionarSeccion };

/** Las secciones que se ven y tienen algo, en el orden de la ventana. */
export function seccionesVisibles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(SEL_ZONA)].filter(
    (z) => visible(z) && elementosDe(z).length > 0,
  );
}

// ── el último elemento de cada sección y de cada grupo ───────────────────

/** El último elemento usado de cada nivel: una sección o un grupo. */
const ultimoDeNivel = new WeakMap<HTMLElement, HTMLElement>();

/**
 * Lo llama `useTecladoZonas` en cada `focusin`: Enter sobre la sección (o
 * sobre un grupo) vuelve ahí. Con el foco dentro de un grupo, cada grupo de la
 * cadena recuerda el elemento por el que se llega, y la sección el asa del
 * grupo de más afuera: entrar al explorador deja elegido el último grupo usado.
 */
export function recordarElemento(foco: HTMLElement) {
  const { lugar, zona, doc } = ubicar(foco);
  if (!zona) return;
  let el: HTMLElement;
  if (lugar === "elemento" || lugar === "documento" || lugar === "grupo") el = foco;
  else if (lugar === "dentro" && doc) el = doc;
  else return;
  for (let g = grupoDe(el); g; g = grupoDe(el)) {
    ultimoDeNivel.set(g, el);
    el = tituloDeGrupo(g);
  }
  ultimoDeNivel.set(zona, el);
}

/** Lo que se prefiere al entrar a un grupo sin memoria: la fila elegida del árbol, la abierta. */
const SEL_PREFERIDO_EN_GRUPO =
  "[role='treeitem'][tabindex='0'], [aria-current='page'], [aria-selected='true'][tabindex]";

/** El elemento con el que se entra a un grupo (Enter sobre su título). */
function elementoDeEntradaDeGrupo(grupo: HTMLElement): HTMLElement | null {
  const elementos = elementosDe(grupo);
  const ultimo = ultimoDeNivel.get(grupo);
  if (ultimo && ultimo.isConnected && elementos.includes(ultimo)) return ultimo;
  return elementos.find((el) => el.matches(SEL_PREFERIDO_EN_GRUPO)) ?? elementos[0] ?? null;
}

/** El elemento con el que se entra a una sección (Enter sobre ella). */
function elementoDeEntrada(zona: HTMLElement): HTMLElement | null {
  const elementos = elementosDe(zona);
  const ultimo = ultimoDeNivel.get(zona);
  if (ultimo && ultimo.isConnected && elementos.includes(ultimo)) return ultimo;
  const preferido = (selector: string) => elementos.find((el) => el.matches(selector)) ?? null;
  // Sin memoria, el grupo principal (Archivos, en el explorador): es lo que se
  // usa casi siempre, y antes de los grupos se entraba directo a su árbol.
  const principal = elementos.find((el) => grupoDeAsa(el)?.hasAttribute("data-grupo-principal"));
  if (principal) return principal;
  switch (zona.dataset.zona) {
    case "panel":
      return preferido("[data-documento]") ?? elementos[0] ?? null;
    case "rail":
      return preferido("button[aria-pressed='true']") ?? elementos[0] ?? null;
    case "izquierda":
      return preferido("[role='treeitem'][tabindex='0'], [aria-selected='true'][tabindex]") ?? elementos[0] ?? null;
    case "lateral":
      return preferido("[role='tab'][aria-selected='true']") ?? elementos[0] ?? null;
    default:
      return elementos[0] ?? null;
  }
}

function enfocarElemento(el: HTMLElement) {
  if (el.matches("[data-documento]")) seleccionarDocumento(el);
  else if (el.matches(SEL_GRUPO) && tituloDeGrupo(el) === el) seleccionarGrupo(el);
  else el.focus();
}

// ── Ctrl+flechas ─────────────────────────────────────────────────────────

/** Donde se escribe y Ctrl+flechas es del componente: el editor, la consola, Excalidraw. */
const SEL_ESCRIBIENDO = `.cm-editor, ${SEL_TECLADO_PROPIO}`;

/** Los `input` donde se escribe una línea (Ctrl+←/→ salta de palabra). */
const INPUT_DE_TEXTO = new Set(["text", "search", "url", "email", "password", "tel", "number"]);

/** ¿Es un campo de texto? (`input` de texto, `textarea`, `contenteditable`.) */
function esCampoDeTexto(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return INPUT_DE_TEXTO.has(el.type);
  return el.isContentEditable;
}

/**
 * ¿Ctrl+flecha en esta dirección es de los niveles (`ctrlFlechaMueve`)? Si no,
 * el despachador no la toca: el editor salta de palabra, un campo mueve el
 * cursor.
 */
export function ctrlFlechaEsDelNivel(dir: Direccion): boolean {
  const foco = document.activeElement as HTMLElement | null;
  return ctrlFlechaMueve(
    { escribiendo: !!foco?.closest(SEL_ESCRIBIENDO), enCampoDeTexto: !!foco && esCampoDeTexto(foco) },
    dir,
  );
}

/**
 * Ctrl+flecha: al vecino en esa dirección dentro del nivel actual. En el nivel
 * de secciones, a la sección; en una sección, entre sus elementos; dentro de
 * un documento, entre lo suyo. Nunca sale del nivel: sin nada de ese lado, no
 * hace nada. Sin foco (`body`), selecciona el panel activo.
 */
export function moverEnNivel(dir: Direccion) {
  if (hayModalAbierto()) return;
  const foco = document.activeElement as HTMLElement | null;
  if (foco?.closest(SEL_TECLADO_PROPIO)) return;
  const { lugar, zona, doc, grupo } = ubicar(foco);
  if (lugar === "fuera") {
    const panel = !foco || foco === document.body ? seccionDelPanelActivo() : null;
    if (panel) seleccionarSeccion(panel);
    return;
  }
  if (lugar === "seccion" && zona) {
    const otras = seccionesVisibles().filter((z) => z !== zona).map((z) => ({ el: z, caja: cajaDe(z) }));
    const destino = vecinoPorCajas(cajaDe(zona), otras, dir);
    if (destino) seleccionarSeccion(destino.el);
    return;
  }
  // Desde la barra de la nota (formato, modo de vista), Ctrl+↓ va a escribir:
  // la barra está dibujada dentro de la caja del documento, así que por
  // geometría el documento no queda «abajo» y no había forma de llegar sin
  // elegir una opción de la barra (pedido del usuario, 2026-11-06).
  if (dir === "abajo" && doc && foco?.closest(SEL_BARRA)) {
    entrarAEscribir(doc);
    return;
  }
  // Dentro de un grupo, solo entre sus elementos: no salta a otro grupo. Desde
  // el título de un grupo, entre los grupos (y lo suelto) del nivel de arriba.
  const nivel = nivelDeMovimiento(lugar, grupo !== null);
  const contenedor = nivel === "grupo" ? grupo : nivel === "documento" ? doc : zona;
  if (!contenedor || !foco) return;
  const candidatos = elementosDe(contenedor)
    .filter((el) => el !== foco && !el.contains(foco))
    .map((el) => ({ el, caja: cajaDe(el) }));
  // Lo enfocado puede ser algo de adentro de un elemento (el campo de
  // renombrar de una fila): se mide desde el elemento que lo contiene.
  const destino = vecinoPorCajas(cajaDe(foco), candidatos, dir);
  if (destino) enfocarElemento(destino.el);
}

function seccionDelPanelActivo(): HTMLElement | null {
  return documentoDelPanel(useTabsStore.getState().activePaneId)?.closest<HTMLElement>(SEL_ZONA) ?? null;
}

// ── Enter ───────────────────────────────────────────────────────────

/** ¿Es una pestaña (de un panel, del panel de enlaces, de las vistas de una tabla)? */
const esPestana = (el: HTMLElement) => el.getAttribute("role") === "tab";

/**
 * Enter: entra a lo elegido. Devuelve si hizo algo (para no quitarle la
 * tecla a nadie cuando no).
 */
export function entrarEnNivel(): boolean {
  if (hayModalAbierto()) return false;
  const foco = document.activeElement as HTMLElement | null;
  if (!foco || foco.closest(SEL_TECLADO_PROPIO)) return false;
  const { lugar, zona, doc } = ubicar(foco);
  switch (entradaDe(lugar, esPestana(foco))) {
    case "al-grupo": {
      const g = grupoDeAsa(foco);
      if (g) entrarAlGrupo(g);
      // Siempre se usa la tecla: si no, el título (un botón) se plegaría con ella.
      return true;
    }
    case "a-la-seccion": {
      const destino = zona ? elementoDeEntrada(zona) : null;
      if (!destino) return false;
      enfocarElemento(destino);
      return true;
    }
    case "al-documento":
      return doc ? entrarAEscribir(doc) : false;
    case "pestana":
      activarPestana(foco);
      return true;
    case "activar":
      activar(foco);
      return true;
    default:
      return false;
  }
}

/**
 * Entra a un grupo: si está plegado, primero lo despliega (un clic en su
 * título) y espera a que React dibuje su contenido; después, al último
 * elemento usado ahí o al preferido. Un grupo vacío deja el foco en su título.
 */
function entrarAlGrupo(grupo: HTMLElement) {
  const plegado = expandido(grupo) === false;
  if (plegado) tituloDeGrupo(grupo).click();
  const intentar = (intentos: number) => {
    if (!grupo.isConnected) return;
    const destino = elementoDeEntradaDeGrupo(grupo);
    if (destino) enfocarElemento(destino);
    else if (intentos > 0) requestAnimationFrame(() => intentar(intentos - 1));
  };
  if (plegado) requestAnimationFrame(() => intentar(20));
  else intentar(0);
}

/**
 * ← y → solas sobre el título de un grupo (`flechaEnGrupo`): ← lo pliega, →
 * lo despliega o, si ya está desplegado, entra. Devuelve si hizo algo, para
 * quedarse con la tecla.
 */
export function flechaSobreGrupo(dir: "izquierda" | "derecha"): boolean {
  if (hayModalAbierto()) return false;
  const g = grupoDeAsa(document.activeElement);
  if (!g) return false;
  switch (flechaEnGrupo(dir, expandido(g))) {
    case "plegar":
    case "desplegar":
      tituloDeGrupo(g).click();
      return true;
    case "entrar":
      entrarAlGrupo(g);
      return true;
    default:
      return false;
  }
}

/**
 * Una pestaña: se activa y se entra a lo que muestra. La de un panel (barra de
 * pestañas) entra a su documento, como Enter sobre el documento seleccionado;
 * la de una lista de pestañas con su `tabpanel` (el panel de enlaces, las
 * vistas de una tabla), a lo primero de su contenido.
 */
function activarPestana(tab: HTMLElement) {
  tab.click();
  if (tab.dataset.tabId) {
    entrarAlDocumentoActivo();
    return;
  }
  requestAnimationFrame(() => {
    const panel = document.querySelector<HTMLElement>(`[role='tabpanel'][aria-labelledby="${CSS.escape(tab.id)}"]`);
    const destino = panel ? primerEnfocable(panel) : null;
    destino?.focus();
  });
}

/**
 * Entra al documento del panel activo cuando termine de montarse (tras
 * activar una pestaña): en una nota espera al editor —si no, entraría a la
 * barra—; en lo demás, lo que haga Enter sobre el documento seleccionado.
 */
export function entrarAlDocumentoActivo(intentos = 30) {
  requestAnimationFrame(() => {
    const doc = documentoDelPanel(useTabsStore.getState().activePaneId);
    const listo =
      doc &&
      (claseDelActivo() !== "editor" || doc.querySelector(".cm-content") !== null) &&
      doc.querySelector(SEL_ELEMENTO) !== null;
    if (!listo) {
      if (intentos > 0) entrarAlDocumentoActivo(intentos - 1);
      else if (doc) seleccionarDocumento(doc);
      return;
    }
    if (!entrarAEscribir(doc)) seleccionarDocumento(doc);
  });
}

/**
 * Ejecuta un elemento como un clic o un Enter: los botones, enlaces y casillas
 * con `click()`; lo demás (una fila del árbol, una fila de tabla, el lienzo del
 * grafo, un campo) recibe un Enter, que es lo que ya entendían; si nadie lo
 * atiende, un clic.
 */
function activar(el: HTMLElement) {
  if (el.matches("button, a[href], summary, input[type='checkbox'], input[type='radio'], input[type='button'], input[type='submit']")) {
    el.click();
    return;
  }
  if (el instanceof HTMLSelectElement) {
    try {
      el.showPicker();
    } catch {
      /* Sin `showPicker` (o sin gesto), Alt+↓ y Espacio lo abren igual. */
    }
    return;
  }
  const enter = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
  const atendido = !el.dispatchEvent(enter);
  const esCampo = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable;
  if (!atendido && !esCampo) el.click();
}

// ── los accesos por el teclado numérico ──────────────────────────────────

export type SeccionDirecta = "rail" | "izquierda" | "pestanas" | "enlaces" | "estado";

/**
 * Ctrl+Num1…Num5: deja seleccionada esa sección; si está oculta (el panel
 * izquierdo, el de enlaces de una nota), la muestra y espera a que se monte.
 */
export function irASeccion(cual: SeccionDirecta, intentos = 30, yaAbierta = false) {
  const buscar = (): HTMLElement | null => {
    switch (cual) {
      case "pestanas":
        return seccionDelPanelActivo();
      case "enlaces": {
        const doc = documentoDelPanel(useTabsStore.getState().activePaneId);
        return doc?.querySelector<HTMLElement>("[data-zona='lateral']") ?? null;
      }
      default:
        return document.querySelector<HTMLElement>(`[data-zona='${cual}']`);
    }
  };
  const zona = buscar();
  if (zona && visible(zona) && elementosDe(zona).length > 0) {
    seleccionarSeccion(zona);
    return;
  }
  if (!yaAbierta) {
    if (cual === "izquierda" && usePanelLayoutStore.getState().activeSection === null) {
      usePanelLayoutStore.getState().toggleLeft();
    } else if (cual === "enlaces" && !zona && claseDelActivo() === "editor") {
      const { activePaneId, togglePanelMeta } = useTabsStore.getState();
      togglePanelMeta(activePaneId);
    } else if (!zona) {
      return;
    }
  }
  if (intentos > 0) requestAnimationFrame(() => irASeccion(cual, intentos - 1, true));
  else if (zona && visible(zona)) seleccionarSeccion(zona);
}
