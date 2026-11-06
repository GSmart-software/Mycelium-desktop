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
import { ctrlFlechaMueve, entradaDe, vecinoPorCajas, type Caja, type Lugar } from "./niveles";
import type { Direccion } from "./navegacion";

const SEL_BARRA = "[data-barra-documento]";
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

// ── dónde está el foco ───────────────────────────────────────────────────

export type Ubicacion = { lugar: Lugar; zona: HTMLElement | null; doc: HTMLElement | null };

/** El lugar del foco visto como niveles (`niveles.ts`). */
export function ubicar(foco: Element | null): Ubicacion {
  if (!foco || foco === document.body) return { lugar: "fuera", zona: null, doc: null };
  const zona = zonaDe(foco);
  if (!zona) return { lugar: "fuera", zona: null, doc: null };
  if (foco === zona) return { lugar: "seccion", zona, doc: null };
  const doc = documentoDe(foco);
  if (doc && zona.contains(doc)) {
    if (foco === doc) return { lugar: "documento", zona, doc };
    if (foco.closest(SEL_BARRA)) return { lugar: "elemento", zona, doc };
    return { lugar: "dentro", zona, doc };
  }
  const panel = foco.closest("[role='tabpanel'][aria-labelledby]");
  if (panel && panel !== foco && zona.contains(panel)) return { lugar: "contenido-de-pestana", zona, doc: null };
  return { lugar: "elemento", zona, doc: null };
}

/** Los elementos de una sección, o los de dentro de un documento. */
export function elementosDe(contenedor: HTMLElement): HTMLElement[] {
  const esDoc = contenedor.matches("[data-documento]");
  const zona = esDoc ? zonaDe(contenedor) : contenedor;
  return [...contenedor.querySelectorAll<HTMLElement>(SEL_ELEMENTO)].filter((el) => {
    if (zonaDe(el) !== zona || !visible(el) || !enfocable(el)) return false;
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

const SEL_ZONA = "[data-zona]";

export { seleccionarSeccion };

/** Las secciones que se ven y tienen algo, en el orden de la ventana. */
export function seccionesVisibles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(SEL_ZONA)].filter(
    (z) => visible(z) && elementosDe(z).length > 0,
  );
}

// ── el último elemento de cada sección ───────────────────────────────────

const ultimoDeSeccion = new WeakMap<HTMLElement, HTMLElement>();

/** Lo llama `useTecladoZonas` en cada `focusin`: Enter sobre la sección vuelve ahí. */
export function recordarElemento(foco: HTMLElement) {
  const { lugar, zona, doc } = ubicar(foco);
  if (!zona) return;
  if (lugar === "elemento" || lugar === "documento") ultimoDeSeccion.set(zona, foco);
  else if (lugar === "dentro" && doc) ultimoDeSeccion.set(zona, doc);
}

/** El elemento con el que se entra a una sección (Enter sobre ella). */
function elementoDeEntrada(zona: HTMLElement): HTMLElement | null {
  const elementos = elementosDe(zona);
  const ultimo = ultimoDeSeccion.get(zona);
  if (ultimo && ultimo.isConnected && elementos.includes(ultimo)) return ultimo;
  const preferido = (selector: string) => elementos.find((el) => el.matches(selector)) ?? null;
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
  const { lugar, zona, doc } = ubicar(foco);
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
  const contenedor = lugar === "dentro" ? doc : zona;
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
