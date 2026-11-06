/**
 * Zonas y modos del teclado sobre el DOM (`FUN-XL-04`, Parte 2): recorrer las
 * zonas con F6, seleccionar un documento (modo navegar), entrar a escribir con
 * Enter y dejar el foco en un lugar sensato después de cambiar de pestaña o de
 * panel. Las decisiones están en `zonas.ts` (puras, con test); acá solo se
 * buscan los elementos y se mueve el foco.
 *
 * **Dónde vive el estado.** En el DOM, no en un store: la zona y el modo se
 * deducen de `document.activeElement`. Los atributos que los muestran
 * (`data-zona-activa`, `data-modo`) los pone `useTecladoZonas` en cada
 * `focusin`. Lo único que se guarda aparte es el último elemento enfocado
 * dentro de cada documento, para que Enter vuelva ahí.
 *
 * Marcas del DOM:
 * - `data-zona="rail|izquierda|panel|lateral|estado"`: una zona.
 * - `data-documento`: el cuerpo de un panel (`tabIndex=-1`). Enfocado él
 *   mismo = seleccionado (navegar); con el foco adentro = escribiendo.
 */
import { tipoDePestana } from "@/lib/pestanas";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { claseDeDocumento, modoTrasCambio, panelContiguo, zonaVecina, type Zona } from "./zonas";

const SEL_ZONA = "[data-zona]";
const SEL_DOCUMENTO = "[data-documento]";
const SEL_ENFOCABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** ¿Se ve? (Ni oculto, ni de ancho cero, ni dentro de algo `aria-hidden` o `inert`.) */
function visible(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  return !el.closest("[aria-hidden='true'], [inert]");
}

function primerEnfocable(raiz: HTMLElement, selector = SEL_ENFOCABLE): HTMLElement | null {
  for (const el of raiz.querySelectorAll<HTMLElement>(selector)) if (visible(el)) return el;
  return null;
}

export const zonaDe = (el: Element | null): HTMLElement | null =>
  (el?.closest(SEL_ZONA) as HTMLElement | null) ?? null;

export const documentoDe = (el: Element | null): HTMLElement | null =>
  (el?.closest(SEL_DOCUMENTO) as HTMLElement | null) ?? null;

export const tipoZona = (zona: HTMLElement) => zona.dataset.zona as Zona;

/** El documento (cuerpo) de un panel de la división. */
export const documentoDelPanel = (paneId: string) =>
  document.querySelector<HTMLElement>(`${SEL_DOCUMENTO}[data-pane-id="${CSS.escape(paneId)}"]`);

/** Las zonas que se ven y se pueden enfocar, en el orden de la ventana. */
export function zonasVisibles(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(SEL_ZONA)].filter(
    (z) => visible(z) && (z.querySelector(SEL_DOCUMENTO) !== null || primerEnfocable(z) !== null),
  );
}

// ── el último foco de cada documento ─────────────────────────────────────

const ultimoFoco = new WeakMap<HTMLElement, HTMLElement>();

/** Lo llama `useTecladoZonas` en cada `focusin`. */
export function recordarFoco(el: HTMLElement) {
  const doc = documentoDe(el);
  if (doc && doc !== el) ultimoFoco.set(doc, el);
}

// ── los dos modos ─────────────────────────────────────────────────────────

/** Selecciona el documento: el foco en él mismo, modo navegar. */
export function seleccionarDocumento(doc: HTMLElement) {
  doc.focus({ preventScroll: true });
}

/**
 * Entra a escribir en un documento seleccionado (Enter): vuelve al último
 * elemento que tuvo el foco ahí —en CodeMirror, el editor restaura solo su
 * cursor y su selección— y, si no hay, a lo primero que tenga sentido según
 * lo que muestre: la consola, el editor, el primer enlace o casilla de la
 * lectura, la primera fila de una tabla, el lienzo de Excalidraw, o lo
 * primero enfocable.
 */
