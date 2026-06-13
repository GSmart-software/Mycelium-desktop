import type { TreeCarpeta } from "@/stores/vaultStore";

/**
 * Primer término significativo de la consulta, para posicionar el cursor en la
 * nota (HU-21 CA8): desarma frases entre comillas y el prefijo `tag:`/`#`.
 */
export function firstSearchTerm(query: string): string {
  const trimmed = query.trim();
  const phrase = trimmed.match(/"([^"]+)"/);
  if (phrase) return phrase[1];
  const first = trimmed.split(/\s+/)[0] ?? "";
  if (/^tag:/i.test(first)) return first.slice(4);
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
