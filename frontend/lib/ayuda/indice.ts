import { TEMAS_AYUDA, type PaginaAyuda, type TemaAyuda } from "@/lib/ayuda/paginasGeneradas";

/**
 * El índice de la ayuda (`FUN-L-27`): qué páginas se muestran en esta versión,
 * en qué orden, cómo se resuelve un enlace `ayuda:` y el buscador.
 *
 * Sin React ni DOM, para que `scripts/test-ayuda.mjs` lo pruebe tal cual.
 */

/**
 * La versión de Mycelium que muestra esta ayuda. Una página con `solo: web`
 * no aparece acá; al reflejar a web, esta constante pasa a `"web"` y
 * desaparecen la terminal, draw.io, el visor y el MCP.
 */
export const VERSION_AYUDA: "desktop" | "web" = "desktop";

/** Los temas de esta versión, cada uno con sus páginas de esta versión. */
export const TEMAS: readonly TemaAyuda[] = TEMAS_AYUDA.map((t) => ({
  ...t,
  paginas: t.paginas.filter((p) => p.solo === null || p.solo === VERSION_AYUDA),
})).filter((t) => t.paginas.length > 0);

/** Todas las páginas, en orden de índice. */
export const PAGINAS: readonly PaginaAyuda[] = TEMAS.flatMap((t) => t.paginas);

/** Dónde arranca la ayuda la primera vez. */
export const PAGINA_INICIAL = "primeros-pasos/que-es-un-vault";

const POR_ID = new Map(PAGINAS.map((p) => [p.id, p]));

export function paginaPorId(id: string | null | undefined): PaginaAyuda | null {
  return (id && POR_ID.get(id)) || null;
}

/** El tema de una página. */
export function temaDe(id: string): TemaAyuda | null {
  return TEMAS.find((t) => t.paginas.some((p) => p.id === id)) ?? null;
}

/**
 * ¿El tema es una sola página con su mismo nombre? («Atajos de teclado»). Se
 * muestra como una hoja del índice, sin plegar, y sin miga repetida.
 */
export function esTemaHoja(t: TemaAyuda): boolean {
  return t.paginas.length === 1 && t.paginas[0].titulo === t.titulo;
}

/** La página escrita anterior y la siguiente (las «próximamente» se saltan). */
export function vecinas(id: string): { anterior: PaginaAyuda | null; siguiente: PaginaAyuda | null } {
  const escritas = PAGINAS.filter((p) => !p.pendiente || p.id === id);
  const i = escritas.findIndex((p) => p.id === id);
  if (i < 0) return { anterior: null, siguiente: null };
  return { anterior: escritas[i - 1] ?? null, siguiente: escritas[i + 1] ?? null };
}

/** El esquema de los enlaces entre páginas: `[Tareas](ayuda:escribir-notas/tareas)`. */
export const ESQUEMA_AYUDA = "ayuda:";

/** El id de página de un `href` `ayuda:…`, o `null` si no es un enlace de ayuda. */
export function idDeEnlace(href: string | null | undefined): string | null {
  if (!href || !href.startsWith(ESQUEMA_AYUDA)) return null;
  return decodeURIComponent(href.slice(ESQUEMA_AYUDA.length)).replace(/^\/+|\/+$/g, "");
}

/** Los ids de todos los enlaces `ayuda:` de un Markdown (para el test). */
export function enlacesDeAyuda(md: string): string[] {
  return [...md.matchAll(/\]\((ayuda:[^)\s]+)\)/g)].map((m) => idDeEnlace(m[1])!);
}

/** Sin tildes ni mayúsculas: «enfasis» encuentra «Énfasis» (como en Configuración). */
export const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type HallazgoAyuda = {
  pagina: PaginaAyuda;
  /** Un trozo del texto alrededor de la coincidencia, si la hubo en el contenido. */
  fragmento: string | null;
};

/** Cuánto texto se muestra a cada lado de la coincidencia. */
const CONTEXTO = 40;

function fragmentoDe(texto: string, normal: string, palabra: string): string | null {
  const i = normal.indexOf(palabra);
  if (i < 0) return null;
  // `normalizar` quita las marcas combinantes: sobre texto en NFC cada carácter
  // sigue ocupando un lugar, así que el índice vale para el original.
  const base = normal.length === texto.length ? texto : normal;
  const desde = Math.max(0, i - CONTEXTO);
  const hasta = Math.min(base.length, i + palabra.length + CONTEXTO);
  return `${desde > 0 ? "…" : ""}${base.slice(desde, hasta).trim()}${hasta < base.length ? "…" : ""}`;
}

/**
 * Busca por título, sinónimos, tema y contenido. Todas las palabras de la
 * consulta tienen que aparecer en algún lado; ordena título > sinónimo > tema
 * > contenido, y a igualdad, por orden del índice.
 */
export function buscarEnAyuda(consulta: string, max = 30): HallazgoAyuda[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];
  const salida: { h: HallazgoAyuda; puntos: number; orden: number }[] = [];
  PAGINAS.forEach((p, orden) => {
    const titulo = normalizar(p.titulo);
    const sinonimos = p.sinonimos.map(normalizar);
    const tema = normalizar(p.tema);
    const texto = normalizar(p.texto);
    let puntos = 0;
    for (const w of palabras) {
      if (titulo.startsWith(w)) puntos += 0;
      else if (titulo.includes(w)) puntos += 1;
      else if (sinonimos.some((s) => s.includes(w))) puntos += 2;
      else if (tema.includes(w)) puntos += 3;
      else if (texto.includes(w)) puntos += 4;
      else return;
    }
    const enTitulo = palabras.every((w) => titulo.includes(w));
    const enTexto = palabras.find((w) => texto.includes(w));
    salida.push({
      h: { pagina: p, fragmento: enTitulo || !enTexto ? null : fragmentoDe(p.texto, texto, enTexto) },
      puntos,
      orden,
    });
  });
  return salida
    .sort((a, b) => a.puntos - b.puntos || a.orden - b.orden)
    .slice(0, max)
    .map((x) => x.h);
}
