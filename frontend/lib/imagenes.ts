/**
 * Imágenes del vault dentro de una nota (`DEF-126`): a qué archivo apunta cada
 * forma de embeberlas. Módulo **puro** —sin store, sin DOM, sin Tauri— para
 * que lo compartan la vista de lectura, la vista en vivo y la exportación, y
 * para poder probarlo sin navegador (`scripts/test-imagenes.mjs`).
 *
 * Las dos formas siguen la convención de Obsidian:
 *
 * - `![[foto.png]]` (y `![[foto.png|300]]`, `![[foto.png|300x200]]`): por
 *   **nombre** entre las imágenes del vault; con carpeta
 *   (`![[Adjuntos/foto.png]]`) la ruta desambigua; entre homónimos sin pista,
 *   el de ruta más corta.
 * - `![alt](ruta)`: relativa a la **carpeta de la nota**; si ahí no está, a la
 *   **raíz del vault**; y si la ruta es un nombre suelto, por nombre como el
 *   wikilink (es lo que escribe Obsidian con «ruta más corta posible»). Las
 *   `http(s)://` y `data:` se usan tal cual.
 *
 * > [!important] Las imágenes NO son notas
 * > No están en el índice ni en `vaultStore.notas`: se buscan en la lista de
 * > «otros archivos» (`vaultStore.otros`, `FUN-S-03`). Por eso `resolveWikilink`
 * > no servía: ahí nunca hubo una imagen que encontrar.
 */

/**
 * Extensiones que se muestran como imagen en el visor de archivos
 * (`lib/otrosArchivos.ts`). `svg` **no** está: abierto solo, el webview lo
 * trataría como documento (scripts incluidos).
 */
export const EXTENSIONES_IMAGEN: ReadonlySet<string> = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif",
]);

/**
 * Lo que se acepta **embebido en una nota**: lo de arriba más `svg`. Dentro de
 * un `<img>` un SVG es solo una imagen —el navegador no ejecuta sus scripts ni
 * carga lo que referencia—, así que acá no hay el riesgo que tiene en el visor.
 */
const EMBEBIBLES = new Set([...EXTENSIONES_IMAGEN, "svg"]);

/** Extensión en minúsculas y sin punto del último segmento de una ruta. */
function extension(ruta: string): string {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  const punto = nombre.lastIndexOf(".");
  return punto <= 0 ? "" : nombre.slice(punto + 1).toLowerCase();
}

/** ¿La referencia apunta (por su extensión) a una imagen que se puede embeber? */
export function esRefDeImagen(ref: string): boolean {
  return EMBEBIBLES.has(extension(ref.trim()));
}

/** Ancho y alto pedidos con `|300` o `|300x200`. */
export type Tamano = { ancho: number; alto?: number };

/** `300` → ancho; `300x200` → ancho y alto. Cualquier otra cosa no es tamaño. */
export function leerTamano(texto: string): Tamano | null {
  const m = /^\s*(\d{1,5})(?:\s*x\s*(\d{1,5}))?\s*$/i.exec(texto);
  if (!m) return null;
  const ancho = Number(m[1]);
  if (ancho <= 0) return null;
  const alto = m[2] === undefined ? undefined : Number(m[2]);
  return alto ? { ancho, alto } : { ancho };
}

/**
 * Parte el interior de `![[…]]` en destino, texto alternativo y tamaño:
 * `foto.png|300` → tamaño; `foto.png|una foto` → alternativo. La barra puede
 * venir escapada (`\|`) dentro de una tabla, como en los wikilinks (`DEF-045`).
 */
export function partirEmbedImagen(interior: string): {
  destino: string;
  alt: string;
  tamano: Tamano | null;
} {
  const sep = /\\?\|/.exec(interior);
  if (sep === null) return { destino: interior.trim(), alt: "", tamano: null };
  const destino = interior.slice(0, sep.index).trim();
  const resto = interior.slice(sep.index + sep[0].length);
  const tamano = leerTamano(resto);
  return { destino, alt: tamano ? "" : resto.trim(), tamano };
}

/**
 * El alternativo de `![alt|300](ruta)`: Obsidian acepta el tamaño también ahí,
 * al final del texto alternativo.
 */
export function partirAltMarkdown(alt: string): { alt: string; tamano: Tamano | null } {
  const i = alt.lastIndexOf("|");
  if (i === -1) return { alt, tamano: null };
  const tamano = leerTamano(alt.slice(i + 1));
  return tamano ? { alt: alt.slice(0, i).trim(), tamano } : { alt, tamano: null };
}

/** ¿Una URL que el webview carga por su cuenta (`http(s)://`, `data:`)? */
export function esUrlExterna(url: string): boolean {
  return /^(?:https?:\/\/|data:)/i.test(url.trim());
}

/**
 * La ruta de `![](…)` tal como la escribió el usuario, lista para buscarla:
 * sin los `<…>` de una ruta con espacios, con `%20` y compañía decodificados y
 * con las barras de Windows pasadas a `/`.
 */
export function limpiarRutaMarkdown(url: string): string {
  let r = url.trim();
  if (r.startsWith("<") && r.endsWith(">")) r = r.slice(1, -1).trim();
  try {
    r = decodeURI(r);
  } catch {
    // Un `%` suelto (un archivo que se llama «50%.png») no es un escape: se
    // busca tal cual.
  }
  return r.replace(/\\/g, "/");
}

