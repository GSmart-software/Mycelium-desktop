import { api } from "@/lib/api";
import { analizarXml, diagnosticarDrawio, motivoDeExcepcion } from "@/lib/archivosIlegibles";
import {
  accionCargar,
  diagramaInicial,
  leerEvento,
  urlDelEditor,
  type TemaDrawio,
} from "@/lib/drawio";
import { EVENTO_RECARGA } from "@/lib/eventos";
import { avisoTocaA, hayQueRecargar } from "@/lib/recargaExterna";
import { olvidarGuardadoPendiente, registrarGuardadoPendiente } from "@/lib/guardadoPendiente";
import { useAuthStore } from "@/stores/authStore";
import { useSyncStore } from "@/stores/syncStore";
import { allLeaves, useTabsStore } from "@/stores/tabsStore";

/**
 * Gestor de los editores de draw.io (`FUN-L-20`). Los `iframe` viven **AQUÍ**
 * (nivel de módulo), no en el componente: cambiar de pestaña remonta el
 * componente React, y con el editor adentro eso significaba **recargar la webapp
 * entera** —perdiendo zoom, selección y deshacer— cada vez que se volvía.
 *
 * Es el mismo problema que ya resolvieron `instanceCache` en `NoteEditor`
 * (`DEF-039`) y el `Map` de `lib/terminal.ts`, y la misma forma: el estado vive
 * fuera de React y el componente solo lo **muestra**.
 *
 * > [!warning] Con un `iframe` no alcanza con re-parentarlo
 * > La terminal re-adjunta su nodo con `appendChild`, pero **mover un `iframe`
 * > en el DOM lo recarga**: el navegador descarta el documento y vuelve a
 * > pedirlo. O sea que la solución de la terminal, aplicada tal cual, no
 * > arreglaría nada — se vería igual de lento y costaría más código.
 * >
 * > Por eso acá el `iframe` **nunca se mueve**: se crea una sola vez colgado de
 * > `document.body` y se le da `position: fixed` sobre el rectángulo del pane
 * > que lo muestra. Cambiar de pestaña solo lo **oculta** (`display:none`, que
 * > sí conserva el documento). Reposicionar no recarga; re-parentar sí.
 *
 * El `z-index` es **bajo (10) a propósito**: `.paneBody` no crea contexto de
 * apilado, así que las capas del pane —zonas de soltar (20), pista de arrastre
 * (30)— y los menús (60) y modales (70+) siguen dibujándose por encima. Con un
 * `z-index` alto, arrastrar una nota sobre un diagrama escondería la pista.
 */

/** Milisegundos de calma antes de escribir (mismo criterio que el editor). */
const GUARDADO_MS = 800;

/**
 * Cuántos editores se mantienen vivos a la vez.
 *
 * Mucho más bajo que el tope de las tablas (`MAX_TABLAS_RECORDADAS = 8`) porque
 * lo que se guarda no es comparable: una tabla recuerda filas, y esto mantiene
 * **la webapp de draw.io entera** corriendo en un `iframe`, que son decenas de
 * MB de memoria cada uno. Tres cubre el ir y venir entre un par de diagramas,
 * que es el caso real; el cuarto recarga, como antes.
 *
 * Nunca se suelta uno que se esté viendo: solo salen los ocultos.
 */
const MAX_EDITORES_VIVOS = 3;

/** Prefijo de las claves que NO son pestañas (el panel lateral anclado). */
const CLAVE_LATERAL = "sidebar:";

type Instancia = {
  clave: string;
  notaId: string;
  iframe: HTMLIFrameElement;
  /** El último XML conocido: lo que se escribiría si hubiera que guardar ya. */
  xml: string | null;
  /**
   * Lo último que este editor sabe que está en disco: lo que leyó o lo que mandó
   * a guardar (`FUN-L-26`). Es lo que reconoce el eco del guardado propio cuando
   * el watcher avisa de un cambio.
   */
  conocido: string | null;
  sucio: boolean;
  /** El editor ya dijo `init` y aceptó el diagrama. */
  cargado: boolean;
  /**
   * Por qué el archivo no se pudo leer, o `null` si se pudo (`DEF-119`).
   * Mientras no es `null`, `xml` también lo es —nada que guardar— y el `iframe`
   * queda oculto: la vista muestra el aviso en su lugar.
   */
  ilegible: string | null;
  /** Dónde se está mostrando ahora (null = oculto, en otra pestaña). */
  ancla: HTMLElement | null;
  tema: TemaDrawio;
  temporizador: ReturnType<typeof setTimeout> | null;
  /** Último rectángulo aplicado, para no tocar el estilo en cada cuadro. */
  rect: { x: number; y: number; w: number; h: number } | null;
  alRecibir: (ev: MessageEvent) => void;
};