export function entrarAEscribir(doc: HTMLElement): boolean {
  const ultimo = ultimoFoco.get(doc);
  const candidatos: (HTMLElement | null)[] = [
    ultimo && ultimo.isConnected && doc.contains(ultimo) && visible(ultimo) && !ultimo.classList.contains("mic-preview")
      ? ultimo
      : null,
    doc.querySelector<HTMLElement>(".xterm-helper-textarea"),
    visibleONull(doc.querySelector<HTMLElement>(".cm-content")),
    destinoEnLectura(doc),
    primerEnfocable(doc, "tbody tr[tabindex]"),
    // Excalidraw atiende el teclado en su contenedor (`tabIndex=0`): su lienzo.
    primerEnfocable(doc, ".excalidraw-container"),
    primerEnfocable(doc),
  ];
  const destino = candidatos.find((c): c is HTMLElement => c !== null);
  if (!destino) return false;
  destino.focus();
  return document.activeElement === destino || destino.contains(document.activeElement);
}

const visibleONull = (el: HTMLElement | null) => (el && visible(el) ? el : null);

/** En la vista de lectura: el primer enlace o casilla; si no hay, la lectura entera. */
function destinoEnLectura(doc: HTMLElement): HTMLElement | null {
  const lectura = visibleONull(doc.querySelector<HTMLElement>(".mic-preview"));
  if (!lectura) return null;
  const primero = primerEnfocable(lectura, "a[href], input[type='checkbox']");
  if (primero) return primero;
  if (!lectura.hasAttribute("tabindex")) lectura.tabIndex = -1;
  return lectura;
}

// ── las zonas (F6) ────────────────────────────────────────────────────────

/** Pone el foco en lo que corresponde de una zona al entrar con F6. */
export function enfocarZona(zona: HTMLElement) {
  if (tipoZona(zona) === "panel") {
    const doc = zona.querySelector<HTMLElement>(SEL_DOCUMENTO);
    if (doc) {
      const paneId = doc.dataset.paneId;
      if (paneId) useTabsStore.getState().setActivePane(paneId);
      seleccionarDocumento(doc);
      return;
    }
  }
  const preferido =
    tipoZona(zona) === "rail"
      ? primerEnfocable(zona, "button[aria-pressed='true']")
      : tipoZona(zona) === "izquierda"
        ? primerEnfocable(zona, "[role='treeitem'][tabindex='0'], [aria-selected='true'][tabindex]")
        : null;
  (preferido ?? primerEnfocable(zona))?.focus();
}

/** ¿El foco está en el panel izquierdo? */
export const focoEnElPanelIzquierdo = () => !!document.activeElement?.closest("[data-zona='izquierda']");

/**
 * Pone el foco en la sección del panel izquierdo (`FUN-XL-04`, Parte 4), tras
 * abrirla con un comando: la fila del árbol en el explorador, el campo si
 * `preferirCampo` (la búsqueda), y si no, lo primero que se pueda enfocar.
 * Espera a que React monte la sección, unos cuadros como máximo.
 */
export function enfocarSeccionIzquierda(preferirCampo = false, intentos = 30) {
  requestAnimationFrame(() => {
    const region = document.querySelector<HTMLElement>("[data-zona='izquierda'] [data-seccion-izquierda]");
    const destino =
      region && visible(region)
        ? (primerEnfocable(region, "[role='treeitem'][tabindex='0']") ??
          (preferirCampo ? primerEnfocable(region, "input:not([disabled]):not([type='hidden'])") : null) ??
          primerEnfocable(region))
        : null;
    if (destino) destino.focus();
    else if (intentos > 0) enfocarSeccionIzquierda(preferirCampo, intentos - 1);
    else if (region && visible(region)) {
      // Una sección sin nada enfocable (la papelera vacía, visto en la prueba
      // en vivo): el foco va a la sección misma, para que quede en su zona y
      // F6 siga desde ahí, en vez de volver a donde estaba.
      if (!region.hasAttribute("tabindex")) region.setAttribute("tabindex", "-1");
      region.focus();
    }
  });
}

/** F6 (`delta` 1) / Shift+F6 (-1): a la zona siguiente o anterior. */
export function irAZona(delta: 1 | -1) {
  const zonas = zonasVisibles();
  const actual = zonaDe(document.activeElement);
  const i = zonaVecina(zonas.length, actual ? zonas.indexOf(actual) : -1, delta);
  if (i >= 0) enfocarZona(zonas[i]);
}

