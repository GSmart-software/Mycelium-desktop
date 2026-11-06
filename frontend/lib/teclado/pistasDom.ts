/**
 * El modo pistas sobre el DOM (`FUN-XL-04`, Parte 5): buscar los objetivos
 * visibles, dibujar las etiquetas en una capa encima de todo, atender las
 * letras mientras se ven y activar el objetivo elegido. Las decisiones —
 * etiquetas, orden, qué hacer con cada elemento— están en `pistas.ts` (puras,
 * con test).
 *
 * Sin React, como `focoDom.ts`: la capa es un `<div>` que se agrega al
 * `<body>` al abrir y se quita al cerrar, y el teclado se escucha en `window`
 * en captura solo mientras está abierta. Las letras de las pistas **no son
 * atajos**: existen solo mientras las pistas se ven (regla de los dos modos).
 *
 * **Qué recibe pista.** Lo interactivo (`SEL_OBJETIVO`) que se ve: dentro de
 * la ventana y de los contenedores con desplazamiento, sin `display: none`,
 * `visibility: hidden`, `inert` ni `aria-hidden`, y **no tapado**: en el punto
 * donde iría la etiqueta, `elementFromPoint` tiene que caer en el mismo
 * objetivo. Con un diálogo modal abierto, solo lo de adentro. Casos aparte:
 * - El editor de CodeMirror es **un** objetivo (`.cm-content`), no cada línea.
 * - Una consola es **un** objetivo (`.xterm`): entrar a escribir en ella.
 * - Un iframe (draw.io, PDF) es **un** objetivo: el foco al marco.
 * - Una tarjeta de un lienzo (`[data-nodo]`) se selecciona como con el puntero.
 * - El grafo es un `<canvas>` sin nodos en el DOM: el lienzo es un objetivo
 *   (lo enfoca) y además cada nodo visible, que el grafo informa con
 *   `registrarObjetivosVirtuales` (Parte 7): posiciones del motor, no
 *   elementos. Se toman los `MAX_VIRTUALES` de más conexiones.
 * - `data-pista="clic|foco|…"` en cualquier elemento lo vuelve objetivo con esa
 *   acción.
 *
 * **F10 y Windows.** F10 sin consumir activa el «modo menú» de Win32 (la
 * siguiente tecla se la come el menú de la ventana). El despachador hace
 * `preventDefault()` siempre que la atiende. Si en WebView2 eso no alcanzara,
 * el paso siguiente es interceptarla en Rust con el `AcceleratorKeyPressed`
 * que ya registra `src-tauri/src/devtools.rs`: con `VK_F10` (0x79) sin
 * modificadores, `SetHandled(true)` —la página deja de recibirla— y avisar a
 * la ventana con un evento de Tauri que ejecute el comando `pistas.mostrar`.
 * Ojo: ese manejador hoy sale enseguida si las DevTools están permitidas; la
 * comprobación de F10 tendría que ir antes. No se hizo: primero se prueba en
 * vivo si `preventDefault` alcanza.
 */
import { useTabsStore } from "@/stores/tabsStore";
import { distribucionActual } from "@/lib/comandos/distribucion";
import { documentoDe, documentoDelPanel, seleccionarDocumento } from "./focoDom";
import {
  accionDePista,
  borrarLetra,
  escribirLetra,
  etiquetasPistas,
  filtrarPorPrefijo,
  letraDeCode,
  ordenarPorPosicion,
  type AccionPista,
  type CajaPista,
} from "./pistas";

/** Lo interactivo. Los `div` con `onClick` y sin rol no entran: se les pone rol. */
const SEL_OBJETIVO = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "iframe",
  "[role='button']",
  "[role='tab']",
  "[role='treeitem']",
  "[role='option']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='link']",
  "[role='checkbox']",
  "[role='switch']",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable]:not([contenteditable='false'])",
  "[data-pista]",
].join(", ");

/** Lo que se busca: lo interactivo y los casos aparte. */
const SEL_CANDIDATO = `${SEL_OBJETIVO}, .cm-content, .xterm, [data-nodo], [data-documento] canvas`;

// ── el objetivo de un punto ───────────────────────────────────────────────

/**
 * El objetivo al que pertenece un elemento: lo que recibiría el clic. Dentro
 * del editor o de una consola, el editor o la consola enteros.
 */