const instancias = new Map<string, Instancia>();
let sincronizando = 0;

// ── Archivo ilegible (`DEF-119`) ──────────────────────────────────────────────
//
// draw.io embebido no avisa por el protocolo cuando un `load` falla: muestra su
// diálogo («No es un archivo de diagrama»), igual emite `load`, deja editar el
// diagrama vacío y su autoguardado lo manda como cualquier otro. Y antes, lo que
// ni siquiera parecía un diagrama se reemplazaba acá mismo por uno nuevo
// (`contenidoParaCargar`). Las dos cosas terminaban pisando el original. Por eso
// el contenido se revisa ANTES de mandarlo al iframe; si no se puede leer, no se
// manda nada y la vista muestra el aviso (lo escucha con `suscribirEstado`).

/** Quién escucha los cambios de estado de cada editor, por clave. */
const oyentes = new Map<string, Set<() => void>>();

function notificar(clave: string) {
  for (const f of oyentes.get(clave) ?? []) f();
}

/**
 * Carga en el editor lo que dice `disco`, o lo pasa a ilegible. Es el camino
 * único de la lectura inicial, la recarga desde disco y el «Reintentar».
 */
function aplicarDisco(inst: Instancia, disco: string) {
  inst.conocido = disco;
  const lectura = diagnosticarDrawio(disco, analizarXml);
  if (lectura.estado === "ilegible") {
    marcarIlegible(inst, lectura.motivo);
    return;
  }
  const estabaIlegible = inst.ilegible !== null;
  inst.ilegible = null;
  // Un archivo vacío (recién creado) sí es un diagrama en blanco válido.
  inst.xml = lectura.estado === "vacio" ? diagramaInicial() : disco;
  // Si el editor todavía no dijo `init`, el `init` ya le manda este XML.
  if (inst.cargado) {
    inst.iframe.contentWindow?.postMessage(JSON.stringify(accionCargar(inst.xml)), "*");
  }
  if (estabaIlegible) {
    inst.rect = null; // que `sincronizar` lo vuelva a posicionar y mostrar
    notificar(inst.clave);
  }
}

function marcarIlegible(inst: Instancia, motivo: string) {
  inst.ilegible = motivo;
  // Sin XML no hay nada que guardar: `guardar` sale sin escribir.
  inst.xml = null;
  inst.sucio = false;
  if (inst.temporizador) clearTimeout(inst.temporizador);
  inst.temporizador = null;
  inst.iframe.style.display = "none";
  inst.rect = null;
  notificar(inst.clave);
}

// ── Guardado ──────────────────────────────────────────────────────────────────

function guardar(inst: Instancia): Promise<void> {
  const xml = inst.xml;
  if (xml === null) return Promise.resolve();
  inst.sucio = false;
  // Antes del await: si el aviso del watcher llega mientras el guardado viaja,
  // lo que encuentre en disco es esto, y no hay que recargarlo.
  inst.conocido = xml;
  useSyncStore.getState().setSyncState(inst.notaId, "syncing");
  return api(`/notas/${encodeURIComponent(inst.notaId)}/contenido`, {
    method: "PUT",
    token: useAuthStore.getState().accessToken,
    body: { contenido: xml },
  })
    .then(() => useSyncStore.getState().setSyncState(inst.notaId, "synced"))
    .catch(() => useSyncStore.getState().setSyncState(inst.notaId, "error"));
}

function programarGuardado(inst: Instancia) {
  inst.sucio = true;
  useSyncStore.getState().setSyncState(inst.notaId, "local");
  if (inst.temporizador) clearTimeout(inst.temporizador);
  inst.temporizador = setTimeout(() => void guardar(inst), GUARDADO_MS);
}

/** Escribe ya lo que esta instancia tenga pendiente. Idempotente. */
function volcar(inst: Instancia): Promise<void> | void {
  if (!inst.sucio) return;
  if (inst.temporizador) clearTimeout(inst.temporizador);
  inst.temporizador = null;
  return guardar(inst);
}

