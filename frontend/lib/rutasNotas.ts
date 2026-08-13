/**
 * Traducción entre el **id** de una nota y su **ruta** dentro del vault.
 *
 * Existe porque el formato JSON Canvas guarda `"file": "docs/BACKLOG.md"` —una
 * ruta, que es lo que hace que el archivo sea legible fuera de Mycelium— mientras
 * que la app trabaja con ids. En esta versión los dos coinciden; en **web** no,
 * y por eso este módulo diverge entre ramas (igual que `lib/confirmar.ts`).
 *
 * > [!important] No es un detalle interno: es interoperabilidad
 * > Si un canvas guardara el id en vez de la ruta, en web escribiría un UUID y
 * > el archivo dejaría de abrirse en Obsidian — que es justo lo que motivó
 * > adoptar el formato.
 */

/**
 * Ruta relativa de una nota. En el escritorio el id **es** la ruta (el vault son
 * archivos en una carpeta), así que no hay nada que traducir.
 */
export function rutaDeNota(notaId: string): string {
  return notaId;
}

/** Id de la nota que vive en esa ruta, o `null` si no existe ninguna. */
export function notaDeRuta(
  ruta: string,
  notas: { id: string }[],
): string | null {
  return notas.some((n) => n.id === ruta) ? ruta : null;
}
