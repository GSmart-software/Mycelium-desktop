import type { TreeCarpeta } from "@/stores/vaultStore";

/**
 * Primer término significativo de la consulta, para posicionar el cursor en la
 * nota (HU-21 CA8): desarma frases entre comillas, el prefijo `tag:`/`#` y los
 * filtros de propiedad `clave:valor` (FUN-M-04), de los que interesa el valor.
 */
export function firstSearchTerm(query: string): string {
  const trimmed = query.trim();
  const phrase = trimmed.match(/"([^"]+)"/);
  if (phrase) return phrase[1];
  const first = trimmed.split(/\s+/)[0] ?? "";
  if (/^tag:/i.test(first)) return first.slice(4);
  const filtro = /^[\p{L}_][\p{L}\p{N}_-]*:([^/].*)$/u.exec(first);
  if (filtro) return filtro[1].replace(/^"|"$/g, "");
  return first.replace(/^#/, "");
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

/**
 * Convierte el fragmento del backend (coincidencias marcadas con «…») en HTML
 * seguro: escapa el texto y resalta con <mark> (HU-21 CA4).
 */
export function fragmentToHtml(fragmento: string): string {
  return fragmento
    .replace(/[&<>]/g, (c) => ESCAPES[c])
    .replaceAll("«", '<mark class="mic-search-hit">')
    .replaceAll("»", "</mark>");
}

/** Ruta de carpetas de una nota: "Padre / Hijo" (HU-21 CA4, HU-30 CA9). */
export function folderPath(
  carpetaId: string | null,
  carpetas: TreeCarpeta[],
): string {
  if (!carpetaId) return "";
  const byId = new Map(carpetas.map((c) => [c.id, c]));
  const parts: string[] = [];
  let current = byId.get(carpetaId);
  while (current) {
    parts.unshift(current.nombre);
    current = current.padreId ? byId.get(current.padreId) : undefined;
  }
  return parts.join(" / ");
}

// ── Resultados como árbol de carpetas (`FUN-M-20`) ───────────────────────────

/** Lo mínimo que el agrupado necesita saber de un resultado. */
export type ResultadoAgrupable = { nota_id: string; carpeta_id: string | null };

/**
 * Un nodo del árbol de resultados: una carpeta con sus subcarpetas y las notas
 * que casaron dentro de ella.
 */
export type NodoResultados<R extends ResultadoAgrupable> = {
  id: string | null;
  nombre: string;
  hijos: NodoResultados<R>[];
  resultados: R[];
  /** Cuántos resultados hay aquí y en todo lo que cuelga debajo. */
  total: number;
};

/**
 * Agrupa los resultados por carpeta, al estilo del panel de búsqueda de VS Code.
 *
 * > [!important] Solo aparecen las carpetas que llevan a algo
 * > No es el árbol del vault filtrado: es el árbol **de los resultados**. Una
 * > carpeta entra si tiene resultados propios o si alguna de sus descendientes
 * > los tiene. Mostrar las vacías convertiría diez coincidencias en cien filas
 * > que hay que recorrer para encontrarlas, que es exactamente lo que la vista
 * > de árbol viene a evitar.
 *
 * Se conserva el **orden en que llegaron** los resultados dentro de cada
 * carpeta: el backend los devuelve por relevancia (`ORDER BY rank`), y
 * reordenarlos alfabéticamente tiraría esa información sin decirlo. Las
 * carpetas sí van por nombre, que es como se las busca con la vista.
 */
export function agruparEnArbol<R extends ResultadoAgrupable>(
  resultados: R[],
  carpetas: TreeCarpeta[],
): NodoResultados<R> {
  const porId = new Map(carpetas.map((c) => [c.id, c]));
  const raiz: NodoResultados<R> = { id: null, nombre: "", hijos: [], resultados: [], total: 0 };
  const nodos = new Map<string | null, NodoResultados<R>>([[null, raiz]]);

  /** Crea (o recupera) el nodo de una carpeta, creando antes sus ancestros. */
  function nodoDe(carpetaId: string | null): NodoResultados<R> {
    const ya = nodos.get(carpetaId);
    if (ya) return ya;
    const carpeta = carpetaId === null ? undefined : porId.get(carpetaId);
    // Una carpeta que el árbol no conoce —borrada, o todavía sin cargar— no
    // puede tragarse el resultado: cuelga de la raíz, que siempre existe.
    if (!carpeta) return raiz;
    const nodo: NodoResultados<R> = {
      id: carpeta.id,
      nombre: carpeta.nombre,
      hijos: [],
      resultados: [],
      total: 0,
    };
    nodos.set(carpeta.id, nodo);
    nodoDe(carpeta.padreId ?? null).hijos.push(nodo);
    return nodo;
  }

  for (const r of resultados) nodoDe(r.carpeta_id).resultados.push(r);

  /** Poda las ramas sin resultados y calcula los totales, de abajo hacia arriba. */
  function podar(nodo: NodoResultados<R>): number {
    nodo.hijos = nodo.hijos.filter((h) => podar(h) > 0);
    nodo.hijos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    nodo.total = nodo.resultados.length + nodo.hijos.reduce((t, h) => t + h.total, 0);
    return nodo.total;
  }
  podar(raiz);

  return raiz;
}