function objetivoDe(el: Element | null): HTMLElement | null {
  if (!el) return null;
  const cm = el.closest<HTMLElement>(".cm-content");
  if (cm) return cm;
  const consola = el.closest<HTMLElement>(".xterm");
  if (consola) return consola;
  const interactivo = el.closest<HTMLElement>(SEL_OBJETIVO);
  if (interactivo) return interactivo;
  const tarjeta = el.closest<HTMLElement>("[data-nodo]");
  if (tarjeta) return tarjeta;
  if (el instanceof HTMLCanvasElement && el.closest("[data-documento]")) return el;
  return null;
}

/** ¿Está deshabilitado u oculto a propósito? */
function descartado(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.closest("[aria-hidden='true'], [inert]")) return true;
  if (el.getClientRects().length === 0) return true;
  // `checkVisibility` mira `display`, `visibility` y `content-visibility`.
  const cv = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (cv && !cv.call(el, { visibilityProperty: true, checkVisibilityCSS: true })) return true;
  return false;
}

/**
 * La parte de la caja que se ve: recortada por la ventana y por cada
 * contenedor que corta lo que desborda (`overflow` distinto de `visible`).
 * `cortes` memoriza el estilo de cada antecesor durante una búsqueda.
 */
function cajaVisible(el: HTMLElement, cortes: Map<Element, boolean>): CajaPista | null {
  const r = el.getBoundingClientRect();
  let caja: CajaPista = {
    left: Math.max(r.left, 0),
    top: Math.max(r.top, 0),
    right: Math.min(r.right, window.innerWidth),
    bottom: Math.min(r.bottom, window.innerHeight),
  };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    let corta = cortes.get(p);
    if (corta === undefined) {
      const s = getComputedStyle(p);
      corta = s.overflowX !== "visible" || s.overflowY !== "visible";
      cortes.set(p, corta);
    }
    if (!corta) continue;
    const q = p.getBoundingClientRect();
    caja = {
      left: Math.max(caja.left, q.left),
      top: Math.max(caja.top, q.top),
      right: Math.min(caja.right, q.right),
      bottom: Math.min(caja.bottom, q.bottom),
    };
    if (caja.right - caja.left < 2 || caja.bottom - caja.top < 2) return null;
  }
  return caja.right - caja.left < 2 || caja.bottom - caja.top < 2 ? null : caja;
}

/**
 * ¿No lo tapa nada? Se prueba el centro y, si no, un punto cerca de cada
 * borde: una pestaña con su «×» en el centro, o un botón medio tapado por una
 * barra, siguen siendo alcanzables. Devuelve el punto que funcionó.
 */
function puntoLibre(el: HTMLElement, c: CajaPista): { x: number; y: number } | null {
  const cx = (c.left + c.right) / 2;
  const cy = (c.top + c.bottom) / 2;
  const m = 4;
  const puntos = [
    { x: cx, y: cy },
    { x: Math.min(c.left + m, cx), y: cy },
    { x: Math.max(c.right - m, cx), y: cy },
    { x: cx, y: Math.min(c.top + m, cy) },
    { x: Math.min(c.left + m, cx), y: Math.min(c.top + m, cy) },
  ];
  for (const p of puntos) if (objetivoDe(document.elementFromPoint(p.x, p.y)) === el) return p;
  return null;
}

/** Dónde se buscan los objetivos: el diálogo modal de más arriba, o toda la ventana. */
function raizDeBusqueda(): ParentNode {
  const modales = [...document.querySelectorAll<HTMLElement>("[aria-modal='true']")].filter(
    (m) => m.getClientRects().length > 0,
  );
  return modales.at(-1) ?? document;
}

// ── objetivos virtuales (los nodos del grafo) ─────────────────────────────

/**
 * Un objetivo que no es un elemento: un punto dentro de un `<canvas>` (un nodo
 * del grafo). `x`/`y` en píxeles relativos al lienzo; `peso` decide cuáles
 * entran si son muchos; `activar(soloElegir)` hace lo del clic (con Shift,
 * `soloElegir`: elegirlo sin abrirlo).
 */
export type ObjetivoVirtual = {
  x: number;
  y: number;
  peso: number;
  describir: () => string;
  activar: (soloElegir: boolean) => void;
};

/** Cuántos objetivos virtuales por lienzo, como mucho: más letras serían ruido. */
const MAX_VIRTUALES = 60;

const proveedores = new Map<HTMLElement, () => ObjetivoVirtual[]>();

