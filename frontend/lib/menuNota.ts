import { EXTENSION_POR_TIPO } from "@/lib/extensionesDeTipo";
import {
  folderSegments,
  refUnivoca,
  type CarpetaEnlazable,
  type NotaEnlazable,
} from "@/lib/wikilinks";
import type { NotaTipo } from "@/stores/vaultStore";

/**
 * Lo puro del menú de una nota en el explorador (`FUN-S-32`): las carpetas a
 * las que se puede mover algo y el enlace que copia «Copiar enlace». Probado en
 * `scripts/test-menu-nota.mjs`.
 */

/** Una carpeta destino de «Mover a…». `id: null` es la raíz del vault. */
export type DestinoCarpeta = { id: string | null; ruta: string };

/** Minúsculas y sin tildes: «Árbol» se encuentra escribiendo «arbol». */
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Las carpetas a las que se puede mover algo, con su ruta, filtradas por
 * `consulta` (cada palabra tiene que aparecer en la ruta) y ordenadas por ruta,
 * con la raíz primero.
 *
 * - `actual`: la carpeta donde ya está (`null` = raíz). No se ofrece: mover
 *   ahí no haría nada.
 * - `excluir`: carpetas a las que no se puede ir. Al mover una carpeta, ella
 *   misma y todo su subárbol (no se mete dentro de sí misma, HU-24 CA6).
 */
export function destinosDeMover(
  carpetas: readonly CarpetaEnlazable[],
  { actual, excluir = new Set<string>() }: { actual: string | null; excluir?: ReadonlySet<string> },
  consulta = "",
): DestinoCarpeta[] {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  const todas: DestinoCarpeta[] = [
    { id: null, ruta: "/" },
    ...carpetas
      .filter((c) => !excluir.has(c.id))
      .map((c) => ({ id: c.id, ruta: folderSegments(c.id, carpetas).join("/") }))
      .sort((a, b) => a.ruta.localeCompare(b.ruta, "es", { sensitivity: "base" })),
  ];
  return todas.filter((d) => {
    if (d.id === actual) return false;
    const ruta = normalizar(d.id === null ? "/ raiz del vault" : d.ruta);
    return palabras.every((p) => ruta.includes(p));
  });
}

/**
 * El `[[enlace]]` que lleva a `nota`, el que copia «Copiar enlace».
 *
 * - Una nota: su título, o `Carpeta/título` si hay otra con el mismo nombre
 *   (`refUnivoca`, lo mismo que inserta el autocompletado).
 * - Un lienzo, una base, un dibujo o un diagrama: con su extensión, porque sin
 *   ella una nota homónima le ganaría (`wikilinks.ts`, regla 4) y porque así
 *   se escriben en Obsidian.
 */
export function enlaceANota<N extends NotaEnlazable & { tipo: NotaTipo }>(
  nota: N,
  notas: readonly N[],
  carpetas: readonly CarpetaEnlazable[],
): string {
  if (nota.tipo === "markdown") return `[[${refUnivoca(nota, notas, carpetas)}]]`;
  // Entre las del mismo tipo: la extensión ya descarta a las demás.
  const mismas = notas.filter((n) => n.tipo === nota.tipo);
  return `[[${refUnivoca(nota, mismas, carpetas)}.${EXTENSION_POR_TIPO[nota.tipo]}]]`;
}
