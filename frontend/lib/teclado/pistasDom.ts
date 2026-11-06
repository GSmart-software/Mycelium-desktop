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
 * **Por sección** (rediseño del 2026-11-06, `alcanceDePistas`): en el nivel
 * de secciones, F10 muestra **una pista por sección** (elegirla la deja
 * elegida) más los controles sueltos entre secciones (los divisores de la
 * vista dividida); dentro de una sección, **solo sus controles**. Los
 * elementos de una lista —archivos, pestañas, resultados, filas, días,
 * tarjetas, nodos— no llevan pista (`esElementoDeLista`): con menos pistas
 * por pantalla, casi todas son de una letra y entran sus nombres.
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
import { documentoDe, documentoDelPanel, seleccionarDocumento, seleccionarSeccion, zonaDe } from "./focoDom";
import { seccionesVisibles, ubicar as ubicarFoco } from "./nivelesDom";
import {
  ALFABETO_NOMBRES,
  accionDePista,
  alcanceDePistas,
  esElementoDeLista,
  nombreDeSeccion,
  borrarLetra,
  escribirLetra,
  etiquetasPorNombre,
  filtrarPorPrefijo,
  letraDeCode,
  muestraTexto,
  ordenarPorPosicion,
  recortarNombre,
  ubicarNombres,
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

/**
 * Lo que se pone en la capa: el objetivo, su caja visible y qué hacer.
 * `nombre`: el de una sección (las demás lo sacan del DOM, `nombreDe`).
 */
type Objetivo = { el: HTMLElement; caja: CajaPista; marca: string | null; virtual?: ObjetivoVirtual; nombre?: string };

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

/** Los menús y listas emergentes: con el foco ahí, las pistas son las suyas. */
const SEL_EMERGENTE = "[role='menu'], [role='listbox'], [role='dialog']";

/** ¿Es un elemento de una lista y no un control? (Ver `esElementoDeLista`.) */
function deLista(el: HTMLElement): boolean {
  return esElementoDeLista({
    rol: el.getAttribute("role"),
    enLista: el.closest("[data-lista]") !== null,
    enGrilla: el.closest("[role='grid']") !== null,
    enFilaDeTabla: el.closest("tbody tr") !== null,
    tarjeta: el.hasAttribute("data-nodo"),
  });
}

/**
 * Los objetivos visibles, en el orden de lectura (arriba-izquierda primero),
 * según dónde esté el foco (`alcanceDePistas`).
 */
export function buscarObjetivos(): Objetivo[] {
  const modal = raizDeBusqueda();
  const foco = document.activeElement as HTMLElement | null;
  const emergente = foco?.closest<HTMLElement>(SEL_EMERGENTE) ?? null;
  const { lugar, zona } = ubicarFoco(foco);
  const alcance = alcanceDePistas({
    hayModal: modal !== document,
    enEmergente: emergente !== null && zonaDe(emergente) === null,
    nivelDeSecciones: lugar === "seccion" || !foco || foco === document.body,
    enSeccion: zona !== null,
  });
  const cortes = new Map<Element, boolean>();
  switch (alcance) {
    case "modal":
      return ordenarPorPosicion(objetivosEn(modal, cortes));
    case "emergente":
      return ordenarPorPosicion(objetivosEn(emergente!, cortes));
    case "secciones":
      // Una por sección, y los controles que no son de ninguna (los divisores
      // de la vista dividida), para que también se alcancen.
      return ordenarPorPosicion([
        ...objetivosDeSecciones(cortes),
        // Los marcos de draw.io cuelgan de `body` pero son del documento de
        // un panel: no son controles sueltos (sumaban pistas sin nombre y les
        // quitaban lugar a los nombres de las secciones; prueba en vivo del
        // 2026-11-06).
        ...objetivosEn(document, cortes, (el) => zonaDe(el) === null && !deLista(el) && !(el instanceof HTMLIFrameElement)),
      ]);
    case "seccion":
      // Solo los controles de esta sección: ni los de una sección anidada (el
      // panel de enlaces vive dentro del documento), ni los elementos de una
      // lista, ni los nodos del grafo.
      return ordenarPorPosicion(objetivosEn(zona!, cortes, (el) => zonaDe(el) === zona && !deLista(el)));
    default:
      return ordenarPorPosicion([...objetivosEn(document, cortes), ...objetivosVirtuales(cortes)]);
  }
}

/** Lo interactivo visible y no tapado dentro de `raiz` que cumple `filtro`. */
function objetivosEn(
  raiz: ParentNode,
  cortes: Map<Element, boolean>,
  filtro: (el: HTMLElement) => boolean = () => true,
): Objetivo[] {
  const vistos = new Set<HTMLElement>();
  const salida: Objetivo[] = [];
  for (const cand of raiz.querySelectorAll<HTMLElement>(SEL_CANDIDATO)) {
    // Lo de adentro del editor o de una consola no: el objetivo es el entero.
    const el = objetivoDe(cand);
    if (el !== cand || vistos.has(el)) continue;
    vistos.add(el);
    if (el.closest(".mic-pistas") || descartado(el) || !filtro(el)) continue;
    const caja = cajaVisible(el, cortes);
    if (!caja) continue;
    const punto = puntoLibre(el, caja);
    if (!punto) continue;
    salida.push({ el, caja, marca: marcaDe(el) });
  }
  return salida;
}

/**
 * Una pista por sección, en su esquina de arriba a la izquierda (`dibujar`
 * la pone ahí). La sección no pasa por `puntoLibre`: lo que la tapa son sus
 * propios hijos.
 */
function objetivosDeSecciones(cortes: Map<Element, boolean>): Objetivo[] {
  const salida: Objetivo[] = [];
  for (const zona of seccionesVisibles()) {
    const caja = cajaVisible(zona, cortes);
    if (!caja) continue;
    const tipo = zona.dataset.zona ?? "";
    const titulo =
      tipo === "panel"
        ? zona.querySelector("[role='tab'][aria-selected='true']")?.textContent
        : tipo === "izquierda"
          ? zona.querySelector("[data-titulo-seccion]")?.getAttribute("data-titulo-seccion")
          : null;
    salida.push({ el: zona, caja, marca: "seccion", nombre: nombreDeSeccion({ zona: tipo, titulo }) });
  }
  return salida;
}

/** Los nodos visibles de cada grafo registrado, como objetivos. Fuera de un modal. */
function objetivosVirtuales(cortes: Map<Element, boolean>): Objetivo[] {
  const salida: Objetivo[] = [];
  for (const [el, proveedor] of proveedores) {
    if (!el.isConnected || descartado(el)) continue;
    const visibleDelLienzo = cajaVisible(el, cortes);
    if (!visibleDelLienzo) continue;
    const r = el.getBoundingClientRect();
    // Primero los de más peso, y `elementFromPoint` (lo caro) solo hasta juntar
    // `MAX_VIRTUALES`: un grafo grande tiene cientos de nodos a la vista.
    const ordenados = proveedor()
      .map((v) => ({ v, x: r.left + v.x, y: r.top + v.y }))
      .filter(
        (p) =>
          p.x >= visibleDelLienzo.left &&
          p.x <= visibleDelLienzo.right &&
          p.y >= visibleDelLienzo.top &&
          p.y <= visibleDelLienzo.bottom,
      )
      .sort((a, b) => b.v.peso - a.v.peso);
    const puntos: typeof ordenados = [];
    for (const p of ordenados) {
      if (puntos.length >= MAX_VIRTUALES) break;
      if (document.elementFromPoint(p.x, p.y) === el) puntos.push(p);
    }
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
    case "seccion":
      seleccionarSeccion(el);
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
  /** El nombre de cada objetivo (de ahí salen las letras). */
  nombres: string[];
  marcas: HTMLSpanElement[];
  medidas: Medida[];
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

/**
 * El nombre del objetivo, como lo diría un lector de pantalla: `aria-label`,
 * lo que nombra `aria-labelledby`, `title`, el `alt` de una imagen, el
 * `placeholder` de un campo vacío o su texto. Los casos aparte tienen el suyo.
 * De acá salen las letras de la pista y el nombre que se ve junto al código.
 */
function nombreDe(o: Objetivo): string {
  // El `describir()` de un objetivo virtual lleva delante su clase («nodo: …»).
  if (o.virtual) return o.virtual.describir().replace(/^[^:]{1,16}:\s*/, "");
  if (o.nombre) return o.nombre;
  const el = o.el;
  if (el.classList.contains("cm-content")) return "Editor";
  if (el.classList.contains("xterm")) return "Consola";
  const etiquetadoPor = el
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
  const texto =
    el.getAttribute("aria-label") ||
    etiquetadoPor ||
    el.getAttribute("title") ||
    el.querySelector("img[alt]")?.getAttribute("alt") ||
    ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.value ? el.placeholder : "") ||
    el.textContent ||
    "";
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * ¿Hay que mostrar el nombre junto al código? Solo en lo que no muestra su
 * propio texto (un botón de solo ícono: el rail, las barras de herramientas,
 * una casilla). Lo que ya se lee —un archivo del árbol, una pestaña, una fila,
 * un campo con texto— lleva solo el código (`muestraTexto`). Los nodos del
 * grafo, el editor, las consolas, los marcos y los lienzos, tampoco: su
 * contenido ya está a la vista.
 */
function llevaNombre(o: Objetivo): boolean {
  // Una sección: su nombre siempre (no tiene un texto propio que se lea).
  if (o.marca === "seccion") return true;
  if (o.virtual || o.marca) return false;
  const el = o.el;
  if (el instanceof HTMLIFrameElement || el instanceof HTMLCanvasElement || el instanceof HTMLSelectElement) return false;
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return false;
  if (el instanceof HTMLInputElement) {
    if (["checkbox", "radio", "range", "color", "file"].includes(el.type)) return true;
    return !muestraTexto(el.value || el.placeholder);
  }
  return !muestraTexto(el.innerText);
}

/** Un breve texto del objetivo, para quien lea la capa (las pruebas por CDP). */
function describir(o: Objetivo): string {
  if (o.virtual) return o.virtual.describir();
  return `${o.el.tagName.toLowerCase()}: ${nombreDe(o).slice(0, 60)}`;
}

/** Lo que se mide de cada pista al dibujarla, para ubicar los nombres. */
type Medida = {
  /** La caja con el código solo, en su lugar. */
  codigo: CajaPista;
  /** La caja con el nombre, en su lugar; `null` si no lleva nombre. */
  conNombre: CajaPista | null;
  /** El `top` de cada lugar posible: en la esquina de arriba, o debajo del objetivo. */
  tops: number[];
};

function dibujar(a: Abiertas) {
  a.capa.replaceChildren();
  a.marcas = a.objetivos.map((o, i) => {
    const marca = document.createElement("span");
    marca.className = "mic-pista";
    marca.dataset.etiqueta = a.etiquetas[i];
    marca.dataset.objetivo = describir(o);
    marca.style.left = `${Math.round(o.caja.left)}px`;
    marca.style.top = `${Math.round(o.caja.top)}px`;
    const codigo = document.createElement("span");
    codigo.className = "mic-pista-codigo";
    marca.appendChild(codigo);
    const nombre = a.nombres[i];
    if (nombre && llevaNombre(o)) {
      const texto = document.createElement("span");
      texto.className = "mic-pista-nombre";
      texto.textContent = recortarNombre(nombre);
      marca.appendChild(texto);
    }
    a.capa.appendChild(marca);
    return marca;
  });
  pintarCodigos(a);
  // Se mide una vez, con todos los nombres a la vista; después solo se
  // esconden o se mueven, y el código no cambia de ancho.
  a.medidas = a.marcas.map((marca, i) => {
    const r = marca.getBoundingClientRect();
    const caja = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    const nombre = marca.querySelector<HTMLElement>(".mic-pista-nombre");
    if (!nombre) return { codigo: caja, conNombre: null, tops: [] };
    const fin = marca.querySelector(".mic-pista-codigo")!.getBoundingClientRect().right;
    const relleno = r.right - nombre.getBoundingClientRect().right;
    const objetivo = a.objetivos[i].caja;
    return {
      codigo: { ...caja, right: fin + relleno },
      conNombre: caja,
      tops: [Math.round(objetivo.top), Math.round(objetivo.bottom) + 3],
    };
  });
  ubicar(a);
}

/** Las letras de cada etiqueta, con lo escrito marcado; atenúa las que ya no coinciden. */
function pintarCodigos(a: Abiertas) {
  const coinciden = new Set(filtrarPorPrefijo(a.etiquetas, a.escrito));
  a.marcas.forEach((marca, i) => {
    const etiqueta = a.etiquetas[i];
    const sigue = coinciden.has(i);
    marca.classList.toggle("mic-pista-atenuada", !sigue);
    const n = sigue ? a.escrito.length : 0;
    const escrito = document.createElement("span");
    escrito.className = "mic-pista-escrito";
    escrito.textContent = [...etiqueta.slice(0, n)].map(letraVisible).join("");
    marca
      .querySelector(".mic-pista-codigo")!
      .replaceChildren(escrito, [...etiqueta.slice(n)].map(letraVisible).join(""));
  });
}

/**
 * Qué nombres se ven y dónde: uno que pisaría otra pista prueba debajo del
 * objetivo y, si tampoco cabe, se esconde (queda el código). Las atenuadas no
 * estorban, así que al escribir la primera letra aparecen más nombres.
 */
function ubicar(a: Abiertas) {
  const coinciden = new Set(filtrarPorPrefijo(a.etiquetas, a.escrito));
  const elegidas = ubicarNombres(
    a.medidas.map((m, i) => {
      const caja = m.conNombre;
      const alternativas = caja
        ? m.tops.map((top) => {
            const dy = top - m.tops[0];
            return { ...caja, top: caja.top + dy, bottom: caja.bottom + dy };
          })
        : [];
      return { codigo: m.codigo, alternativas, activa: coinciden.has(i) };
    }),
  );
  a.marcas.forEach((marca, i) => {
    const nombre = marca.querySelector<HTMLElement>(".mic-pista-nombre");
    if (!nombre) return;
    const k = elegidas[i];
    nombre.hidden = k === null;
    marca.style.top = `${a.medidas[i].tops[k ?? 0]}px`;
  });
}

/** Repinta tras una letra: lo escrito, las atenuadas y los nombres. */
function pintarEscrito(a: Abiertas) {
  pintarCodigos(a);
  ubicar(a);
}

/** Vuelve a buscar los objetivos (la ventana cambió de tamaño). */
function recalcular(a: Abiertas) {
  a.objetivos = buscarObjetivos();
  a.nombres = a.objetivos.map(nombreDe);
  a.etiquetas = etiquetasPorNombre(a.nombres);
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

  const nombres = objetivos.map(nombreDe);
  const a: Abiertas = {
    capa,
    objetivos,
    etiquetas: etiquetasPorNombre(nombres),
    nombres,
    marcas: [],
    medidas: [],
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
    const letra = letraDeCode(e.code, ALFABETO_NOMBRES);
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

  // Mientras se ven, cada objetivo real lleva `data-con-pista`: lo lee el
  // recorrido de cobertura (`scripts/cobertura-teclado.mjs`) para contar lo que
  // se alcanza con F10, y se quita al cerrar.
  const marcados = objetivos.filter((o) => !o.virtual).map((o) => o.el);
  for (const el of marcados) el.setAttribute("data-con-pista", "");
  const limpiarCapa = a.limpiar;
  a.limpiar = () => {
    limpiarCapa();
    for (const el of marcados) el.removeAttribute("data-con-pista");
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
