/**
 * ¿Se puede leer este dibujo o diagrama? (`DEF-119`)
 *
 * Un `.excalidraw` o un `.drawio` que no se podía leer —JSON o XML mal formado,
 * típicamente porque una IA lo escribió con un error de sintaxis— se abría como
 * si estuviera **vacío**, y lo primero que se hiciera encima se guardaba sobre el
 * archivo: el original se perdía sin aviso. La causa era que las dos vistas
 * trataban «no lo entiendo» igual que «no tiene nada», porque para un archivo
 * recién creado (0 bytes) las dos cosas daban lo mismo.
 *
 * Acá se separan los tres casos, y la vista hace algo distinto con cada uno:
 *
 * - `vacio`: el archivo no tiene nada (recién creado). Es un dibujo en blanco
 *   **válido**: se abre el editor y se puede dibujar.
 * - `legible`: se abre el editor con lo que hay.
 * - `ilegible`: **no** se abre el editor —nada que se dibuje puede pisar el
 *   original—; se avisa con el `motivo` y se espera a que se corrija.
 *
 * Puro y sin imports, para que `scripts/test-archivos-ilegibles.mjs` lo pruebe sin
 * navegador (igual que `lib/recargaExterna.ts`). Lo que necesita del navegador
 * —el `DOMParser` para el XML— entra por parámetro.
 */

export type LecturaArchivo =
  | { estado: "vacio" }
  | { estado: "legible" }
  | { estado: "ilegible"; motivo: string };

// ── Excalidraw ────────────────────────────────────────────────────────────────

/**
 * Tipos de elemento que `restoreElements` de Excalidraw 0.18 sabe reconstruir.
 * Un elemento de otro tipo **no rompe** la carga: se descarta en silencio, y el
 * próximo guardado lo borraría del archivo. Por eso cuenta como ilegible.
 * `selection` también se descarta, pero es un resto legítimo del propio editor;
 * `draw` es el nombre viejo de `line` y se migra.
 */
const TIPOS_EXCALIDRAW = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "line",
  "draw",
  "text",
  "freedraw",
  "image",
  "frame",
  "magicframe",
  "embeddable",
  "iframe",
  "selection",
]);

/**
 * Diagnóstico de la **forma** de un `.excalidraw`: JSON válido, un objeto con la
 * lista `elements`, y cada elemento un objeto con un `type` que Excalidraw
 * conoce.
 *
 * No alcanza por sí solo: `restoreElements` todavía puede tirar con algo que
 * tiene la forma correcta (una flecha sin `points`, por ejemplo). Ese segundo
 * filtro lo hace la vista, que es la que tiene la librería cargada; ver
 * `motivoDeExcepcion`.
 */
export function diagnosticarExcalidraw(contenido: string): LecturaArchivo {
  if (contenido.trim() === "") return { estado: "vacio" };
  let raiz: unknown;
  try {
    raiz = JSON.parse(contenido);
  } catch (e) {
    return { estado: "ilegible", motivo: `No es JSON válido: ${motivoDeExcepcion(e)}` };
  }
  if (typeof raiz !== "object" || raiz === null || Array.isArray(raiz)) {
    return {
      estado: "ilegible",
      motivo: "No es un dibujo de Excalidraw: se esperaba un objeto con la lista `elements`.",
    };
  }
  const elementos = (raiz as { elements?: unknown }).elements;
  if (!Array.isArray(elementos)) {
    return {
      estado: "ilegible",
      motivo:
        elementos === undefined
          ? "Falta la lista `elements`: no es un dibujo de Excalidraw."
          : "`elements` no es una lista.",
    };
  }
  for (let i = 0; i < elementos.length; i++) {
    const e = elementos[i] as { type?: unknown } | null;
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      return { estado: "ilegible", motivo: `El elemento ${i + 1} no es un objeto.` };
    }
    if (typeof e.type !== "string") {
      return { estado: "ilegible", motivo: `El elemento ${i + 1} no tiene \`type\`.` };
    }
    if (!TIPOS_EXCALIDRAW.has(e.type)) {
      return {
        estado: "ilegible",
        motivo: `El elemento ${i + 1} es de un tipo que Excalidraw no conoce («${e.type}»): se perdería al guardar.`,
      };
    }
  }
  return { estado: "legible" };
}

