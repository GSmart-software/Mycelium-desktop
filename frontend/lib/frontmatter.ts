/**
 * Frontmatter YAML de las notas (`FUN-M-04`): el bloque entre `---` al inicio de
 * un archivo deja de ser texto suelto y pasa a ser un conjunto de PROPIEDADES
 * (clave → valor tipado) que Mycelium muestra, edita e indexa.
 * Ver `docs/features/metadata-yaml.md`.
 *
 * ¿Por qué un parser propio y no `js-yaml`/`remark-frontmatter`?
 *
 * 1. **Round-trip**. El panel de propiedades edita valores y hay que volver a
 *    escribir el bloque. Un `dump()` de YAML reordena claves, normaliza comillas
 *    y borra los comentarios: el usuario vería su frontmatter reescrito entero
 *    por cambiar un valor. Acá cada propiedad conoce SU rango de líneas, así que
 *    editar un valor toca solo esas líneas y el resto queda intacto (incluidos
 *    los comentarios y el fin de línea CRLF).
 * 2. El subconjunto soportado (mapa plano de escalares y listas) es chico y
 *    cerrado; lo que no entra NO se interpreta ni se reescribe: se marca como
 *    no soportado y se muestra crudo.
 * 3. Sin dependencia nueva en el bundle ni en el instalador.
 *
 * > OJO: este módulo es **puro y sin imports** a propósito — así
 * > `scripts/test-frontmatter.mjs` puede transpilarlo e importarlo sin build,
 * > igual que `lib/db/nombres.ts`.
 */

export type TipoPropiedad = "texto" | "numero" | "casilla" | "fecha" | "fechaHora" | "lista";

export type ValorPropiedad = string | number | boolean | string[];

export type Propiedad = {
  clave: string;
  tipo: TipoPropiedad;
  valor: ValorPropiedad;
  /** Línea 0-based dentro del DOCUMENTO donde arranca la propiedad. */
  desdeLinea: number;
  /** Última línea (inclusive): una lista en bloque ocupa varias. */
  hastaLinea: number;
  /** Comentario al final de la línea de la clave, para no perderlo al editar. */
  comentario?: string;
};

export type Frontmatter =
  | { hay: false; cuerpoDesde: 0 }
  | { hay: true; soportado: true; props: Propiedad[]; crudo: string; cuerpoDesde: number }
  | { hay: true; soportado: false; motivo: string; crudo: string; cuerpoDesde: number };

/** Clave con comportamiento propio: sus valores SON las etiquetas de la nota. */
const CLAVE_TAGS = "tags";

/**
 * `clave: valor` en una línea. La clave es perezosa (`[^:]*?`) para cortar en el
 * PRIMER `:`, así `url: https://x` deja `https://x` entero como valor. El espacio
 * tras los dos puntos es opcional: YAML lo exige, pero rechazar `clave:valor`
 * marcaría el bloque entero como no soportado por un descuido de tipeo.
 */
