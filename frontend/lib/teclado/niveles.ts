/**
 * Los niveles del teclado (`FUN-XL-04`, rediseño tras la revisión del usuario
 * del 2026-11-06): la lógica pura —sin DOM ni React— de cómo se navega por
 * niveles anidados de selección. La prueba `scripts/test-teclado-zonas.mjs`;
 * lo que toca el DOM está en `nivelesDom.ts`.
 *
 * **La regla, con tres teclas en todos los niveles** (segunda vuelta tras
 * probarlo, 2026-11-06: «Ctrl para todo»):
 * - **Ctrl+flechas**: moverse **espacialmente** dentro del nivel actual (hacia
 *   lo que está en esa dirección), sin salir de él. Hasta esa vuelta era
 *   Alt+flechas.
 * - **Enter**: entrar a lo elegido (un nivel más adentro).
 * - **Alt solo** (el izquierdo, apretado y soltado sin otra tecla) o **Esc**:
 *   salir un nivel; si hay algo abierto, primero lo cierra.
 *
 * **Los niveles**:
 * 1. **Secciones**: la barra superior, el rail, el panel izquierdo, cada panel
 *    (división) de pestañas, el panel de enlaces y la barra de estado (las
 *    `data-zona`). Una sección está **seleccionada** cuando el foco está en su
 *    contenedor.
 * 2. **Elementos de una sección**: sus botones, campos, pestañas, filas del
 *    árbol… y el **documento** del panel como un elemento más (seleccionado =
 *    el foco en él mismo).
 *    - **Grupos** (pedido del usuario, 2026-11-06): una sección puede juntar
 *      sus elementos en grupos (`data-grupo`; en el explorador, la barra de
 *      botones, la Bandeja y Archivos). En el nivel de la sección cada grupo es
 *      **un** elemento —su título (`data-grupo-titulo`) o, si no tiene, el
 *      grupo mismo— y lo de adentro solo se alcanza entrando: Enter entra (si
 *      está plegado, lo despliega), ←/→ lo pliegan y despliegan como una
 *      carpeta del árbol, y Alt o Esc vuelven al título.
 * 3. **Dentro del documento** (escribiendo): el editor, o el contenido de la
 *    pestaña (las tarjetas de un lienzo, las filas de una tabla…).
 */
import type { Direccion } from "./navegacion";

export type Caja = { left: number; top: number; right: number; bottom: number };

/** Dónde está el foco, visto como niveles. */
export type Lugar =
  /** En el contenedor de una sección: la sección está seleccionada. */
  | "seccion"
  /** En un elemento de una sección (un botón, una fila, una pestaña…). */
  | "elemento"
  /** En el título de un grupo (o en el grupo mismo, si no tiene título): el grupo está elegido. */
  | "grupo"
  /** En el documento de un panel, él mismo: seleccionado (modo navegar). */
  | "documento"
  /** Dentro del documento: escribiendo, o en su contenido. */
  | "dentro"
  /** Dentro del contenido de una pestaña de un panel (el de enlaces). */
  | "contenido-de-pestana"
  /** Fuera de toda sección: un diálogo, un menú, `body`. */
  | "fuera";

/** Adónde lleva Esc desde cada lugar (si nadie usó la tecla para cerrar algo). */
export type DestinoEsc = "documento" | "seccion" | "pestana" | "grupo" | null;

/**
 * Esc sale un nivel: escribiendo → el documento seleccionado; del documento o
 * de un elemento → la sección seleccionada; del contenido de una pestaña → esa
 * pestaña. En el nivel de secciones y fuera de ellas, nada.
 *
 * `enGrupo`: lo enfocado está **dentro de un grupo** (es uno de sus elementos;
 * o, si es el título de un grupo, ese grupo está dentro de otro). Entonces se
 * sale al título del grupo que lo contiene, no a la sección: del árbol de
 * Archivos, Esc vuelve a «Archivos»; de «Archivos», a la sección.
 */
export function destinoDeEsc(lugar: Lugar, enGrupo = false): DestinoEsc {
  switch (lugar) {
    case "dentro":
      return enGrupo ? "grupo" : "documento";
    case "documento":
    case "elemento":
    case "grupo":
      return enGrupo ? "grupo" : "seccion";
    case "contenido-de-pestana":
      return "pestana";
    default:
      return null;
  }
}