// ── draw.io ───────────────────────────────────────────────────────────────────

/**
 * Lo que la vista averigua del XML con el `DOMParser` del navegador (acá no hay
 * uno; en los tests se simula).
 *
 * - `error`: el texto del `<parsererror>`, o `null` si el XML está bien formado.
 * - `raiz`: el nombre del elemento raíz.
 * - `diagramas`: una entrada por cada `<diagram>` de un `<mxfile>`: si trae el
 *   `<mxGraphModel>` como elemento, o si no, su texto (el diagrama comprimido).
 */
export type EstructuraXml = {
  error: string | null;
  raiz: string | null;
  diagramas: { conModelo: boolean; texto: string }[];
};

/**
 * Diagnóstico de un `.drawio`.
 *
 * draw.io embebido **no avisa por el protocolo** cuando un `load` falla: muestra
 * su diálogo («No es un archivo de diagrama»), igual emite `load` y deja editar
 * el diagrama vacío, y su autoguardado lo manda como cualquier otro. Por eso el
 * contenido se revisa **antes** de mandárselo, con el mismo criterio que el
 * editor aplicaría: XML bien formado, raíz `mxfile` o `mxGraphModel`, y cada
 * página con su modelo o con un comprimido que al menos sea base64.
 *
 * No se descomprime el base64 (deflate): un comprimido con el alfabeto correcto
 * pero dañado por dentro todavía pasa. Es el caso raro —una IA escribe el XML
 * plano— y descomprimir obligaría a un diagnóstico asíncrono.
 */
export function diagnosticarDrawio(
  contenido: string,
  analizar: (xml: string) => EstructuraXml,
): LecturaArchivo {
  if (contenido.trim() === "") return { estado: "vacio" };
  const xml = analizar(contenido);
  if (xml.error !== null) {
    return { estado: "ilegible", motivo: `El XML está mal formado: ${xml.error}` };
  }
  if (xml.raiz !== "mxfile" && xml.raiz !== "mxGraphModel") {
    return {
      estado: "ilegible",
      motivo: `No es un diagrama de draw.io: se esperaba <mxfile> o <mxGraphModel> y empieza con <${xml.raiz ?? "?"}>.`,
    };
  }
  for (let i = 0; i < xml.diagramas.length; i++) {
    const d = xml.diagramas[i];
    if (d.conModelo) continue;
    const texto = d.texto.replace(/\s+/g, "");
    // Una página sin nada es una página en blanco: draw.io la abre así.
    if (texto === "") continue;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(texto) || texto.length % 4 !== 0) {
      return {
        estado: "ilegible",
        motivo: `La página ${i + 1} no trae un <mxGraphModel> ni un diagrama comprimido válido.`,
      };
    }
  }
  return { estado: "legible" };
}

/**
 * `EstructuraXml` según el `DOMParser` del WebView: el `analizar` que usan las
 * vistas. Es lo único de este módulo que necesita navegador, y solo al llamarlo:
 * importar el módulo desde Node (los tests) no lo toca.
 */
export function analizarXml(xml: string): EstructuraXml {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) {
    // Chromium envuelve el mensaje entre dos títulos genéricos («This page
    // contains the following errors», «Below is a rendering…»): el dato está en
    // el `div` del medio.
    const texto = error.querySelector("div")?.textContent ?? error.textContent ?? "";
    return { error: motivoDeExcepcion(texto), raiz: null, diagramas: [] };
  }
  const raiz = doc.documentElement;
  const diagramas =
    raiz.nodeName === "mxfile"
      ? Array.from(raiz.children)
          .filter((c) => c.nodeName === "diagram")
          .map((d) => ({
            conModelo: Array.from(d.children).some((c) => c.nodeName === "mxGraphModel"),
            texto: d.textContent ?? "",
          }))
      : [];
  return { error: null, raiz: raiz.nodeName, diagramas };
}

// ── Común ─────────────────────────────────────────────────────────────────────

/** El mensaje de una excepción, para mostrarlo en el aviso. */
export function motivoDeExcepcion(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  // Los mensajes del `DOMParser` y de algunos motores traen saltos de línea y
  // espacios de relleno: en el aviso van en una línea.
  return texto.replace(/\s+/g, " ").trim() || "error desconocido";
}