// ── El iframe ─────────────────────────────────────────────────────────────────

function crear(clave: string, notaId: string, tema: TemaDrawio): Instancia {
  const iframe = document.createElement("iframe");
  iframe.title = "Editor de diagramas draw.io";
  // `position: fixed` sobre el rectángulo del pane. Ver el comentario de arriba:
  // es lo que permite cambiar de pestaña sin recargar la webapp.
  iframe.style.cssText =
    "position:fixed;border:0;display:none;z-index:10;background:var(--mic-bg-canvas)";
  iframe.src = urlDelEditor(tema);

  const inst: Instancia = {
    clave,
    notaId,
    iframe,
    xml: null,
    conocido: null,
    sucio: false,
    cargado: false,
    ilegible: null,
    ancla: null,
    tema,
    temporizador: null,
    rect: null,
    alRecibir: () => {},
  };

  inst.alRecibir = (ev: MessageEvent) => {
    // Solo lo que venga de ESTE iframe: por la ventana pasan mensajes de otras
    // cosas —y de los otros editores abiertos—, y confundir uno ajeno con un
    // guardado escribiría el archivo equivocado.
    if (ev.source !== inst.iframe.contentWindow) return;
    const msg = leerEvento(ev.data);
    if (msg === null) return;

    if (msg.event === "init") {
      inst.cargado = true;
      // Si el contenido todavía no llegó, `cargarXml` lo enviará al llegar.
      if (inst.xml !== null) {
        inst.iframe.contentWindow?.postMessage(
          JSON.stringify(accionCargar(inst.xml)),
          "*",
        );
      }
      return;
    }
    // Con el archivo ilegible no se acepta nada del editor (`DEF-119`): está
    // oculto, pero un autoguardado tardío escribiría un diagrama vacío encima.
    if (inst.ilegible !== null) return;
    if (msg.event === "autosave" && typeof msg.xml === "string") {
      inst.xml = msg.xml;
      programarGuardado(inst);
      return;
    }
    if (msg.event === "save" && typeof msg.xml === "string") {
      inst.xml = msg.xml;
      if (inst.temporizador) clearTimeout(inst.temporizador);
      inst.temporizador = null;
      void guardar(inst);
    }
  };

  window.addEventListener("message", inst.alRecibir);
  document.body.appendChild(iframe);
  registrarGuardadoPendiente(`drawio:${clave}`, () => volcar(inst));
  instancias.set(clave, inst);

  // El contenido del archivo, una sola vez por instancia. Volver a la pestaña
  // NO vuelve a leer del disco a propósito: el `iframe` puede tener cambios sin
  // guardar, y releer los pisaría.
  leerInicial(inst);

  return inst;
}

function leerInicial(inst: Instancia) {
  void api<{ contenido: string }>(`/notas/${encodeURIComponent(inst.notaId)}/contenido`, {
    token: useAuthStore.getState().accessToken,
  })
    .then((d) => {
      if (instancias.get(inst.clave) !== inst) return;
      aplicarDisco(inst, d.contenido ?? "");
    })
    .catch((e: unknown) => {
      if (instancias.get(inst.clave) !== inst) return;
      // Antes esto abría un diagrama nuevo «para no dejar el iframe colgado», y
      // su autoguardado lo escribía encima del archivo que no se pudo leer.
      marcarIlegible(inst, `No se pudo leer el archivo: ${motivoDeExcepcion(e)}`);
    });
}

// ── Cambios de afuera ─────────────────────────────────────────────────────────

/**
 * Relee el archivo y, si cambió por fuera, se lo carga al editor (`FUN-L-26`).
 *
 * Mismo criterio que `reloadFromDisk` en `NoteEditor`: no se toca un editor con
 * cambios sin guardar, y el eco del guardado propio no cuenta como cambio.
 *
 * Se manda otro `load` al iframe en vez de recargarlo: la webapp sigue viva (no
 * se vuelve a bajar ni a arrancar), y es la misma acción con que se abrió el
 * diagrama. Lo que sí se pierde es el zoom y el deshacer: `load` reemplaza el
 * archivo entero. La alternativa, `merge`, conserva la vista pero hace una
 * fusión de tres vías contra la versión que el editor cargó al abrir —y como
 * los guardados de Mycelium no pasan por draw.io, esa base queda vieja y la
 * fusión puede resucitar lo que el cambio de afuera borró—.
 */