/** Lo que hace Enter según dónde esté el foco. */
export type Entrada =
  /** Desde una sección seleccionada: a su último elemento enfocado (o el primero). */
  | "a-la-seccion"
  /** Desde un documento seleccionado: a escribir (o al componente). */
  | "al-documento"
  /** Desde el título de un grupo: lo despliega si está plegado y va a su último elemento (o el primero). */
  | "al-grupo"
  /** Sobre una pestaña: activarla y entrar a su documento. */
  | "pestana"
  /** Sobre un botón, una fila, una casilla…: ejecutarlo, como Enter o un clic. */
  | "activar"
  | null;

export function entradaDe(lugar: Lugar, esPestana: boolean): Entrada {
  switch (lugar) {
    case "seccion":
      return "a-la-seccion";
    case "documento":
      return "al-documento";
    case "grupo":
      return "al-grupo";
    case "elemento":
    case "dentro":
    case "contenido-de-pestana":
      return esPestana ? "pestana" : "activar";
    default:
      return null;
  }
}

/** Entre qué se mueve Ctrl+flechas: el nivel del foco. */
export type NivelDeMovimiento = "secciones" | "seccion" | "grupo" | "documento" | null;

/**
 * Entre qué se mueve Ctrl+flechas según dónde esté el foco. `enGrupo`: lo
 * enfocado está dentro de un grupo (`destinoDeEsc`). Dentro de un grupo, solo
 * entre sus elementos: no salta a otro grupo ni a lo suelto de la sección.
 * Desde el título de un grupo, entre los grupos y lo suelto del nivel de
 * arriba (la sección, o el grupo que lo contiene).
 */
export function nivelDeMovimiento(lugar: Lugar, enGrupo = false): NivelDeMovimiento {
  if (lugar === "fuera") return null;
  if (lugar === "seccion") return "secciones";
  if (enGrupo) return "grupo";
  return lugar === "dentro" ? "documento" : "seccion";
}

/** Lo que hace una flecha sola (← o →) sobre el título de un grupo. */
export type FlechaEnGrupo = "plegar" | "desplegar" | "entrar" | null;

/**
 * ← y → sobre el título de un grupo, como sobre una carpeta del árbol: ←
 * pliega un grupo desplegado (plegado, no hace nada: se sale con Alt o Esc);
 * → despliega uno plegado y, si ya está desplegado, entra (como Enter; el árbol
 * baja al primer hijo, acá se vuelve al último elemento usado). `expandido` es
 * `null` si el grupo no se pliega (la barra de botones): → entra y ← nada.
 */
export function flechaEnGrupo(dir: "izquierda" | "derecha", expandido: boolean | null): FlechaEnGrupo {
  if (dir === "izquierda") return expandido === true ? "plegar" : null;
  return expandido === false ? "desplegar" : "entrar";
}

/**
 * El vecino en una dirección, por **cajas** y no por centros. Con centros, un
 * elemento ancho (una fila del árbol) frente a uno chico (un botón de la
 * barra) daba saltos raros: desde un botón, ↓ podía ir a la quinta fila
 * porque su centro quedaba «más alineado» que el de la primera.
 *
 * Un candidato está en esa dirección si su centro avanza y su borde de ese
 * lado también (o al menos no retrocede). Se mide:
 * - `avance`: el hueco entre el borde del origen y el del candidato; negativo
 *   si se superponen (un panel de enlaces dentro de su panel), que así gana;
 * - `desvio`: el hueco en el otro eje (0 si se solapan en ese eje).
 *
 * Gana el de menor `avance + 2 * desvio`; a igualdad, el de centro más
 * cercano en la dirección del movimiento (desde un panel, el panel de enlaces
 * pegado antes que el otro panel que lo contiene), y después en el otro eje.
 * `null` si no hay nada de ese lado.
 */