/** Lo llama el grafo al montarse; devuelve con qué darse de baja. */
export function registrarObjetivosVirtuales(el: HTMLElement, proveedor: () => ObjetivoVirtual[]): () => void {
  proveedores.set(el, proveedor);
  return () => {
    if (proveedores.get(el) === proveedor) proveedores.delete(el);
  };
}

/** Lo que se pone en la capa: el objetivo, su caja visible y qué hacer. */
type Objetivo = { el: HTMLElement; caja: CajaPista; marca: string | null; virtual?: ObjetivoVirtual };

/** La marca que deduce el DOM para los casos aparte, o la de `data-pista`. */
function marcaDe(el: HTMLElement): string | null {
  if (el.dataset.pista) return el.dataset.pista;
  if (el.classList.contains("xterm")) return "consola";
  if (el.classList.contains("cm-content")) return "foco";
  if (el.classList.contains("excalidraw-container")) return "foco";
  if (el.hasAttribute("data-nodo") && !el.matches(SEL_OBJETIVO)) return "puntero";
  // Un lienzo enfocable (el grafo, Parte 7) recibe el foco; si no, se
  // selecciona su documento.
  if (el instanceof HTMLCanvasElement) return el.tabIndex >= 0 ? "foco" : "documento";
  return null;
}

/** Los objetivos visibles, en el orden de lectura (arriba-izquierda primero). */
export function buscarObjetivos(): Objetivo[] {
  const raiz = raizDeBusqueda();
  const cortes = new Map<Element, boolean>();
  const vistos = new Set<HTMLElement>();
  const salida: Objetivo[] = [];
  for (const cand of raiz.querySelectorAll<HTMLElement>(SEL_CANDIDATO)) {
    // Lo de adentro del editor o de una consola no: el objetivo es el entero.
    const el = objetivoDe(cand);
    if (el !== cand || vistos.has(el)) continue;
    vistos.add(el);
    if (el.closest(".mic-pistas") || descartado(el)) continue;
    const caja = cajaVisible(el, cortes);
    if (!caja) continue;
    const punto = puntoLibre(el, caja);
    if (!punto) continue;
    salida.push({ el, caja, marca: marcaDe(el) });
  }
  if (!(raiz instanceof HTMLElement)) salida.push(...objetivosVirtuales(cortes));
  return ordenarPorPosicion(salida);
}

/** Los nodos visibles de cada grafo registrado, como objetivos. Fuera de un modal. */
function objetivosVirtuales(cortes: Map<Element, boolean>): Objetivo[] {
  const salida: Objetivo[] = [];
  for (const [el, proveedor] of proveedores) {
    if (!el.isConnected || descartado(el)) continue;
    const visibleDelLienzo = cajaVisible(el, cortes);
    if (!visibleDelLienzo) continue;
    const r = el.getBoundingClientRect();
    const puntos = proveedor()
      .map((v) => ({ v, x: r.left + v.x, y: r.top + v.y }))
      .filter(
        (p) =>
          p.x >= visibleDelLienzo.left &&
          p.x <= visibleDelLienzo.right &&
          p.y >= visibleDelLienzo.top &&
          p.y <= visibleDelLienzo.bottom &&
          document.elementFromPoint(p.x, p.y) === el,
      )
      .sort((a, b) => b.v.peso - a.v.peso)
      .slice(0, MAX_VIRTUALES);
    for (const p of puntos) {
      salida.push({
        el,
        caja: { left: p.x - 6, top: p.y - 6, right: p.x + 6, bottom: p.y + 6 },
        marca: null,
        virtual: p.v,
      });
    }
  }
  return salida;
}

// ── activar ───────────────────────────────────────────────────────────────

function enfocar(el: HTMLElement) {
  // Un objetivo que no se puede enfocar (un `div` con rol y sin `tabindex`)
  // se vuelve enfocable solo por código, sin sumar una parada de Tab.
  if (!el.hasAttribute("tabindex") && el.tabIndex < 0 && !(el instanceof HTMLIFrameElement)) el.tabIndex = -1;
  el.focus({ preventScroll: true });
}