async function recargar(inst: Instancia): Promise<void> {
  // Sin XML todavía (y sin estar ilegible), la lectura inicial está en camino y
  // ya va a traer lo nuevo. Con el archivo ilegible (`DEF-119`) sí se relee: es
  // como la vista se recupera cuando lo corrigen desde fuera.
  if (inst.sucio || (inst.xml === null && inst.ilegible === null)) return;
  let disco: string;
  try {
    const d = await api<{ contenido: string }>(
      `/notas/${encodeURIComponent(inst.notaId)}/contenido`,
      { token: useAuthStore.getState().accessToken },
    );
    disco = d.contenido ?? "";
  } catch {
    return; // Best-effort: si falla la relectura, lo que se ve queda como está.
  }
  // Re-chequear tras el await: pudo soltarse, o el usuario pudo empezar a editar.
  if (instancias.get(inst.clave) !== inst) return;
  if (!hayQueRecargar({ disco, sucio: inst.sucio, conocido: inst.conocido, enPantalla: inst.xml }))
    return;
  // Si lo que llegó está roto, el editor pasa al aviso en vez de quedarse con
  // un diagrama que, al tocarlo, se guardaría encima (`DEF-119`).
  aplicarDisco(inst, disco);
}

/** Suelta una instancia: vuelca lo pendiente y destruye el `iframe`. */
function soltar(clave: string) {
  const inst = instancias.get(clave);
  if (!inst) return;
  instancias.delete(clave);
  void volcar(inst);
  // La vista que lo mostraba (si queda alguna) deja de ver el aviso.
  if (inst.ilegible !== null) notificar(clave);
  olvidarGuardadoPendiente(`drawio:${clave}`);
  window.removeEventListener("message", inst.alRecibir);
  inst.iframe.remove();
}

/** Deja como mucho `MAX_EDITORES_VIVOS`, soltando los ocultos más viejos. */
function podar() {
  while (instancias.size > MAX_EDITORES_VIVOS) {
    // Un `Map` recuerda el orden de inserción, así que el primero oculto es el
    // más viejo. Los que se están viendo no se tocan.
    const victima = [...instancias.values()].find((i) => i.ancla === null);
    if (!victima) return;
    soltar(victima.clave);
  }
}

// ── Posicionar sobre el pane ──────────────────────────────────────────────────

function sincronizar() {
  sincronizando = 0;
  let hayVisibles = false;

  for (const inst of instancias.values()) {
    const ancla = inst.ancla;
    if (ancla === null) continue;
    hayVisibles = true;
    // Ilegible (`DEF-119`): en el hueco va el aviso de la vista, no el editor.
    // El bucle sigue, para mostrarlo apenas el archivo se corrija.
    if (inst.ilegible !== null) {
      if (inst.iframe.style.display !== "none") inst.iframe.style.display = "none";
      inst.rect = null;
      continue;
    }
    const r = ancla.getBoundingClientRect();
    // Un pane sin tamaño (colapsado, o el árbol a mitad de reacomodarse) oculta
    // el editor en vez de dibujarlo en un rectángulo degenerado.
    if (r.width < 1 || r.height < 1) {
      if (inst.iframe.style.display !== "none") inst.iframe.style.display = "none";
      inst.rect = null;
      continue;
    }
    const previo = inst.rect;
    if (
      previo === null ||
      previo.x !== r.left ||
      previo.y !== r.top ||
      previo.w !== r.width ||
      previo.h !== r.height
    ) {
      inst.rect = { x: r.left, y: r.top, w: r.width, h: r.height };
      inst.iframe.style.left = `${r.left}px`;
      inst.iframe.style.top = `${r.top}px`;
      inst.iframe.style.width = `${r.width}px`;
      inst.iframe.style.height = `${r.height}px`;
    }
    if (inst.iframe.style.display !== "block") inst.iframe.style.display = "block";
  }

  // El bucle solo corre mientras haya algo visible, y cada vuelta sale temprano
  // si el rectángulo no cambió. Se sigue por cuadro en vez de escuchar eventos
  // porque el pane se mueve por demasiadas razones —arrastrar un divisor,
  // abrir el panel lateral, plegar el explorador, redimensionar la ventana— y
  // enumerarlas todas es justo la lista que se queda corta.
  if (hayVisibles) sincronizando = requestAnimationFrame(sincronizar);
}

