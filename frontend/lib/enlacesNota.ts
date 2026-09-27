/**
 * Qué enlaces y qué etiquetas salen del texto de una nota (`FUN-L-25`, Parte A ·
 * `DEF-109`). Es lo que antes calculaba `lib/db/grafo.ts` **en cada consulta**
 * —leyendo el contenido de todo el vault y escaneándolo— y ahora se calcula una
 * vez, al indexar o al guardar, y se guarda en las tablas `enlaces` y
 * `etiquetas` del índice. El grafo, las conexiones y la barra de estado leen
 * esas tablas y no vuelven a tocar el texto.
 *
 * Módulo **puro** a propósito: lo importan el indexador y el guardado, y
 * `scripts/test-enlaces-nota.mjs` lo transpila e importa sin build, igual que
 * `lib/wikilinks.ts`. Sus imports también son puros.
 *
 * > [!important] La regla es la de antes, movida, no reescrita
 * > - Los wikilinks se buscan en el texto COMPLETO —un `[[enlace]]` en una
 * >   propiedad del frontmatter cuenta (`FUN-M-04`)— pero **sin el código**
 * >   (`DEF-102`): un `[[x]]` escrito para mostrar la sintaxis no es un enlace.
 * > - Una base, un canvas y un `.drawio` NO se escanean como prosa: la base es
 * >   la definición de una consulta, el canvas es JSON (sus referencias se leen
 * >   entendiendo el formato: `referenciasDe`) y el `.drawio` es XML de mxGraph.
 * >   Los tres sí son destinos válidos.
 * > - Las etiquetas son las de `tags:` del frontmatter más los `#tag` del
 * >   cuerpo, sin el código; solo de lo que se escanea como prosa.
 * >
 * > La única diferencia deliberada es el ancla (`[[Nota#Sección]]`). Antes
 * > viajaba al resolutor, que buscaba una nota llamada «Nota#Sección», no la
 * > encontraba y el enlace no llegaba al grafo; Obsidian lo cuenta como un
 * > enlace a `Nota`, y ahora también Mycelium. Pero el texto se guarda CON el
 * > ancla y se resuelve primero entero: en los vaults reales hay títulos y
 * > carpetas con `#` («Q# y Quantum…», «C#/Estudio/…») que resolvían por el
 * > texto completo, y quitarles el ancla a ciegas los rompía.
 */
import { referenciasDe } from "@/lib/canvas";
import { EXTENSIONES_DE_NOTA } from "@/lib/extensionesDeTipo";
import { etiquetasDe } from "@/lib/frontmatter";
import { sinCodigo } from "@/lib/sinCodigo";
import {
  partirWikilink,
  resolveWikilinkEnIndice,
  type CarpetaEnlazable,
  type NotaEnlazable,
} from "@/lib/wikilinks";

const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

/**
 * De dónde sale una fila de `enlaces`:
 * - `enlace`: un `[[x]]` en la prosa;
 * - `embed`: un `![[x]]` en la prosa;
 * - `canvas`: un `[[x]]` dentro de una tarjeta de texto de un canvas;
 * - `archivo`: una tarjeta de nota de un canvas. Guarda una **ruta**, no un
 *   título, y se resuelve distinto: en desktop el id de una nota ES su ruta.
 */
export type TipoEnlace = "enlace" | "embed" | "canvas" | "archivo";

/** Una fila de `enlaces` antes de resolverla: qué se escribió y cuántas veces. */
export type EnlaceDerivado = {
  /**
   * Lo escrito dentro del `[[…]]`, sin alias y CON el ancla si la tenía (ver la
   * cabecera); o la ruta, si es `archivo`.
   */
  texto: string;
  tipo: TipoEnlace;
  /** Cuántas veces aparece con el mismo texto y tipo en la nota. */
  n: number;
};

/** Tipos cuyo contenido no se escanea como prosa (ver la cabecera). */
const NO_ES_PROSA = new Set(["base", "canvas", "drawio"]);

/**
 * Las formas sin ancla de una referencia, de la más larga a la más corta. El
 * ancla vive en el ÚLTIMO segmento (`C#/Nota#Sección`: la carpeta `C#` no es un
 * ancla), y puede empezar en su primer `#` (`Nota#H1#H2`, encabezado anidado)
 * o en el último (`Q# y Quantum#Intro`, un título con `#`): se prueban las
 * dos, la más larga primero porque es la más específica. Sin `#` en el último
 * segmento, ninguna.
 */
export function cortesDeAncla(destino: string): string[] {
  const i = destino.lastIndexOf("/");
  const dir = destino.slice(0, i + 1);
  const seg = destino.slice(i + 1);
  const primero = seg.indexOf("#");
  if (primero < 0) return [];
  const corto = (dir + seg.slice(0, primero)).trim();
  const largo = (dir + seg.slice(0, seg.lastIndexOf("#"))).trim();
  return largo === corto ? [corto] : [largo, corto];
}

/** `Nota#Sección` o `Nota#^bloque` → `Nota` (el corte en el primer `#`). `[[#Sección]]` da "". */
export function sinAncla(destino: string): string {
  const cortes = cortesDeAncla(destino);
  return cortes.length === 0 ? destino.trim() : cortes[cortes.length - 1];
}

/**
 * Los enlaces que salen de una nota, agrupados por `(tipo, texto)` en el orden
 * en que aparecen por primera vez. Un `.base` o un `.drawio` no tiene ninguno;
 * un canvas, los de sus tarjetas.
 */