/**
 * Une segmentos resolviendo `.` y `..`. `null` si la ruta se sale del vault
 * por arriba: eso no es una imagen del vault y no se va a buscar fuera.
 */
export function normalizarRuta(ruta: string): string | null {
  const salida: string[] = [];
  for (const seg of ruta.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (salida.length === 0) return null;
      salida.pop();
      continue;
    }
    salida.push(seg);
  }
  return salida.length === 0 ? null : salida.join("/");
}

/**
 * Índice de las imágenes del vault para resolver muchas referencias seguidas
 * sin recorrer la lista cada vez. Se arma con las rutas relativas POSIX de
 * `vaultStore.otros`; lo que no es imagen se descarta.
 *
 * Las comparaciones no distinguen mayúsculas: el vault vive en un disco de
 * Windows, donde `Foto.PNG` y `foto.png` son el mismo archivo.
 */
export type IndiceImagenes = {
  /** Ruta en minúsculas → ruta real. */
  porRuta: Map<string, string>;
  /** Nombre (con extensión) en minúsculas → rutas reales con ese nombre. */
  porNombre: Map<string, string[]>;
};

export function indexarImagenes(rutas: readonly string[]): IndiceImagenes {
  const porRuta = new Map<string, string>();
  const porNombre = new Map<string, string[]>();
  for (const ruta of rutas) {
    if (!EMBEBIBLES.has(extension(ruta))) continue;
    porRuta.set(ruta.toLowerCase(), ruta);
    const nombre = ruta.slice(ruta.lastIndexOf("/") + 1).toLowerCase();
    const lista = porNombre.get(nombre);
    if (lista) lista.push(ruta);
    else porNombre.set(nombre, [ruta]);
  }
  return { porRuta, porNombre };
}

/** Profundidad y luego orden alfabético: el desempate de Obsidian. */
function masCorta(a: string, b: string): number {
  return a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * `![[ref]]` → ruta relativa de la imagen, o `null` si no hay ninguna.
 *
 * Por nombre; los segmentos anteriores al nombre son una **pista de carpeta**:
 * se quedan solo las imágenes cuya carpeta termina en ellos, y si ninguna
 * calza no hay destino (como los wikilinks a notas, `DEF-120`: `Otra/x.png` no
 * debe llevar a la `x.png` de otra carpeta).
 */
export function resolverEmbedImagen(ref: string, indice: IndiceImagenes): string | null {
  const partes = ref
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (partes.length === 0) return null;
  const nombre = partes[partes.length - 1].toLowerCase();
  let candidatos = indice.porNombre.get(nombre) ?? [];
  if (partes.length > 1) {
    const pista = partes.slice(0, -1).join("/").toLowerCase();
    candidatos = candidatos.filter((ruta) => {
      const carpeta = ruta.slice(0, Math.max(ruta.lastIndexOf("/"), 0)).toLowerCase();
      return carpeta === pista || carpeta.endsWith(`/${pista}`);
    });
  }
  if (candidatos.length === 0) return null;
  return [...candidatos].sort(masCorta)[0];
}

/**
 * `![](ruta)` → ruta relativa de la imagen, o `null` si no está en el vault.
 *
 * `carpetaNota` es la carpeta de la nota que la contiene (`null` = raíz). Una
 * ruta que empieza con `/` es desde la raíz del vault.
 */
export function resolverRutaImagen(
  url: string,
  carpetaNota: string | null,
  indice: IndiceImagenes,
): string | null {
  const ruta = limpiarRutaMarkdown(url);
  if (ruta === "" || esUrlExterna(ruta)) return null;
  const desdeRaiz = ruta.startsWith("/");
  const intentos: (string | null)[] = [];
  if (!desdeRaiz && carpetaNota) intentos.push(normalizarRuta(`${carpetaNota}/${ruta}`));
  intentos.push(normalizarRuta(ruta));
  for (const intento of intentos) {
    if (intento === null) continue;
    const real = indice.porRuta.get(intento.toLowerCase());
    if (real !== undefined) return real;
  }
  // Un nombre suelto que no está ni junto a la nota ni en la raíz se busca por
  // nombre, como `![[…]]`: Obsidian escribe así los enlaces con su formato
  // «ruta más corta posible», y la imagen suele vivir en `Adjuntos/`.
  if (!desdeRaiz && !ruta.includes("/")) return resolverEmbedImagen(ruta, indice);
  return null;
}

/**
 * `![[…]]` en el texto de una línea. Es la forma de todos los embeds; quien la
 * usa se queda con los que `esRefDeImagen` reconoce (los `.excalidraw` y
 * `.drawio` tienen su propio camino).
 */
export function embedWikiRe(): RegExp {
  return /!\[\[([^[\]]+)\]\]/g;
}

/**
 * `![alt](ruta)` en el texto de una línea, para la vista en vivo (la de lectura
 * usa el árbol de remark). Acepta `<ruta con espacios>` y un título opcional
 * (`![](x.png "título")`). Grupo 1: el alternativo; grupo 2: la ruta.
 */
export function embedMarkdownRe(): RegExp {
  return /!\[([^\]]*)\]\((<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
}