function arrancarSincronizacion() {
  if (sincronizando === 0) sincronizando = requestAnimationFrame(sincronizar);
}

// ── API para el componente ────────────────────────────────────────────────────

/**
 * Muestra el editor de `notaId` sobre `ancla`, creándolo si hace falta.
 *
 * Volver a una pestaña ya abierta **no** recarga nada: el `iframe` seguía vivo
 * y oculto, con su zoom, su selección y su historial de deshacer intactos.
 */
export function adjuntar(
  clave: string,
  notaId: string,
  ancla: HTMLElement,
  tema: TemaDrawio,
): void {
  let inst = instancias.get(clave);
  if (inst && inst.notaId !== notaId) {
    // La pestaña pasó a mostrar otro archivo: el editor viejo ya no sirve.
    soltar(clave);
    inst = undefined;
  }
  if (!inst) inst = crear(clave, notaId, tema);
  else {
    // Renovar la posición en el `Map` lo marca como el más reciente para la poda.
    instancias.delete(clave);
    instancias.set(clave, inst);
  }
  inst.ancla = ancla;
  inst.rect = null;
  aplicarTema(clave, tema);
  podar();
  arrancarSincronizacion();
}

/** Oculta el editor sin destruirlo: la pestaña sigue abierta, solo no se ve. */
export function desadjuntar(clave: string): void {
  const inst = instancias.get(clave);
  if (!inst) return;
  inst.ancla = null;
  inst.rect = null;
  inst.iframe.style.display = "none";
}

/**
 * Por qué el archivo de este editor no se pudo leer, o `null` (`DEF-119`). Es
 * el «snapshot» de `useSyncExternalStore` en la vista.
 */
export function motivoIlegible(clave: string): string | null {
  return instancias.get(clave)?.ilegible ?? null;
}

/** Avisa a `f` cada vez que el editor de `clave` pasa a ilegible o vuelve. */
export function suscribirEstado(clave: string, f: () => void): () => void {
  let set = oyentes.get(clave);
  if (!set) oyentes.set(clave, (set = new Set()));
  set.add(f);
  return () => {
    set.delete(f);
    if (set.size === 0) oyentes.delete(clave);
  };
}

/** «Reintentar» del aviso: vuelve a leer el archivo del disco. */
export function reintentar(clave: string): void {
  const inst = instancias.get(clave);
  if (inst) leerInicial(inst);
}

/**
 * Cambia el tema del editor (CA6).
 *
 * draw.io lee el tema **al arrancar**, así que esto recarga el `iframe`. No se
 * pierde nada: el XML vive acá, y al volver a decir `init` se le manda de nuevo.
 */
export function aplicarTema(clave: string, tema: TemaDrawio): void {
  const inst = instancias.get(clave);
  if (!inst || inst.tema === tema) return;
  inst.tema = tema;
  inst.cargado = false;
  inst.iframe.src = urlDelEditor(tema);
}

/** Cuántos editores hay vivos. Para los tests. */
export function vivos(): number {
  return instancias.size;
}

// ── Cerrar una pestaña sí destruye el editor ──────────────────────────────────

/**
 * Suelta los editores cuya pestaña ya no existe.
 *
 * Se mira el árbol de panes en vez de pedirle a la vista que avise al cerrarse,
 * porque la vista **no puede distinguir** un cierre de un cambio de pestaña: en
 * los dos casos se desmonta igual. Quién sabe la diferencia es el store.
 */
function barrerPestanasCerradas() {
  if (instancias.size === 0) return;
  const abiertas = new Set<string>();
  for (const hoja of allLeaves(useTabsStore.getState().root)) {
    for (const t of hoja.tabs) abiertas.add(t.id);
  }
  for (const clave of [...instancias.keys()]) {
    if (clave.startsWith(CLAVE_LATERAL)) continue;
    if (!abiertas.has(clave)) soltar(clave);
  }
}

if (typeof window !== "undefined") {
  useTabsStore.subscribe(barrerPestanasCerradas);
  // Todos los editores vivos, también los ocultos y el del panel lateral: uno
  // oculto con lo viejo pisaría lo de afuera al volver y guardar.
  window.addEventListener(EVENTO_RECARGA, (ev) => {
    for (const inst of instancias.values()) {
      if (avisoTocaA(ev, inst.notaId)) void recargar(inst);
    }
  });
}