/** Hace lo que corresponde con el objetivo elegido. */
export function activarObjetivo(el: HTMLElement, accion: AccionPista) {
  // El panel del objetivo pasa a ser el activo, como con un clic.
  const doc = documentoDe(el);
  const paneId = doc?.dataset.paneId;
  if (paneId) useTabsStore.getState().setActivePane(paneId);
  switch (accion) {
    case "clic":
      enfocar(el);
      el.click();
      break;
    case "foco":
    case "marco":
      enfocar(el);
      break;
    case "consola":
      el.querySelector<HTMLElement>(".xterm-helper-textarea")?.focus();
      break;
    case "documento":
      if (doc) seleccionarDocumento(doc);
      else enfocar(el);
      break;
    case "puntero": {
      // Las tarjetas de un lienzo se seleccionan en `pointerdown`.
      const r = el.getBoundingClientRect();
      const datos = { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerId: 1 };
      const pos = { clientX: r.left + 8, clientY: r.top + 8 };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...datos, ...pos }));
      el.dispatchEvent(new PointerEvent("pointerup", { ...datos, ...pos }));
      if (doc) seleccionarDocumento(doc);
      break;
    }
  }
  // Se sigue usando el teclado: el `pointerdown` sintético no cuenta.
  document.documentElement.setAttribute("data-teclado", "");
}

// ── la capa ───────────────────────────────────────────────────────────────

type Abiertas = {
  capa: HTMLDivElement;
  objetivos: Objetivo[];
  etiquetas: string[];
  marcas: HTMLSpanElement[];
  escrito: string;
  /** Alguna letra se escribió con Shift: enfocar sin clic. */
  conShift: boolean;
  limpiar: () => void;
};

let abiertas: Abiertas | null = null;

/** ¿Se ven las pistas? (Esc, mientras tanto, es de ellas.) */
export const pistasVisibles = () => abiertas !== null;

/** La letra como la ve el usuario en su teclado. */
function letraVisible(letra: string): string {
  const visto = distribucionActual().get(`Key${letra}`);
  return visto && visto.trim() ? visto.toLocaleUpperCase("es") : letra;
}

/** Un breve texto del objetivo, para quien lea la capa (las pruebas por CDP). */
function describir(el: HTMLElement): string {
  const texto =
    el.getAttribute("aria-label") ??
    el.getAttribute("title") ??
    (el instanceof HTMLIFrameElement ? el.title : null) ??
    (el.classList.contains("cm-content") ? "editor" : el.classList.contains("xterm") ? "consola" : null) ??
    el.textContent ??
    "";
  return `${el.tagName.toLowerCase()}: ${texto.replace(/\s+/g, " ").trim().slice(0, 60)}`;
}

function dibujar(a: Abiertas) {
  a.capa.replaceChildren();
  a.marcas = a.objetivos.map((o, i) => {
    const marca = document.createElement("span");
    marca.className = "mic-pista";
    marca.dataset.etiqueta = a.etiquetas[i];
    marca.dataset.objetivo = o.virtual ? o.virtual.describir() : describir(o.el);
    marca.style.left = `${Math.round(o.caja.left)}px`;
    marca.style.top = `${Math.round(o.caja.top)}px`;
    a.capa.appendChild(marca);
    return marca;
  });
  pintarEscrito(a);
}

/** Marca lo escrito en cada etiqueta y atenúa las que ya no coinciden. */
function pintarEscrito(a: Abiertas) {
  const coinciden = new Set(filtrarPorPrefijo(a.etiquetas, a.escrito));
  a.marcas.forEach((marca, i) => {
    const etiqueta = a.etiquetas[i];
    const sigue = coinciden.has(i);
    marca.classList.toggle("mic-pista-atenuada", !sigue);
    const n = sigue ? a.escrito.length : 0;
    const escrito = document.createElement("span");
    escrito.className = "mic-pista-escrito";
    escrito.textContent = [...etiqueta.slice(0, n)].map(letraVisible).join("");
    marca.replaceChildren(escrito, [...etiqueta.slice(n)].map(letraVisible).join(""));
  });
}

/** Vuelve a buscar los objetivos (la ventana cambió de tamaño). */
function recalcular(a: Abiertas) {
  a.objetivos = buscarObjetivos();
  a.etiquetas = etiquetasPistas(a.objetivos.length);
  a.escrito = "";
  a.conShift = false;
  if (a.objetivos.length === 0) {
    cerrarPistas();
    return;
  }
  dibujar(a);
}