/**
 * F6 / Shift+F6 desde un marco de otro origen (draw.io): las teclas no llegan a
 * la app, así que el marco avisa por mensaje (`drawio/guarda.js`). Se sale
 * como si F6 se hubiera pulsado sobre el documento del panel `paneId`: queda
 * seleccionado y el foco pasa a la zona vecina.
 */
export function salirDeMarco(paneId: string | null, delta: 1 | -1) {
  if (document.querySelector('[aria-modal="true"]')) return;
  if (paneId) useTabsStore.getState().setActivePane(paneId);
  const doc = documentoDelPanel(paneId ?? useTabsStore.getState().activePaneId);
  if (doc) seleccionarDocumento(doc);
  irAZona(delta);
}

// ── el foco tras cambiar de pestaña o de panel ───────────────────────────

/** Mientras se acomoda el foco, una consola que se monta no lo toma sola. */
let sinAutoFocoHasta = 0;
export const autoFocoPermitido = () => Date.now() > sinAutoFocoHasta;

/** ¿El foco está escribiendo en un editor de notas? Se mira ANTES del cambio. */
export const escribiendoEnEditor = () => !!document.activeElement?.closest(`${SEL_DOCUMENTO} .cm-editor`);

function claseDelActivo() {
  const id = useTabsStore.getState().activeNotaId();
  if (!id) return "otro" as const;
  const tipoPestana = tipoDePestana(id);
  const tipoNota =
    tipoPestana === "nota" ? (useVaultStore.getState().notas.find((n) => n.id === id)?.tipo ?? null) : null;
  return claseDeDocumento(tipoPestana, tipoNota);
}

/**
 * Deja el foco en el documento del panel activo después de Ctrl+Tab,
 * Ctrl+Shift+Tab, Ctrl+W, Ctrl+Shift+T o de cambiar de panel: seleccionado
 * (navegar), o escribiendo si se venía escribiendo en un editor y lo que queda
 * es otro (`modoTrasCambio`). Nunca en `body`, y nunca dentro de una consola.
 * Espera a que React monte la pestaña nueva (el editor se crea tras cargar la
 * nota): mientras tanto, el documento queda seleccionado.
 */
export function enfocarDocumentoActivo(veniaEscribiendo: boolean, intentos = 30) {
  sinAutoFocoHasta = Date.now() + 1500;
  requestAnimationFrame(() => {
    const doc = documentoDelPanel(useTabsStore.getState().activePaneId);
    if (!doc) {
      if (intentos > 0) enfocarDocumentoActivo(veniaEscribiendo, intentos - 1);
      return;
    }
    if (modoTrasCambio(veniaEscribiendo, claseDelActivo()) === "escribir") {
      const editor = visibleONull(doc.querySelector<HTMLElement>(".cm-content"));
      if (editor) {
        editor.focus();
        return;
      }
      if (!doc.contains(document.activeElement)) seleccionarDocumento(doc);
      if (intentos > 0) enfocarDocumentoActivo(veniaEscribiendo, intentos - 1);
      return;
    }
    seleccionarDocumento(doc);
  });
}

/** Ctrl+Alt+←/→: al panel contiguo de la división. */
export function irAPanelContiguo(dir: "izquierda" | "derecha") {
  const { activePaneId, setActivePane } = useTabsStore.getState();
  const paneles = [...document.querySelectorAll<HTMLElement>(`${SEL_DOCUMENTO}[data-pane-id]`)]
    .filter(visible)
    .map((d) => {
      const r = d.getBoundingClientRect();
      return { id: d.dataset.paneId!, caja: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
    });
  const destino = panelContiguo(paneles, activePaneId, dir);
  if (!destino || destino === activePaneId) return;
  const veniaEscribiendo = escribiendoEnEditor();
  setActivePane(destino);
  enfocarDocumentoActivo(veniaEscribiendo);
}

/** ¿Hay un diálogo modal abierto? Entonces F6 no saca el foco de él. */
export const hayModalAbierto = () => document.querySelector("[aria-modal='true']") !== null;