export function vecinoPorCajas<T extends { caja: Caja }>(
  origen: Caja,
  candidatos: readonly T[],
  dir: Direccion,
): T | null {
  const cx = (c: Caja) => (c.left + c.right) / 2;
  const cy = (c: Caja) => (c.top + c.bottom) / 2;
  const horizontal = dir === "izquierda" || dir === "derecha";
  let mejor: { c: T; puntaje: number; eje: number; cruce: number } | null = null;
  for (const c of candidatos) {
    const k = c.caja;
    let avanza: boolean;
    let avance: number;
    switch (dir) {
      case "derecha":
        avanza = cx(k) > cx(origen) + 0.5 && k.right > origen.right - 0.5 && k.left >= origen.left - 1;
        avance = k.left - origen.right;
        break;
      case "izquierda":
        avanza = cx(k) < cx(origen) - 0.5 && k.left < origen.left + 0.5 && k.right <= origen.right + 1;
        avance = origen.left - k.right;
        break;
      case "abajo":
        avanza = cy(k) > cy(origen) + 0.5 && k.bottom > origen.bottom - 0.5 && k.top >= origen.top - 1;
        avance = k.top - origen.bottom;
        break;
      default:
        avanza = cy(k) < cy(origen) - 0.5 && k.top < origen.top + 0.5 && k.bottom <= origen.bottom + 1;
        avance = origen.top - k.bottom;
    }
    if (!avanza) continue;
    // Negativo solo si de verdad se superponen (en los dos ejes): una franja
    // que apenas toca el borde (la barra de estado, bajo el rail) no gana por eso.
    const solapeX = Math.min(k.right, origen.right) - Math.max(k.left, origen.left);
    const solapeY = Math.min(k.bottom, origen.bottom) - Math.max(k.top, origen.top);
    if (solapeX <= 0.5 || solapeY <= 0.5) {
      // Sin superponerse, tiene que estar de verdad más allá del borde: un
      // panel al lado, apenas más corto, tiene el centro un poco más arriba y
      // ganaba «arriba» a la barra superior (prueba en vivo del 2026-11-06).
      if (avance < -2) continue;
      avance = Math.max(0, avance);
    } else {
      // Uno dentro del otro: solo en la dirección en que está corrido (el
      // panel de enlaces está a la derecha de su panel, no abajo).
      const dPrincipal = horizontal ? Math.abs(cx(k) - cx(origen)) : Math.abs(cy(k) - cy(origen));
      const dCruce = horizontal ? Math.abs(cy(k) - cy(origen)) : Math.abs(cx(k) - cx(origen));
      if (dPrincipal < dCruce) continue;
    }
    const desvio = horizontal
      ? Math.max(0, k.top - origen.bottom, origen.top - k.bottom)
      : Math.max(0, k.left - origen.right, origen.left - k.right);
    const eje = horizontal ? Math.abs(cx(k) - cx(origen)) : Math.abs(cy(k) - cy(origen));
    const cruce = horizontal ? Math.abs(cy(k) - cy(origen)) : Math.abs(cx(k) - cx(origen));
    const puntaje = avance + 2 * desvio;
    const empate = mejor !== null && Math.abs(puntaje - mejor.puntaje) <= 0.5;
    if (
      mejor === null ||
      puntaje < mejor.puntaje - 0.5 ||
      (empate && eje < mejor.eje - 0.5) ||
      (empate && Math.abs(eje - mejor.eje) <= 0.5 && cruce < mejor.cruce)
    ) {
      mejor = { c, puntaje, eje, cruce };
    }
  }
  return mejor?.c ?? null;
}

// ── Tab ───────────────────────────────────────────────────────────────────

/** Dónde se pulsó Tab, para decidir si recorre controles. */
export type ContextoTab = {
  /** Dentro de un diálogo modal, un menú o una lista emergente. */
  enDialogo: boolean;
  /** Dentro de un componente que usa Tab: el editor (sangría), la consola, Excalidraw. */
  enComponenteConTab: boolean;
  /** En el workspace: dentro de una sección o sin foco (`body`). */
  enWorkspace: boolean;
};

/**
 * ¿Tab sigue recorriendo controles? En el workspace **no**: se navega con
 * Ctrl+flechas (decisión del usuario, 2026-11-06). Sí en los diálogos
 * (Configuración, la paleta, los menús) y en lo que fuera del workspace no
 * tiene otra forma de recorrerse (un aviso). Los componentes que usan Tab
 * para otra cosa (la sangría del editor, la shell) la atienden antes.
 */