const CLAVE_RE = /^([^:#\s][^:]*?)[ \t]*:[ \t]*(.*)$/;

/** Elemento de una lista en bloque: `- valor` (con o sin indentación). */
const ITEM_RE = /^[ \t]*-(?:[ \t]+(.*))?$/;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_HORA_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/;
const NUMERO_RE = /^-?\d+(?:\.\d+)?$/;
const BOOL_RE = /^(?:true|false)$/i;

/** Etiquetas `#tag` del cuerpo (mismo patrón que `lib/db/grafo.ts`). */
const TAG_RE = /(?:^|[\s(])#([\p{L}\p{N}_/-]+)/gu;

/** Una línea sin su `\r` final (los documentos con CRLF llegan así al split). */
const sinCr = (linea: string): string =>
  linea.endsWith("\r") ? linea.slice(0, -1) : linea;

const esComentario = (linea: string): boolean => linea.trimStart().startsWith("#");

function esEntrecomillado(s: string): boolean {
  if (s.length < 2) return false;
  const c = s[0];
  return (c === '"' || c === "'") && s.endsWith(c);
}

function quitarComillas(s: string): string {
  if (!esEntrecomillado(s)) return s;
  const cuerpo = s.slice(1, -1);
  return s[0] === '"'
    ? cuerpo.replace(/\\(["\\])/g, "$1")
    : cuerpo.replace(/''/g, "'");
}

/**
 * Separa el valor de su comentario final. Un `#` solo abre comentario si va
 * PRECEDIDO de espacio y fuera de comillas o corchetes; un `#` al principio del
 * valor se toma literal (`tags: #idea`, `- #idea`) en vez de comerse la línea.
 * Es una desviación deliberada de YAML estricto: preferimos leer de más antes
 * que descartar en silencio algo que el usuario escribió.
 */
function partirComentario(valor: string): { valor: string; comentario?: string } {
  let comilla: string | null = null;
  let anidado = 0;
  for (let i = 0; i < valor.length; i++) {
    const c = valor[i];
    if (comilla) {
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") comilla = c;
    else if (c === "[" || c === "{") anidado++;
    else if (c === "]" || c === "}") anidado--;
    else if (c === "#" && anidado === 0 && i > 0 && /\s/.test(valor[i - 1])) {
      return { valor: valor.slice(0, i).trimEnd(), comentario: valor.slice(i) };
    }
  }
  return { valor: valor.trimEnd() };
}

/** Elementos de una lista en línea (`[a, "b, c"]`), respetando las comillas. */
function partirLista(interior: string): string[] {
  const crudos: string[] = [];
  let actual = "";
  let comilla: string | null = null;
  for (const c of interior) {
    if (comilla) {
      actual += c;
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") comilla = c;
    if (c === ",") {
      crudos.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  crudos.push(actual);
  return crudos.map((s) => quitarComillas(s.trim())).filter((s) => s.length > 0);
}

/**
 * Tipo de un literal, en el orden de la spec: casilla, número, fecha y hora,
 * fecha, lista, texto. Un escalar ENTRECOMILLADO es siempre texto (`version:
 * "1.0"` es texto, no número).
 */
function inferir(bruto: string): { tipo: TipoPropiedad; valor: ValorPropiedad } {
  const s = bruto.trim();
  if (esEntrecomillado(s)) return { tipo: "texto", valor: quitarComillas(s) };
  if (BOOL_RE.test(s)) return { tipo: "casilla", valor: s.toLowerCase() === "true" };
  if (NUMERO_RE.test(s)) return { tipo: "numero", valor: Number(s) };
  if (FECHA_HORA_RE.test(s)) return { tipo: "fechaHora", valor: s };
  if (FECHA_RE.test(s)) return { tipo: "fecha", valor: s };
  if (s.startsWith("[") && s.endsWith("]")) {
    return { tipo: "lista", valor: partirLista(s.slice(1, -1)) };
  }
  return { tipo: "texto", valor: s };
}

/** Motivo por el que un literal cae fuera del subconjunto soportado, o null. */
function motivoNoSoportado(bruto: string): string | null {
  const s = bruto.trim();
  if (/^[|>][-+]?\d*$/.test(s)) return "usa un escalar multilínea (`|` o `>`)";
  if (s.startsWith("&")) return "usa un ancla de YAML (`&`)";
  if (s.startsWith("*")) return "usa un alias de YAML (`*`)";
  if (s.startsWith("!")) return "usa una etiqueta de YAML (`!`)";
  if (s.startsWith("{")) return "tiene un mapa en línea (`{…}`)";
  return null;
}

/** `tags` es SIEMPRE lista de texto, y sus elementos se aceptan con o sin `#`. */
function normalizarTags(valor: ValorPropiedad): string[] {
  const bruta = Array.isArray(valor) ? valor : valor === "" ? [] : [String(valor)];
  return bruta.map((t) => String(t).trim().replace(/^#/, "")).filter((t) => t.length > 0);
}

const esTags = (clave: string): boolean => clave.toLowerCase() === CLAVE_TAGS;

/**
 * Separa el frontmatter del cuerpo. Reglas de detección (spec § 1):
 * el archivo debe EMPEZAR con una línea que sea exactamente `---`; el bloque se
 * cierra en la primera línea posterior que sea `---` o `...`; sin cierre no hay
 * frontmatter (no se adivina); un `---` que no está en la primera línea es una
 * regla horizontal como siempre; y el bloque vacío es válido y sin propiedades.
 */
export function separarFrontmatter(texto: string): Frontmatter {
  const lineas = texto.split("\n");
  if (lineas.length < 2 || sinCr(lineas[0]) !== "---") return { hay: false, cuerpoDesde: 0 };

  let cierre = -1;
  for (let i = 1; i < lineas.length; i++) {
    const t = sinCr(lineas[i]);
    if (t === "---" || t === "...") {
      cierre = i;
      break;
    }
  }
  if (cierre === -1) return { hay: false, cuerpoDesde: 0 };

  const crudo = lineas.slice(1, cierre).map(sinCr).join("\n");
  const cuerpoDesde = cierre + 1;
  const noSoportado = (motivo: string): Frontmatter => ({
    hay: true,
    soportado: false,
    motivo,
    crudo,
    cuerpoDesde,
  });

  const props: Propiedad[] = [];
  const vistas = new Set<string>();
  let i = 1;

  while (i < cierre) {
    const cruda = sinCr(lineas[i]);
    if (cruda.trim() === "" || esComentario(cruda)) {
      i++;
      continue;
    }
    // Una línea indentada (o un `- `) a este nivel significa que el bloque no es
    // un mapa plano: mapa anidado o lista suelta. No se toca.
    if (/^[ \t]/.test(cruda)) return noSoportado("tiene indentación fuera de una lista");
    if (ITEM_RE.test(cruda)) return noSoportado("no es un mapa de `clave: valor`");

    const m = CLAVE_RE.exec(cruda);
    if (!m) return noSoportado(`no se entiende la línea «${cruda.trim()}»`);

    const clave = quitarComillas(m[1].trim());
    if (vistas.has(clave.toLowerCase())) return noSoportado(`la clave «${clave}» está repetida`);
    vistas.add(clave.toLowerCase());

    const { valor: bruto, comentario } = partirComentario(m[2] ?? "");

    if (bruto === "") {
      // Sin valor en la línea: puede venir una lista en bloque debajo, un mapa
      // anidado (no soportado) o ser sencillamente un valor vacío.
      let j = i + 1;
      while (j < cierre && (sinCr(lineas[j]).trim() === "" || esComentario(sinCr(lineas[j])))) j++;
      const sig = j < cierre ? sinCr(lineas[j]) : null;

      if (sig !== null && ITEM_RE.test(sig)) {
        const items: string[] = [];
        let hasta = i;
        while (j < cierre) {
          const l = sinCr(lineas[j]);
          if (l.trim() === "") break;
          if (esComentario(l)) {
            j++;
            continue;
          }
          const mi = ITEM_RE.exec(l);
          if (!mi) break;
          const item = partirComentario(mi[1] ?? "").valor.trim();
          if (/^[^:]+:(?:\s|$)/.test(item) || item.startsWith("{")) {
            return noSoportado("tiene una lista de mapas");
          }
          const noSop = motivoNoSoportado(item);
          if (noSop) return noSoportado(noSop);
          if (item !== "") items.push(quitarComillas(item));
          hasta = j;
          j++;
        }
        props.push({
          clave,
          tipo: "lista",
          valor: esTags(clave) ? normalizarTags(items) : items,
          desdeLinea: i,
          hastaLinea: hasta,
          comentario,
        });
        i = hasta + 1;
        continue;
      }

      if (sig !== null && /^[ \t]/.test(sig)) return noSoportado("tiene un mapa anidado");

      props.push({
        clave,
        tipo: esTags(clave) ? "lista" : "texto",
        valor: esTags(clave) ? [] : "",
        desdeLinea: i,
        hastaLinea: i,
        comentario,
      });
      i++;
      continue;
    }

    const noSop = motivoNoSoportado(bruto);
    if (noSop) return noSoportado(noSop);

    const { tipo, valor } = inferir(bruto);
    props.push({
      clave,
      tipo: esTags(clave) ? "lista" : tipo,
      valor: esTags(clave) ? normalizarTags(valor) : valor,
      desdeLinea: i,
      hastaLinea: i,
      comentario,
    });
    i++;
  }

  return { hay: true, soportado: true, props, crudo, cuerpoDesde };
}

/**
 * El markdown de la nota SIN el bloque de frontmatter. Acepta un `fm` ya
 * calculado para no volver a parsear: en los caminos que recorren TODO el vault
 * (el grafo, el indexado) se llama una vez por nota.
 */
export function cuerpoDe(texto: string, fm: Frontmatter = separarFrontmatter(texto)): string {
  if (!fm.hay) return texto;
  return texto.split("\n").slice(fm.cuerpoDesde).join("\n");
}

/** Propiedad por clave (case-insensitive), o undefined. */
export function propiedadDe(texto: string, clave: string): Propiedad | undefined {
  const fm = separarFrontmatter(texto);
  if (!fm.hay || !fm.soportado) return undefined;
  return fm.props.find((p) => p.clave.toLowerCase() === clave.toLowerCase());
}

/**
 * Etiquetas de la nota: las de `tags:` MÁS los `#tag` del cuerpo, sin distinguir
 * de dónde salieron (spec § 1). Se buscan sobre el CUERPO para que los
 * comentarios `#` del YAML no se cuelen como etiquetas.
 */
export function etiquetasDe(texto: string): string[] {
  const out: string[] = [];
  const vistas = new Set<string>();
  const push = (t: string) => {
    const k = t.toLowerCase();
    if (t.length > 0 && !vistas.has(k)) {
      vistas.add(k);
      out.push(t);
    }
  };

  const fm = separarFrontmatter(texto);
  if (fm.hay && fm.soportado) {
    const tags = fm.props.find((p) => esTags(p.clave));
    if (tags && Array.isArray(tags.valor)) for (const t of tags.valor) push(t);
  }
  for (const m of cuerpoDe(texto, fm).matchAll(TAG_RE)) push(m[1]);
  return out;
}

// ── Edición quirúrgica ────────────────────────────────────────────────────────

/** ¿Hace falta entrecomillar este texto para que vuelva a leerse como texto? */
function necesitaComillas(s: string): boolean {
  if (s === "") return true;
  if (s !== s.trim()) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return true;
  if (/:\s|\s#/.test(s)) return true;
  // Un texto que "parece" otro tipo se entrecomilla, o se releería como tal.
  return BOOL_RE.test(s) || NUMERO_RE.test(s) || FECHA_RE.test(s) || FECHA_HORA_RE.test(s);
}

function entrecomillar(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const textoYaml = (s: string): string => (necesitaComillas(s) ? entrecomillar(s) : s);

/** Un elemento de lista en línea necesita además protegerse de la coma. */
const itemEnLinea = (s: string): string =>
  necesitaComillas(s) || /[,[\]]/.test(s) ? entrecomillar(s) : s;

function serializarEscalar(valor: ValorPropiedad, tipo: TipoPropiedad): string {
  if (tipo === "casilla") return valor === true || valor === "true" ? "true" : "false";
  if (tipo === "numero") return String(valor);
  // Fechas y horas se escriben tal cual (ya vienen en formato ISO corto).
  if (tipo === "fecha" || tipo === "fechaHora") return String(valor);
  return textoYaml(String(valor));
}

/**
 * Líneas YAML de una propiedad. `bloque` conserva el estilo de lista que ya
 * tenía el archivo (en bloque con `- ` o en línea con `[…]`): cambiarlo sería
 * reescribirle el frontmatter al usuario por editar un valor.
 */
function lineasDePropiedad(
  clave: string,
  tipo: TipoPropiedad,
  valor: ValorPropiedad,
  comentario: string | undefined,
  bloque: boolean,
): string[] {
  const com = comentario ? ` ${comentario}` : "";
  if (tipo === "lista") {
    const items = (Array.isArray(valor) ? valor : [String(valor)]).map((v) => String(v));
    if (bloque) return [`${clave}:${com}`, ...items.map((v) => `- ${textoYaml(v)}`)];
    return [`${clave}: [${items.map(itemEnLinea).join(", ")}]${com}`];
  }
  return [`${clave}: ${serializarEscalar(valor, tipo)}${com}`];
}

/** Tipo deducido del valor de JavaScript (el literal decide para los strings). */
function tipoDe(valor: ValorPropiedad): TipoPropiedad {
  if (Array.isArray(valor)) return "lista";
  if (typeof valor === "boolean") return "casilla";
  if (typeof valor === "number") return "numero";
  return inferir(valor).tipo;
}

/** El sufijo de fin de línea del documento, para no convertir CRLF a LF. */
const finDeLinea = (texto: string): string => (texto.includes("\r\n") ? "\r" : "");

function guardaEdicion(fm: Frontmatter): void {
  if (fm.hay && !fm.soportado) {
    throw new Error(
      `Mycelium no interpreta este frontmatter (${fm.motivo}): no se edita para no romperlo.`,
    );
  }
}

/**
 * Crea o cambia una propiedad devolviendo el texto completo con UN cambio
 * mínimo: solo las líneas de esa propiedad (o el bloque nuevo, si la nota no
 * tenía frontmatter). Lanza si el bloque no es soportado — la guarda va acá y no
 * solo en la UI.
 */
export function ponerPropiedad(
  texto: string,
  clave: string,
  valor: ValorPropiedad,
  tipo?: TipoPropiedad,
): string {
  const fm = separarFrontmatter(texto);
  guardaEdicion(fm);

  const cr = finDeLinea(texto);
  const tipoFinal = esTags(clave) ? "lista" : (tipo ?? tipoDe(valor));
  const valorFinal = esTags(clave) ? normalizarTags(valor) : valor;

  if (!fm.hay) {
    const nuevas = lineasDePropiedad(clave, tipoFinal, valorFinal, undefined, false);
    // Bloque nuevo al principio + línea en blanco, para no pegarse al contenido.
    return ["---", ...nuevas, "---", ""].map((l) => l + cr + "\n").join("") + texto;
  }

  const lineas = texto.split("\n");
  const existente = fm.soportado
    ? fm.props.find((p) => p.clave.toLowerCase() === clave.toLowerCase())
    : undefined;
  const enBloque = existente !== undefined && existente.hastaLinea > existente.desdeLinea;
  const nuevas = lineasDePropiedad(
    existente?.clave ?? clave,
    tipoFinal,
    valorFinal,
    existente?.comentario,
    enBloque,
  ).map((l) => l + cr);

  if (existente) {
    lineas.splice(existente.desdeLinea, existente.hastaLinea - existente.desdeLinea + 1, ...nuevas);
  } else {
    lineas.splice(fm.cuerpoDesde - 1, 0, ...nuevas); // justo antes del cierre
  }
  return lineas.join("\n");
}

/** Quita una propiedad (sus líneas). El bloque vacío se conserva: es válido. */
export function quitarPropiedad(texto: string, clave: string): string {
  const fm = separarFrontmatter(texto);
  guardaEdicion(fm);
  if (!fm.hay || !fm.soportado) return texto;

  const p = fm.props.find((x) => x.clave.toLowerCase() === clave.toLowerCase());
  if (!p) return texto;

  const lineas = texto.split("\n");
  lineas.splice(p.desdeLinea, p.hastaLinea - p.desdeLinea + 1);
  return lineas.join("\n");
}

/**
 * Renombra una propiedad tocando SOLO el tramo de la clave: el valor, el
 * espaciado y el comentario de esa línea quedan tal cual.
 */
export function renombrarPropiedad(texto: string, clave: string, nueva: string): string {
  const fm = separarFrontmatter(texto);
  guardaEdicion(fm);
  if (!fm.hay || !fm.soportado) return texto;

  const p = fm.props.find((x) => x.clave.toLowerCase() === clave.toLowerCase());
  if (!p) return texto;
  const limpia = nueva.trim();
  if (limpia === "" || limpia === p.clave) return texto;
  if (fm.props.some((x) => x !== p && x.clave.toLowerCase() === limpia.toLowerCase())) {
    throw new Error(`Ya existe una propiedad «${limpia}» en esta nota.`);
  }

  const lineas = texto.split("\n");
  const original = lineas[p.desdeLinea];
  const cr = original.endsWith("\r") ? "\r" : "";
  const sin = cr ? original.slice(0, -1) : original;
  const m = CLAVE_RE.exec(sin);
  if (!m) return texto;
  lineas[p.desdeLinea] = textoYaml(limpia) + sin.slice(m[1].length) + cr;
  return lineas.join("\n");
}