export function derivarEnlaces(contenido: string, tipo: string): EnlaceDerivado[] {
  const porClave = new Map<string, EnlaceDerivado>();
  const sumar = (texto: string, t: TipoEnlace) => {
    // Un `[[#Sección]]` es un salto dentro de la misma nota: ni arista ni roto.
    if (texto === "" || (t !== "archivo" && sinAncla(texto) === "")) return;
    const k = `${t}\u0000${texto}`;
    const previo = porClave.get(k);
    if (previo) previo.n++;
    else porClave.set(k, { texto, tipo: t, n: 1 });
  };

  if (tipo === "canvas") {
    // Qué aporta un canvas al grafo (`docs/features/canvas.md` § 5): los
    // `[[enlaces]]` de sus tarjetas de texto y las tarjetas de nota, que son una
    // referencia explícita como un embed. Las FLECHAS no: son disposición.
    const { titulos, rutas } = referenciasDe(contenido);
    for (const t of titulos) sumar(t.trim(), "canvas");
    for (const r of rutas) sumar(r, "archivo");
    return [...porClave.values()];
  }
  if (NO_ES_PROSA.has(tipo) || contenido === "") return [];

  const texto = sinCodigo(contenido);
  for (let m = WIKILINK_RE.exec(texto); m !== null; m = WIKILINK_RE.exec(texto)) {
    // `[[destino|alias]]` y `[[Carpeta/destino]]` → el destino sin el alias, CON
    // la ruta, que es la pista para desambiguar homónimas. La barra puede venir
    // escapada dentro de una tabla (`DEF-045`). Un embed `![[x.excalidraw]]`
    // conserva la extensión: la quita el resolutor.
    const esEmbed = m.index > 0 && texto[m.index - 1] === "!";
    sumar(partirWikilink(m[1]).destino, esEmbed ? "embed" : "enlace");
  }
  return [...porClave.values()];
}

/**
 * Las etiquetas de una nota: `tags:` del frontmatter más los `#tag` del cuerpo
 * (`FUN-M-04`), sin el código. Lo que no se escanea como prosa no tiene.
 */
export function derivarEtiquetas(contenido: string, tipo: string): string[] {
  if (NO_ES_PROSA.has(tipo) || contenido === "") return [];
  return etiquetasDe(contenido, sinCodigo);
}

/**
 * La clave por la que se re-resuelve una fila: el último segmento de la
 * referencia, en minúsculas —lo mismo que `resolveWikilinkEnIndice` busca en el
 * índice por título—. `Carpeta/Plan` → `plan`; `Boceto.excalidraw` →
 * `boceto.excalidraw`; una ruta `A/B/Nota.md` → `nota.md`.
 *
 * Se calcula en JS y se guarda en la columna `enlaces.clave` porque el `lower()`
 * de SQLite solo pasa a minúsculas el ASCII: `lower('Árbol')` es `Árbol`, y la
 * re-resolución de un título con tildes no habría encontrado sus filas.
 */
export function claveDeEnlace(texto: string): string {
  const partes = texto
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return partes.length === 0 ? "" : partes[partes.length - 1].toLowerCase();
}

/**
 * La segunda clave de una fila con ancla: la de su texto cortado en el primer
 * `#` del último segmento (`Plan#Objetivos` → `plan`), por donde resuelve si el
 * texto entero no resuelve. `null` si no tiene ancla. Va en la columna
 * `enlaces.clave_ancla`. El corte en el último `#` no necesita columna propia:
 * ver `clavesDeTitulo`.
 */
export function claveSinAncla(texto: string): string | null {
  return cortesDeAncla(texto).length === 0 ? null : claveDeEnlace(sinAncla(texto));
}

/**
 * Las claves de las filas cuya resolución puede cambiar cuando aparece,
 * desaparece o se mueve una nota con este título: el título mismo y el título
 * con cada extensión de nota (el resolutor prueba sin la extensión si no hubo
 * coincidencia exacta, así que `[[x.excalidraw]]` depende de la nota `x`).
 */
export function clavesDeTitulo(titulo: string): string[] {
  const t = titulo.toLowerCase();
  const claves = [t, ...EXTENSIONES_DE_NOTA.map((e) => `${t}.${e}`)];
  // Un título con `#` («Q# y Quantum») lo alcanza `[[Q# y Quantum#Intro]]` por el
  // corte en el ÚLTIMO `#`, y esa fila tiene como `clave_ancla` el corte en el
  // primero: `q`. Es la misma para el título, así que se busca también por ella.
  const i = t.indexOf("#");
  if (i >= 0) claves.push(t.slice(0, i).trim());
  return claves;
}

/**
 * A qué nota apunta una fila, con el resolutor único (`FUN-M-40`, D8): el
 * texto entero y, si no resuelve y tiene ancla, el texto sin el ancla. Una
 * tarjeta de nota de un canvas guarda la ruta, que en desktop es el id: apunta a
 * esa nota si existe. `ids` son las notas que pueden ser destino —las que no
 * están en la papelera—, las mismas que forman `porTitulo`.
 */
export function resolverEnlace<N extends NotaEnlazable>(
  enlace: { tipo: string; texto: string },
  porTitulo: Map<string, N[]>,
  carpetas: readonly CarpetaEnlazable[],
  ids: ReadonlySet<string>,
): string | null {
  if (enlace.tipo === "archivo") return ids.has(enlace.texto) ? enlace.texto : null;
  const entero = resolveWikilinkEnIndice(enlace.texto, porTitulo, carpetas);
  if (entero) return entero.id;
  for (const corte of cortesDeAncla(enlace.texto)) {
    const nota = corte === "" ? undefined : resolveWikilinkEnIndice(corte, porTitulo, carpetas);
    if (nota) return nota.id;
  }
  return null;
}