export function tabRecorre(ctx: ContextoTab): boolean {
  if (ctx.enDialogo || ctx.enComponenteConTab) return true;
  return !ctx.enWorkspace;
}

// ── Ctrl+flechas ───────────────────────────────────────────────────────────

/** Dónde se pulsó Ctrl+flecha, para decidir si se mueve en el nivel. */
export type ContextoCtrlFlecha = {
  /**
   * Escribiendo en algo que se queda con Ctrl+flechas: el editor de notas
   * (saltar palabra, y lo que le den sus atajos), la consola, Excalidraw.
   */
  escribiendo: boolean;
  /** En un campo de texto (`input` de texto, `textarea`, `contenteditable`) fuera del editor. */
  enCampoDeTexto: boolean;
};

/**
 * ¿Ctrl+flecha se mueve en el nivel? Mientras se escribe, **no**: Ctrl+flechas
 * es del editor (y de la consola, de Excalidraw). En un campo de texto,
 * Ctrl+←/→ sigue siendo del campo (saltar palabra) y Ctrl+↑/↓ **sale** al
 * elemento vecino (un campo de una línea no los usa). En lo demás, sí.
 */
export function ctrlFlechaMueve(ctx: ContextoCtrlFlecha, dir: Direccion): boolean {
  if (ctx.escribiendo) return false;
  if (ctx.enCampoDeTexto) return dir === "arriba" || dir === "abajo";
  return true;
}

// ── Alt solo ─────────────────────────────────────────────────────────────

/**
 * Lo que se mira de cada tecla para reconocer **Alt solo**: el Alt izquierdo
 * apretado y soltado sin ninguna otra tecla (ni un clic) en el medio. Sale un
 * nivel, como Esc (segunda vuelta, 2026-11-06). El Alt derecho no cuenta: en
 * los teclados europeos y latinoamericanos es AltGr, que escribe (@, #) y es el
 * historial (AltGr+←/→).
 */
export type TeclaAlt = {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  /** `getModifierState("AltGraph")`: en Windows, AltGr llega como Ctrl+Alt. */
  altGr?: boolean;
};

/** El estado entre teclas: `true` mientras Alt solo sigue siendo posible. */
export type EstadoAltSolo = boolean;

/**
 * Un `keydown`: arma Alt solo si es el Alt izquierdo sin otros modificadores;
 * cualquier otra tecla lo desarma. La repetición de Alt (mantenerlo apretado)
 * lo deja armado.
 */
export function altSoloAlBajar(e: TeclaAlt): EstadoAltSolo {
  return e.code === "AltLeft" && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altGr;
}

/**
 * Un `keyup`: ¿fue Alt solo? Solo si se suelta el Alt izquierdo con Alt solo
 * armado y sin otros modificadores apretados.
 */
export function altSoloAlSoltar(estado: EstadoAltSolo, e: TeclaAlt): boolean {
  return estado && e.code === "AltLeft" && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altGr;
}

// ── las flechas dentro de un componente ─────────────────────────────────

/**
 * ¿Un componente con flechas propias (el grafo, las tarjetas de un lienzo, la
 * grilla del calendario, las filas de una tabla) atiende esta tecla como una
 * flecha? Las flechas solas siempre; con **Ctrl** (Cmd en macOS), solo si el
 * componente está dentro de un documento (`dentroDeDocumento`): ahí
 * Ctrl+flechas también navega, para que la regla sea la misma en todos los
 * niveles. En una sección (el mini-grafo del panel de enlaces), Ctrl+flechas es
 * de la sección: pasa al elemento vecino. Con Alt, nunca (Alt solo sale).
 */
export function flechaDelComponente(
  e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean },
  dentroDeDocumento: boolean,
): boolean {
  if (e.altKey) return false;
  return !(e.ctrlKey || e.metaKey) || dentroDeDocumento;
}

/**
 * ¿El elemento está dentro del documento de un panel (y no en su panel de
 * enlaces, que vive adentro pero es otra sección)? Para `flechaDelComponente`.
 */
export function dentroDeDocumento(el: Element): boolean {
  const doc = el.closest("[data-documento]");
  return doc !== null && el.closest("[data-zona]") === doc.closest("[data-zona]");
}
