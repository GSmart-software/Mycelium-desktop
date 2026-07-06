/**
 * Construcción de la query FTS5 a partir del texto del usuario (HU-21 CA5/6/7).
 * Portado 1:1 de `SearchEndpoints.BuildFtsQuery`: AND implícito, frases entre
 * comillas, `tag:x`/`#x` buscan el tag; cada término se entrecomilla para
 * neutralizar operadores FTS y (en modo coincidencia) se le añade `*` de prefijo.
 */
export function buildFtsQuery(raw: string, prefix = false): string {
  const parts: string[] = [];
  const star = prefix ? "*" : "";
  const re = /"[^"]+"|\S+/g;

  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    let text = m[0];

    if (text.startsWith('"') && text.endsWith('"') && text.length > 2) {
      parts.push(`"${text.slice(1, -1).replaceAll('"', '""')}"${star}`);
      continue;
    }

    if (text.toLowerCase().startsWith("tag:") && text.length > 4) {
      text = "#" + text.slice(4);
    }

    const sanitized = text.replaceAll('"', '""');
    if (sanitized.length > 0) parts.push(`"${sanitized}"${star}`);
  }

  return parts.join(" ");
}
