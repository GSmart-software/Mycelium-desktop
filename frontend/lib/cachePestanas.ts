import { allLeaves, useTabsStore, type PaneNode } from "@/stores/tabsStore";
import { useSidebarViewerStore } from "@/stores/sidebarViewerStore";

/**
 * Estado en memoria que vive lo que vive una PESTAÑA (`FUN-M-58`).
 *
 * El editor recuerda por pestaña su texto, el cursor, el scroll y los
 * plegados para restaurarlos al volver (`DEF-039`, `DEF-065`). Eso tiene que
 * sobrevivir a cambiar de pestaña —el editor se desmonta— y morir al cerrarla.
 * Antes solo se escribía: cada pestaña cerrada, y cada nota por la que pasaba
 * una pestaña al navegar (navegar le cambia el id), dejaba su entrada para
 * siempre, con hasta dos copias del texto (`doc` y `conocido`). En una sesión
 * de 200 notas visitadas de ~20 KB eran ~8 MB que nadie iba a volver a leer.
 *
 * El componente **no puede** distinguir un cierre de un cambio de pestaña: en
 * los dos casos se desmonta igual. Quien sabe la diferencia es el store de
 * pestañas, así que acá se mira el árbol (el mismo criterio que
 * `lib/drawioInstancias.ts`):
 *
 * - Un barrido, con cada cambio del árbol, suelta las entradas cuya pestaña ya
 *   no existe. Cubre las pestañas que se cierran sin verse.
 * - Al desmontarse, el editor pregunta `pestanaAbierta` antes de guardar su
 *   estado: el store se actualiza ANTES de que React desmonte, así que al
 *   cerrar la pestaña visible el barrido ya pasó, y si el editor la guardara
 *   después, la entrada quedaría huérfana.
 *
 * Las claves son ids de pestaña, que son únicos: la misma nota abierta en dos
 * paneles son dos pestañas y dos entradas, y cerrar una no toca la otra.
 * «Reabrir pestaña cerrada» (Ctrl+Shift+T) crea una pestaña nueva, con id
 * nuevo, así que nunca leyó lo que deja la cerrada: la nota se reabre desde el
 * disco y arriba, como se especificó en `DEF-065`.
 */

/**
 * Prefijo de las instancias del panel lateral, que no son pestañas del árbol:
 * viven mientras el documento siga anclado ahí (`stores/sidebarViewerStore`).
 */
export const CLAVE_LATERAL_EDITOR = "sidebar-";

/** Los `Map` atados a la vida de las pestañas. */
const atados = new Set<Map<string, unknown>>();

/** ¿La clave es de algo que sigue abierto, dados los ids vivos? */
export function claveViva(
  clave: string,
  pestanas: ReadonlySet<string>,
  lateral: readonly string[],
): boolean {
  if (clave.startsWith(CLAVE_LATERAL_EDITOR)) return lateral.includes(clave.slice(CLAVE_LATERAL_EDITOR.length));
  return pestanas.has(clave);
}

function idsDePestanas(root: PaneNode): Set<string> {
  const ids = new Set<string>();
  for (const hoja of allLeaves(root)) for (const t of hoja.tabs) ids.add(t.id);
  return ids;
}

/**
 * ¿Sigue abierta la pestaña (o el documento del panel lateral) `clave`? Es lo
 * que pregunta el editor al desmontarse para saber si lo suyo vale guardarlo.
 */
export function pestanaAbierta(clave: string): boolean {
  if (clave.startsWith(CLAVE_LATERAL_EDITOR)) {
    return useSidebarViewerStore.getState().tabs.includes(clave.slice(CLAVE_LATERAL_EDITOR.length));
  }
  for (const hoja of allLeaves(useTabsStore.getState().root)) {
    if (hoja.tabs.some((t) => t.id === clave)) return true;
  }
  return false;
}

/**
 * Ata un `Map` por id de pestaña a la vida de las pestañas: sus entradas se
 * sueltan cuando la pestaña se cierra. Devuelve el mismo `Map`.
 */
export function atarAPestanas<M extends Map<string, unknown>>(mapa: M): M {
  atados.add(mapa);
  return mapa;
}

// Lo último barrido: el store cambia por muchas cosas (arrastres, foco de un
// panel) que no tocan qué pestañas existen, y esas no recorren nada.
let ultimoRoot: PaneNode | null = null;
let ultimoLateral: readonly string[] | null = null;

/** Suelta de todos los `Map` atados lo que ya no tiene pestaña. */
export function barrerPestanasCerradas(): void {
  const root = useTabsStore.getState().root;
  const lateral = useSidebarViewerStore.getState().tabs;
  if (root === ultimoRoot && lateral === ultimoLateral) return;
  ultimoRoot = root;
  ultimoLateral = lateral;
  let hayAlgo = false;
  for (const m of atados) if (m.size > 0) hayAlgo = true;
  if (!hayAlgo) return;
  const pestanas = idsDePestanas(root);
  for (const m of atados) {
    for (const clave of [...m.keys()]) {
      if (!claveViva(clave, pestanas, lateral)) m.delete(clave);
    }
  }
}

if (typeof window !== "undefined") {
  useTabsStore.subscribe(barrerPestanasCerradas);
  useSidebarViewerStore.subscribe(barrerPestanasCerradas);
}