/** Abre las pistas. Sin nada clicable a la vista, no abre nada. */
export function abrirPistas() {
  if (abiertas) return;
  const objetivos = buscarObjetivos();
  if (objetivos.length === 0) return;
  const capa = document.createElement("div");
  capa.className = "mic-pistas";
  capa.setAttribute("aria-hidden", "true");
  document.body.appendChild(capa);

  const a: Abiertas = {
    capa,
    objetivos,
    etiquetas: etiquetasPistas(objetivos.length),
    marcas: [],
    escrito: "",
    conShift: false,
    limpiar: () => {},
  };

  function consumir(e: KeyboardEvent) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function alPulsar(e: KeyboardEvent) {
    if (abiertas !== a) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) {
      // Otro atajo: las pistas se van y la tecla sigue su camino.
      cerrarPistas();
      return;
    }
    if (e.code === "Escape") {
      consumir(e);
      cerrarPistas();
      return;
    }
    if (e.code === "Backspace") {
      consumir(e);
      a.escrito = borrarLetra(a.escrito);
      if (!a.escrito) a.conShift = false;
      pintarEscrito(a);
      return;
    }
    const letra = letraDeCode(e.code);
    if (letra) {
      consumir(e);
      const paso = escribirLetra(a.etiquetas, a.escrito, letra);
      if (paso.tipo === "ignorar") return;
      a.conShift ||= e.shiftKey;
      a.escrito = paso.escrito;
      if (paso.tipo === "seguir") {
        pintarEscrito(a);
        return;
      }
      const { el, marca, virtual } = a.objetivos[paso.indice];
      if (virtual) {
        // Un nodo del grafo: lo elige (y con las letras solas, lo abre).
        const soloElegir = a.conShift;
        cerrarPistas();
        if (el.isConnected) virtual.activar(soloElegir);
        document.documentElement.setAttribute("data-teclado", "");
        return;
      }
      const accion = accionDePista(
        {
          etiqueta: el.tagName,
          tipo: el instanceof HTMLInputElement ? el.type : null,
          rol: el.getAttribute("role"),
          editable: el.isContentEditable,
          marca,
        },
        a.conShift,
      );
      cerrarPistas();
      if (el.isConnected) activarObjetivo(el, accion);
      return;
    }
    // Una tecla que escribiría algo (otra letra, un número): no se cuela al
    // documento de abajo. Lo demás (Tab, flechas, F6) cierra y sigue.
    if (e.key.length === 1) {
      consumir(e);
      return;
    }
    cerrarPistas();
  }

  let cuadro = 0;
  const alRedimensionar = () => {
    cancelAnimationFrame(cuadro);
    cuadro = requestAnimationFrame(() => abiertas === a && recalcular(a));
  };
  // Lo que mueve lo que hay debajo deja las etiquetas fuera de lugar: se cierran.
  const alMover = (e: Event) => {
    if (e.target instanceof Node && capa.contains(e.target)) return;
    cerrarPistas();
  };
  const alSalirDeLaVentana = () => cerrarPistas();

  window.addEventListener("keydown", alPulsar, true);
  window.addEventListener("resize", alRedimensionar);
  window.addEventListener("scroll", alMover, true);
  window.addEventListener("wheel", alMover, { capture: true, passive: true });
  window.addEventListener("pointerdown", alMover, true);
  window.addEventListener("blur", alSalirDeLaVentana);
  a.limpiar = () => {
    cancelAnimationFrame(cuadro);
    window.removeEventListener("keydown", alPulsar, true);
    window.removeEventListener("resize", alRedimensionar);
    window.removeEventListener("scroll", alMover, true);
    window.removeEventListener("wheel", alMover, { capture: true });
    window.removeEventListener("pointerdown", alMover, true);
    window.removeEventListener("blur", alSalirDeLaVentana);
    capa.remove();
  };

  abiertas = a;
  dibujar(a);
}

/** Cierra las pistas sin hacer nada. */
export function cerrarPistas() {
  const a = abiertas;
  if (!a) return;
  abiertas = null;
  a.limpiar();
}

/**
 * F10 desde un marco de otro origen (draw.io): la tecla no llega a la app y,
 * con el foco adentro del marco, las letras tampoco llegarían. Así que el
 * documento del panel `paneId` queda seleccionado —el foco vuelve a la app— y
 * recién entonces se abren las pistas. Lo avisa `drawio/guarda.js`.
 */
export function pistasDesdeMarco(paneId: string | null) {
  if (abiertas) {
    cerrarPistas();
    return;
  }
  if (paneId) useTabsStore.getState().setActivePane(paneId);
  const doc = documentoDelPanel(paneId ?? useTabsStore.getState().activePaneId);
  if (doc) seleccionarDocumento(doc);
  requestAnimationFrame(() => abrirPistas());
}
