/**
 * Bases (`FUN-L-03`): un archivo `.base` agrega notas del vault y las muestra en
 * una tabla, filtrando por sus propiedades (`FUN-M-04`).
 * Ver `docs/features/bases-tabla.md`.
 *
 * Se adopta el formato de las Bases de Obsidian —tercera vez que el proyecto
 * elige interoperabilidad, tras las Propiedades y JSON Canvas— pero solo un
 * **subconjunto cerrado** de su lenguaje: el completo incluye fórmulas y métodos
 * encadenados con semántica de JavaScript, o sea un intérprete entero.
 *
 * > [!danger] La regla que gobierna todo este módulo
 * > Una expresión que no se entiende **NO se ignora**. Ignorar un filtro dentro
 * > de un `and` ensancha el resultado (aparecen notas que debían ocultarse);
 * > descartar la fila dentro de un `or` lo estrecha. Las dos salidas producen una
 * > tabla plausible y equivocada, y una tabla se mira para decidir. Por eso
 * > `evaluar` devuelve `null` = "no se puede decidir", que se propaga hacia
 * > arriba hasta convertirse en un error visible.
 *
 * > OJO: este módulo es **puro y sin imports** a propósito — así
 * > `scripts/test-bases.mjs` puede transpilarlo e importarlo sin build, igual
 * > que `lib/frontmatter.ts` y `lib/esporas.ts`.
 */

/** Extensión de los archivos de base (la de Obsidian, para interoperar). */
export const EXTENSION_BASE = ".base";

// ── Lo que el evaluador necesita saber de una nota ────────────────────────────

/** Una propiedad indexada: un valor por fila (las listas dan varias). */
export type PropiedadFila = { clave: string; valor: string; tipo: string };

/**
 * Una nota, vista por una base. Lo arma el endpoint `/vaults/{id}/tabla`, que es
 * lo ÚNICO que se implementa dos veces (SQLite local vs backend .NET).
 */
export type NotaTabla = {
  id: string;
  nombre: string;
  ruta: string;
  carpeta: string;
  ext: string;
  ctime: string;
  mtime: string;
  size: number;
  tags: string[];
  props: PropiedadFila[];
};

// ── El archivo `.base`, ya parseado ───────────────────────────────────────────

export type Vista = {
  tipo: string;
  nombre: string;
  limite: number | null;
  columnas: string[];
  orden: { propiedad: string; descendente: boolean }[];
  filtros: Filtro | null;
  /** Claves de la vista que Mycelium no modela (`groupBy`, `summaries`…). */
  ignoradas: string[];
  /** Motivo por el que la vista entera no se puede mostrar, o null. */
  noSoportada: string | null;
};

export type Base = {
  filtros: Filtro | null;
  /** `clave` → nombre a mostrar en la cabecera. */
  nombres: Record<string, string>;
  vistas: Vista[];
  /** Claves de nivel superior que se ignoraron, para poder avisarlo. */
  ignoradas: string[];
};

export type Filtro =
  | { tipo: "and" | "or"; hijos: Filtro[] }
  | { tipo: "not"; hijos: Filtro[] }
  | { tipo: "expr"; fuente: string }
  /** Expresión fuera del subconjunto: se conserva para poder explicarla. */
  | { tipo: "opaco"; fuente: string; motivo: string };

export class ErrorBase extends Error {}

// ── YAML: el mismo subconjunto que el frontmatter, más listas anidadas ────────

const sinCr = (l: string): string => (l.endsWith("\r") ? l.slice(0, -1) : l);
const esComentario = (l: string): boolean => l.trimStart().startsWith("#");
const sangria = (l: string): number => l.length - l.trimStart().length;

function quitarComillas(s: string): string {
  const t = s.trim();
  if (t.length < 2) return t;
  const c = t[0];
  if ((c === '"' || c === "'") && t.endsWith(c)) {
    const cuerpo = t.slice(1, -1);
    return c === '"' ? cuerpo.replace(/\\(["\\])/g, "$1") : cuerpo.replace(/''/g, "'");
  }
  return t;
}

/** Nodo del árbol YAML: escalar, lista o mapa. */
type Nodo = string | Nodo[] | { [clave: string]: Nodo };

/**
 * Parser YAML mínimo pero *estructural*: mapas, listas y escalares anidados por
 * indentación. No es YAML completo (ni falta): no hay anclas, ni escalares
 * multilínea, ni mapas en línea. Lo que no entra se reporta, no se adivina.
 *
 * Se escribe acá en vez de reusar `lib/frontmatter.ts` porque aquel es
 * deliberadamente PLANO —un mapa de escalares y listas, sin anidamiento— y un
 * `.base` es un árbol. Reusarlo habría significado desplanarlo, que es
 * justamente lo que lo mantiene simple y seguro para editar notas.
 */
function parsearYaml(texto: string): Record<string, Nodo> {
  const lineas = texto
    .split("\n")
    .map(sinCr)
    .map((l, i) => ({ n: i + 1, texto: l }))
    .filter((l) => l.texto.trim() !== "" && !esComentario(l.texto));

  let i = 0;

  function bloque(nivel: number): Nodo {
    // ¿Lista o mapa? Lo decide la primera línea del bloque.
    if (i < lineas.length && /^\s*-\s*/.test(lineas[i].texto) && sangria(lineas[i].texto) >= nivel) {
      const lista: Nodo[] = [];
      while (i < lineas.length) {
        const l = lineas[i].texto;
        const s = sangria(l);
        if (s < nivel || !/^\s*-\s*/.test(l)) break;
        if (s > nivel) throw new ErrorBase(`línea ${lineas[i].n}: indentación inesperada`);
        const resto = l.slice(s + 1).trim();
        i++;
        if (resto === "") {
          lista.push(bloque(nivelSiguiente(nivel)));
        } else if (/^[^:\s][^:]*:(\s|$)/.test(resto)) {
          // `- clave: valor`: un mapa que empieza en la misma línea del guion.
          const sangriaMapa = s + 2;
          lineas.splice(i, 0, { n: lineas[i - 1]?.n ?? 0, texto: " ".repeat(sangriaMapa) + resto });
          lista.push(bloque(sangriaMapa));
        } else {
          lista.push(quitarComillas(resto));
        }
      }
      return lista;
    }

    const mapa: Record<string, Nodo> = {};
    while (i < lineas.length) {
      const l = lineas[i].texto;
      const s = sangria(l);
      if (s < nivel) break;
      if (s > nivel) throw new ErrorBase(`línea ${lineas[i].n}: indentación inesperada`);
      const m = /^([^:#\s][^:]*?)\s*:\s*(.*)$/.exec(l.trim());
      if (!m) throw new ErrorBase(`línea ${lineas[i].n}: no se entiende «${l.trim()}»`);
      const clave = quitarComillas(m[1]);
      const valor = m[2];
      i++;
      if (valor === "") {
        mapa[clave] = i < lineas.length && sangria(lineas[i].texto) > s ? bloque(nivelSiguiente(s)) : "";
      } else if (valor.startsWith("[") && valor.endsWith("]")) {
        mapa[clave] = partirListaEnLinea(valor.slice(1, -1));
      } else {
        mapa[clave] = quitarComillas(valor);
      }
    }
    return mapa;
  }

  /** Sangría del bloque que viene, leída de la primera línea que lo compone. */
  function nivelSiguiente(actual: number): number {
    return i < lineas.length ? Math.max(sangria(lineas[i].texto), actual + 1) : actual + 1;
  }

  function partirListaEnLinea(interior: string): Nodo[] {
    if (interior.trim() === "") return [];
    const fuera: string[] = [];
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
        fuera.push(actual);
        actual = "";
        continue;
      }
      actual += c;
    }
    fuera.push(actual);
    return fuera.map(quitarComillas).filter((s) => s !== "");
  }

  const raiz = bloque(0);
  if (Array.isArray(raiz) || typeof raiz === "string") {
    throw new ErrorBase("el archivo debe ser un mapa de `clave: valor` en el nivel superior");
  }
  return raiz;
}

// ── Parseo del `.base` ────────────────────────────────────────────────────────

const CLAVES_CONOCIDAS = new Set(["filters", "views", "properties"]);

const esMapa = (n: Nodo | undefined): n is Record<string, Nodo> =>
  typeof n === "object" && n !== null && !Array.isArray(n);

/** Un nodo de filtro del YAML → nuestro árbol, marcando lo que no se entiende. */
function leerFiltro(nodo: Nodo): Filtro {
  if (typeof nodo === "string") return leerExpresion(nodo);

  if (Array.isArray(nodo)) {
    // Una lista suelta donde se esperaba un filtro se lee como `and` implícito,
    // que es como la escribe Obsidian dentro de `and:`/`or:`.
    return { tipo: "and", hijos: nodo.map(leerFiltro) };
  }

  const claves = Object.keys(nodo);
  if (claves.length !== 1) {
    return {
      tipo: "opaco",
      fuente: claves.join(", "),
      motivo: "un grupo de filtros debe tener exactamente un combinador (`and`, `or` o `not`)",
    };
  }
  const clave = claves[0];
  const hijo = nodo[clave];
  if (clave === "and" || clave === "or" || clave === "not") {
    const hijos = Array.isArray(hijo) ? hijo.map(leerFiltro) : [leerFiltro(hijo)];
    return { tipo: clave, hijos };
  }
  return { tipo: "opaco", fuente: clave, motivo: `combinador desconocido «${clave}»` };
}

/** Vista del YAML → nuestra vista, con su motivo si no se puede mostrar. */
function leerVista(nodo: Nodo, indice: number): Vista {
  if (!esMapa(nodo)) {
    return vistaRota(`la vista ${indice + 1} no es un mapa de opciones`, indice);
  }
  const tipo = typeof nodo.type === "string" ? nodo.type : "table";
  const nombre = typeof nodo.name === "string" ? nodo.name : `Vista ${indice + 1}`;

  if (tipo !== "table") {
    return {
      ...vistaRota(
        `Mycelium todavía solo dibuja vistas de tipo «table»; esta es «${tipo}».`,
        indice,
      ),
      tipo,
      nombre,
    };
  }

  const columnas = Array.isArray(nodo.order)
    ? nodo.order.filter((c): c is string => typeof c === "string")
    : [];

  const orden: Vista["orden"] = [];
  if (Array.isArray(nodo.sort)) {
    for (const s of nodo.sort) {
      if (!esMapa(s) || typeof s.property !== "string") continue;
      const dir = typeof s.direction === "string" ? s.direction.toUpperCase() : "ASC";
      orden.push({ propiedad: s.property, descendente: dir === "DESC" });
    }
  }

  const limiteBruto = typeof nodo.limit === "string" ? Number(nodo.limit) : NaN;
  const limite = Number.isFinite(limiteBruto) && limiteBruto > 0 ? Math.floor(limiteBruto) : null;

  return {
    tipo,
    nombre,
    limite,
    columnas,
    orden,
    filtros: nodo.filters === undefined ? null : leerFiltro(nodo.filters),
    ignoradas: Object.keys(nodo).filter((k) => !CLAVES_VISTA.has(k)),
    noSoportada: null,
  };
}

/** Claves de una vista que Mycelium sí modela (el resto se declara y no se toca). */
const CLAVES_VISTA = new Set(["type", "name", "limit", "order", "sort", "filters"]);

function vistaRota(motivo: string, indice: number): Vista {
  return {
    tipo: "?",
    nombre: `Vista ${indice + 1}`,
    limite: null,
    columnas: [],
    orden: [],
    filtros: null,
    ignoradas: [],
    noSoportada: motivo,
  };
}

/** Parsea un archivo `.base`. Lanza `ErrorBase` si el YAML no se entiende. */
export function parsearBase(texto: string): Base {
  const raiz = parsearYaml(texto);

  const nombres: Record<string, string> = {};
  if (esMapa(raiz.properties)) {
    for (const [clave, cfg] of Object.entries(raiz.properties)) {
      if (esMapa(cfg) && typeof cfg.displayName === "string") nombres[clave] = cfg.displayName;
    }
  }

  const vistasBrutas = Array.isArray(raiz.views) ? raiz.views : [];
  const vistas = vistasBrutas.map(leerVista);

  return {
    filtros: raiz.filters === undefined ? null : leerFiltro(raiz.filters),
    nombres,
    // Sin `views`, se muestra una tabla por defecto con solo el nombre: es lo
    // mínimo útil y evita que un archivo a medio escribir no muestre nada.
    vistas: vistas.length > 0 ? vistas : [leerVista({ type: "table", name: "Tabla" }, 0)],
    ignoradas: Object.keys(raiz).filter((k) => !CLAVES_CONOCIDAS.has(k)),
  };
}

// ── Expresiones ───────────────────────────────────────────────────────────────

/** Una comparación `izquierda OP derecha`, o una llamada a función. */
type Expresion =
  | { clase: "comparacion"; ref: string; op: string; literal: Literal }
  | { clase: "llamada"; ref: string; metodo: string; args: Literal[] };

type Literal = { texto: string; numero: number | null; booleano: boolean | null };

const OPERADORES = [">=", "<=", "==", "!=", ">", "<"];

const COMPARACION_RE = /^\s*(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+?)\s*$/;
const LLAMADA_RE = /^\s*(.+?)\.([A-Za-z]+)\s*\(\s*(.*?)\s*\)\s*$/;

const METODOS = new Set([
  "hasTag",
  "inFolder",
  "hasProperty",
  "isEmpty",
  "contains",
  "startsWith",
  "endsWith",
]);

function literal(bruto: string): Literal {
  const t = quitarComillas(bruto);
  const entrecomillado = /^["']/.test(bruto.trim());
  const numero = !entrecomillado && t !== "" && Number.isFinite(Number(t)) ? Number(t) : null;
  const booleano = !entrecomillado && (t === "true" || t === "false") ? t === "true" : null;
  return { texto: t, numero, booleano };
}

/**
 * Texto de una expresión → estructura. Todo lo que no case con los dos patrones
 * soportados vuelve como `opaco`: es la puerta por la que el subconjunto se
 * mantiene honesto.
 */
function leerExpresion(fuente: string): Filtro {
  const texto = fuente.trim();
  if (texto === "") return { tipo: "opaco", fuente, motivo: "expresión vacía" };

  const llamada = LLAMADA_RE.exec(texto);
  if (llamada && !OPERADORES.some((op) => texto.includes(op))) {
    if (!METODOS.has(llamada[2])) {
      return { tipo: "opaco", fuente: texto, motivo: `la función «${llamada[2]}()» no está soportada` };
    }
    return { tipo: "expr", fuente: texto };
  }

  const comp = COMPARACION_RE.exec(texto);
  if (comp) {
    // El lado izquierdo tiene que ser una referencia simple; una llamada
    // encadenada (`x.foo().bar`) es del lenguaje completo, no de este subconjunto.
    if (/[()]/.test(comp[1])) {
      return { tipo: "opaco", fuente: texto, motivo: "no se admiten llamadas dentro de una comparación" };
    }
    return { tipo: "expr", fuente: texto };
  }

  return { tipo: "opaco", fuente: texto, motivo: "no es una comparación ni una función soportada" };
}

/** Estructura de una expresión ya validada por `leerExpresion`. */
function analizar(fuente: string): Expresion | null {
  const llamada = LLAMADA_RE.exec(fuente);
  if (llamada && !OPERADORES.some((op) => fuente.includes(op))) {
    const args = llamada[3] === "" ? [] : partirArgumentos(llamada[3]).map(literal);
    return { clase: "llamada", ref: llamada[1].trim(), metodo: llamada[2], args };
  }
  const comp = COMPARACION_RE.exec(fuente);
  if (comp) return { clase: "comparacion", ref: comp[1].trim(), op: comp[2], literal: literal(comp[3]) };
  return null;
}

function partirArgumentos(s: string): string[] {
  const fuera: string[] = [];
  let actual = "";
  let comilla: string | null = null;
  for (const c of s) {
    if (comilla) {
      actual += c;
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") comilla = c;
    if (c === ",") {
      fuera.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  fuera.push(actual);
  return fuera.map((x) => x.trim()).filter((x) => x !== "");
}

// ── Lectura de valores ────────────────────────────────────────────────────────

/**
 * Valor de una referencia (`file.name`, `note.estado`, `estado`) sobre una nota.
 * Devuelve SIEMPRE una lista: una propiedad de lista tiene varios valores, y
 * comparar contra cualquiera de ellos es lo que espera quien escribe
 * `tags == "idea"`. `undefined` = la propiedad no existe, que NO es lo mismo que
 * existir vacía.
 */
export function valoresDe(nota: NotaTabla, ref: string): string[] | undefined {
  if (ref.startsWith("file.")) {
    const campo = ref.slice(5);
    switch (campo) {
      case "name":
      case "basename":
        return [nota.nombre];
      case "path":
        return [nota.ruta];
      case "folder":
        return [nota.carpeta];
      case "ext":
        return [nota.ext];
      case "ctime":
        return [nota.ctime];
      case "mtime":
        return [nota.mtime];
      case "size":
        return [String(nota.size)];
      case "tags":
        return nota.tags;
      default:
        return undefined;
    }
  }
  const clave = ref.startsWith("note.") ? ref.slice(5) : ref;
  const valores = nota.props
    .filter((p) => p.clave.toLowerCase() === clave.toLowerCase())
    .map((p) => p.valor);
  return valores.length > 0 ? valores : undefined;
}

/** Compara dos escalares como números si los dos lo son, y si no como texto. */
function comparar(a: string, b: Literal): number {
  const na = Number(a);
  if (b.numero !== null && Number.isFinite(na)) return na - b.numero;
  return a.localeCompare(b.texto, "es", { sensitivity: "base" });
}

// ── Evaluación ────────────────────────────────────────────────────────────────

/**
 * Evalúa un filtro sobre una nota.
 *
 * `null` significa **«no se puede decidir»**, no «falso». Se propaga: un `and`
 * con un hijo indecidible solo puede resolverse si otro hijo ya es `false`
 * (falso absorbe), y un `or` solo si otro ya es `true`. Es lógica de tres
 * valores, y es lo que permite que un filtro no soportado no cambie en silencio
 * el conjunto de filas.
 */
export function evaluar(filtro: Filtro, nota: NotaTabla): boolean | null {
  switch (filtro.tipo) {
    case "opaco":
      return null;

    case "and": {
      let indeciso = false;
      for (const h of filtro.hijos) {
        const r = evaluar(h, nota);
        if (r === false) return false; // falso absorbe: da igual lo demás
        if (r === null) indeciso = true;
      }
      return indeciso ? null : true;
    }

    case "or": {
      let indeciso = false;
      for (const h of filtro.hijos) {
        const r = evaluar(h, nota);
        if (r === true) return true; // verdadero absorbe
        if (r === null) indeciso = true;
      }
      return indeciso ? null : false;
    }

    case "not": {
      // `not` con varios hijos niega su conjunción (es como lo escribe Obsidian).
      const r = evaluar({ tipo: "and", hijos: filtro.hijos }, nota);
      return r === null ? null : !r;
    }

    case "expr":
      return evaluarExpresion(filtro.fuente, nota);
  }
}

function evaluarExpresion(fuente: string, nota: NotaTabla): boolean | null {
  const e = analizar(fuente);
  if (e === null) return null;

  if (e.clase === "llamada") {
    const arg = e.args[0]?.texto ?? "";
    // Funciones de archivo: no leen una propiedad, miran la nota entera.
    if (e.ref === "file") {
      switch (e.metodo) {
        case "hasTag":
          return e.args.some((a) =>
            nota.tags.some((t) => t.toLowerCase() === a.texto.replace(/^#/, "").toLowerCase()),
          );
        case "inFolder": {
          const objetivo = arg.replace(/\/+$/, "");
          // Una carpeta contiene también a sus descendientes.
          return nota.carpeta === objetivo || nota.carpeta.startsWith(`${objetivo}/`);
        }
        case "hasProperty":
          return valoresDe(nota, arg) !== undefined;
        default:
          return null;
      }
    }

    const valores = valoresDe(nota, e.ref);
    switch (e.metodo) {
      case "isEmpty":
        return valores === undefined || valores.every((v) => v.trim() === "");
      case "contains":
        return valores !== undefined && valores.some((v) => enMinus(v).includes(enMinus(arg)));
      case "startsWith":
        return valores !== undefined && valores.some((v) => enMinus(v).startsWith(enMinus(arg)));
      case "endsWith":
        return valores !== undefined && valores.some((v) => enMinus(v).endsWith(enMinus(arg)));
      default:
        return null;
    }
  }

  const valores = valoresDe(nota, e.ref);
  if (valores === undefined) {
    // La propiedad no existe. `!= algo` es verdad (no lo tiene), y cualquier otra
    // comparación es falsa. Es decidible, así que no devuelve null.
    return e.op === "!=";
  }

  switch (e.op) {
    case "==":
      return valores.some((v) => comparar(v, e.literal) === 0);
    case "!=":
      return !valores.some((v) => comparar(v, e.literal) === 0);
    case ">":
      return valores.some((v) => comparar(v, e.literal) > 0);
    case "<":
      return valores.some((v) => comparar(v, e.literal) < 0);
    case ">=":
      return valores.some((v) => comparar(v, e.literal) >= 0);
    case "<=":
      return valores.some((v) => comparar(v, e.literal) <= 0);
    default:
      return null;
  }
}

const enMinus = (s: string): string => s.toLowerCase();

// ── Armado de la tabla ────────────────────────────────────────────────────────

export type Fila = { nota: NotaTabla; celdas: (string[] | undefined)[] };

export type Tabla =
  | { ok: true; columnas: string[]; filas: Fila[]; total: number; recortadas: number }
  | { ok: false; motivo: string; expresion: string | null };

/** Todas las expresiones opacas de un árbol de filtros, para poder explicarlas. */
export function opacosDe(filtro: Filtro | null): { fuente: string; motivo: string }[] {
  if (filtro === null) return [];
  if (filtro.tipo === "opaco") return [{ fuente: filtro.fuente, motivo: filtro.motivo }];
  if (filtro.tipo === "expr") return [];
  return filtro.hijos.flatMap(opacosDe);
}

/**
 * Aplica una vista al conjunto de notas. Si alguna fila queda indecidible (§ 2
 * de la spec) NO se devuelve un resultado a medias: se devuelve el motivo, para
 * que la UI pueda explicarlo y ofrecer ver la tabla sin filtrar.
 */
export function construirTabla(
  base: Base,
  vista: Vista,
  notas: NotaTabla[],
  opciones: { ignorarFiltros?: boolean } = {},
): Tabla {
  if (vista.noSoportada !== null) {
    return { ok: false, motivo: vista.noSoportada, expresion: null };
  }

  const columnas = vista.columnas.length > 0 ? vista.columnas : ["file.name"];
  const raiz: Filtro | null =
    base.filtros && vista.filtros
      ? { tipo: "and", hijos: [base.filtros, vista.filtros] }
      : (base.filtros ?? vista.filtros);

  let elegidas = notas;
  if (raiz !== null && opciones.ignorarFiltros !== true) {
    const opacos = opacosDe(raiz);
    elegidas = [];
    for (const nota of notas) {
      const r = evaluar(raiz, nota);
      if (r === null) {
        const primero = opacos[0];
        return {
          ok: false,
          motivo: primero
            ? `No se puede aplicar un filtro: ${primero.motivo}.`
            : "No se puede aplicar el filtro.",
          expresion: primero?.fuente ?? null,
        };
      }
      if (r) elegidas.push(nota);
    }
  }

  const ordenadas = [...elegidas];
  for (const criterio of [...vista.orden].reverse()) {
    ordenadas.sort((a, b) => {
      const va = valoresDe(a, criterio.propiedad)?.[0] ?? "";
      const vb = valoresDe(b, criterio.propiedad)?.[0] ?? "";
      const cmp = comparar(va, literal(vb));
      return criterio.descendente ? -cmp : cmp;
    });
  }

  const total = ordenadas.length;
  const visibles = vista.limite !== null ? ordenadas.slice(0, vista.limite) : ordenadas;

  return {
    ok: true,
    columnas,
    filas: visibles.map((nota) => ({
      nota,
      celdas: columnas.map((c) => valoresDe(nota, c)),
    })),
    total,
    recortadas: total - visibles.length,
  };
}

/** Cabecera de una columna: el `displayName` si lo hay, si no la clave a secas. */
export function tituloColumna(base: Base, ref: string): string {
  if (base.nombres[ref]) return base.nombres[ref];
  if (ref === "file.name" || ref === "file.basename") return "Nombre";
  if (ref === "file.folder") return "Carpeta";
  if (ref === "file.path") return "Ruta";
  if (ref === "file.ext") return "Tipo";
  if (ref === "file.tags") return "Etiquetas";
  if (ref === "file.ctime") return "Creada";
  if (ref === "file.mtime") return "Modificada";
  if (ref === "file.size") return "Tamaño";
  return ref.startsWith("note.") ? ref.slice(5) : ref;
}

/** Contenido de una base recién creada: lo mínimo que ya muestra algo. */
export function baseInicial(): string {
  return [
    "views:",
    "  - type: table",
    "    name: Todas",
    "    order:",
    "      - file.name",
    "      - file.mtime",
    "",
  ].join("\n");
}

// ── Edición: de vuelta a YAML ─────────────────────────────────────────────────

/**
 * ¿Se puede editar este archivo desde la UI sin perder nada?
 *
 * Solo si Mycelium entiende el archivo **entero**. Si trae `formulas`, un
 * `groupBy` o un filtro fuera del subconjunto, regenerar el YAML desde el modelo
 * los borraría — y el usuario perdería trabajo por haber pulsado un botón. En ese
 * caso la UI ofrece editar la fuente, que no pierde nada porque no reescribe nada.
 *
 * Devuelve la lista de motivos; vacía = se puede editar.
 */
export function motivosNoEditable(base: Base): string[] {
  const motivos: string[] = [];
  for (const clave of base.ignoradas) {
    motivos.push(`el archivo usa \`${clave}\`, que Mycelium todavía no modela`);
  }
  for (const vista of base.vistas) {
    for (const clave of vista.ignoradas) {
      motivos.push(`la vista «${vista.nombre}» usa \`${clave}\``);
    }
  }
  const opacos = [...opacosDe(base.filtros), ...base.vistas.flatMap((v) => opacosDe(v.filtros))];
  for (const o of opacos) {
    motivos.push(`el filtro \`${o.fuente}\` no se entiende (${o.motivo})`);
  }
  return motivos;
}

/** Una condición del constructor de filtros: `propiedad operador valor`. */
export type Condicion = { ref: string; op: string; valor: string };

/** Operadores que ofrece el constructor, con su etiqueta y si piden valor. */
export const OPERADORES_UI: { op: string; etiqueta: string; sinValor?: boolean }[] = [
  { op: "==", etiqueta: "es igual a" },
  { op: "!=", etiqueta: "no es" },
  { op: ">", etiqueta: "es mayor que" },
  { op: "<", etiqueta: "es menor que" },
  { op: ">=", etiqueta: "es mayor o igual que" },
  { op: "<=", etiqueta: "es menor o igual que" },
  { op: "contains", etiqueta: "contiene" },
  { op: "startsWith", etiqueta: "empieza por" },
  { op: "endsWith", etiqueta: "termina en" },
  { op: "isEmpty", etiqueta: "está vacía", sinValor: true },
  { op: "hasTag", etiqueta: "tiene la etiqueta" },
  { op: "inFolder", etiqueta: "está en la carpeta" },
  { op: "hasProperty", etiqueta: "tiene la propiedad" },
];

/** Operadores que se aplican al ARCHIVO y no a una propiedad concreta. */
export const OPS_DE_ARCHIVO = new Set(["hasTag", "inFolder", "hasProperty"]);
const OPS_METODO = new Set(["contains", "startsWith", "endsWith", "isEmpty"]);

const escaparTexto = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Una condición → el texto de la expresión que se escribe en el YAML. */
export function expresionDe(c: Condicion): string {
  if (OPS_DE_ARCHIVO.has(c.op)) return `file.${c.op}("${escaparTexto(c.valor)}")`;
  if (c.op === "isEmpty") return `${c.ref}.isEmpty()`;
  if (OPS_METODO.has(c.op)) return `${c.ref}.${c.op}("${escaparTexto(c.valor)}")`;
  // Un número se escribe SIN comillas, para que se compare como número y no como
  // texto (`prioridad > 10` tiene que ser falso con prioridad 3, no verdadero).
  const literal = /^-?\d+(?:\.\d+)?$/.test(c.valor.trim())
    ? c.valor.trim()
    : `"${escaparTexto(c.valor)}"`;
  return `${c.ref} ${c.op} ${literal}`;
}

/** El texto de una expresión → condición del constructor, o null si no encaja. */
function condicionDe(fuente: string): Condicion | null {
  const e = analizar(fuente);
  if (e === null) return null;
  if (e.clase === "llamada") {
    if (e.ref === "file" && OPS_DE_ARCHIVO.has(e.metodo)) {
      // El constructor maneja UN argumento; `hasTag("a", "b")` no cabe sin perder
      // el segundo, así que se declara no representable.
      if (e.args.length !== 1) return null;
      return { ref: "file", op: e.metodo, valor: e.args[0].texto };
    }
    if (OPS_METODO.has(e.metodo)) {
      return { ref: e.ref, op: e.metodo, valor: e.args[0]?.texto ?? "" };
    }
    return null;
  }
  return { ref: e.ref, op: e.op, valor: e.literal.texto };
}

/**
 * El filtro tal como lo edita el constructor (`FUN-M-27`).
 *
 * Es un **árbol** y no una lista plana porque el motor ya sabía combinar: `Filtro`
 * tiene `and`, `or` y `not`, y `evaluar` los resuelve desde siempre. Lo que
 * faltaba era una interfaz capaz de expresarlos, así que este tipo es un espejo
 * de aquel — con dos diferencias, las dos deliberadas:
 *
 * 1. **La negación es una marca, no un nivel.** En `Filtro`, negar algo lo
 *    envuelve en un `not`. Acá es un `negado` sobre el propio nodo: para el
 *    usuario «no empieza por X» es *una* condición, no dos anidadas, y una
 *    interfaz que le muestre un nivel extra por cada negación se vuelve un árbol
 *    de cajas por algo que él lee como una palabra.
 * 2. **No hay `opaco`.** Lo que el constructor no sabe representar no se
 *    convierte a medias: `arbolDeFiltro` devuelve `null` y la UI se declara
 *    incapaz. Ver la advertencia de esa función.
 */
export type NodoFiltro =
  | { tipo: "grupo"; combinador: "and" | "or"; negado: boolean; hijos: NodoFiltro[] }
  | { tipo: "cond"; negado: boolean; cond: Condicion };

/** Un grupo vacío, que es con lo que arranca un archivo sin filtros. */
export const GRUPO_VACIO: NodoFiltro = {
  tipo: "grupo",
  combinador: "and",
  negado: false,
  hijos: [],
};

/**
 * Filtro → árbol del constructor, o **`null` si no se puede representar**.
 *
 * > [!important] Devolver `null` es la garantía, no una limitación
 * > Es lo que impide que abrir un filtro que el constructor no entiende y
 * > guardarlo lo **destruya**. Con la lista plana ese `null` aparecía ante
 * > cualquier anidamiento o `not`; ahora esos se representan, así que solo queda
 * > para lo que de verdad no cabe: una expresión fuera del subconjunto
 * > (`opaco`) o una que no encaja en `propiedad operador valor` —un
 * > `hasTag("a", "b")`, por ejemplo—.
 * >
 * > Si algún día el constructor gana más formas, esta guarda tiene que seguir
 * > siendo igual de estricta: lo que no se sabe mostrar, no se muestra.
 */
export function arbolDeFiltro(filtro: Filtro | null): NodoFiltro | null {
  if (filtro === null) return { ...GRUPO_VACIO };
  return aNodo(filtro, false);
}

function aNodo(filtro: Filtro, negado: boolean): NodoFiltro | null {
  switch (filtro.tipo) {
    case "opaco":
      return null;

    case "expr": {
      const cond = condicionDe(filtro.fuente);
      return cond === null ? null : { tipo: "cond", negado, cond };
    }

    case "and":
    case "or": {
      const hijos: NodoFiltro[] = [];
      for (const h of filtro.hijos) {
        const nodo = aNodo(h, false);
        if (nodo === null) return null;
        hijos.push(nodo);
      }
      return { tipo: "grupo", combinador: filtro.tipo, negado, hijos };
    }

    case "not": {
      // Un `not` de UN hijo es la negación de ese hijo, y así se muestra: la
      // marca viaja al nodo en vez de gastar un nivel de anidamiento.
      if (filtro.hijos.length === 1) {
        const nodo = aNodo(filtro.hijos[0], !negado);
        return nodo;
      }
      // Con varios hijos niega su conjunción, que es como lo escribe Obsidian.
      const hijos: NodoFiltro[] = [];
      for (const h of filtro.hijos) {
        const nodo = aNodo(h, false);
        if (nodo === null) return null;
        hijos.push(nodo);
      }
      return { tipo: "grupo", combinador: "and", negado: !negado, hijos };
    }
  }
}

/**
 * Árbol del constructor → filtro, o `null` si no queda nada que filtrar.
 *
 * Descarta lo que está **a medias** con la misma regla que usa la UI para
 * conservarlo en pantalla (`condicionAplicable`, ver `DEF-080`): una condición
 * sin valor no se escribe en el archivo, y un grupo que se queda sin hijos
 * desaparece en vez de escribir un `and: []` que no filtra nada pero ensucia.
 */
export function filtroDeArbol(nodo: NodoFiltro): Filtro | null {
  if (nodo.tipo === "cond") {
    if (!condicionAplicable(nodo.cond)) return null;
    const expr: Filtro = { tipo: "expr", fuente: expresionDe(nodo.cond) };
    return nodo.negado ? { tipo: "not", hijos: [expr] } : expr;
  }
  const hijos: Filtro[] = [];
  for (const h of nodo.hijos) {
    const f = filtroDeArbol(h);
    if (f !== null) hijos.push(f);
  }
  if (hijos.length === 0) return null;
  const grupo: Filtro = { tipo: nodo.combinador, hijos };
  return nodo.negado ? { tipo: "not", hijos: [grupo] } : grupo;
}

/**
 * Un árbol de filtros → la lista plana que el constructor sabe representar, o
 * `null` si no cabe (anidamientos, `not`, o expresiones que no encajan).
 *
 * Devolver `null` es lo importante: es lo que hace que la UI se niegue a mostrar
 * un constructor que no representa lo que hay, en vez de enseñar una versión
 * simplificada que al guardar destruiría el filtro real.
 */
export function condicionesPlanas(
  filtro: Filtro | null,
): { combinador: "and" | "or"; condiciones: Condicion[] } | null {
  if (filtro === null) return { combinador: "and", condiciones: [] };
  if (filtro.tipo !== "and" && filtro.tipo !== "or") return null;

  const condiciones: Condicion[] = [];
  for (const hijo of filtro.hijos) {
    if (hijo.tipo !== "expr") return null;
    const c = condicionDe(hijo.fuente);
    if (c === null) return null;
    condiciones.push(c);
  }
  return { combinador: filtro.tipo, condiciones };
}

/**
 * ¿Esta condición está completa y por lo tanto filtra?
 *
 * Una a medias —sin campo, o sin valor cuando el operador lo pide— **no se
 * escribe en el archivo**: un filtro incompleto en disco cambiaría lo que la
 * tabla muestra y lo que otra app lee. Pero tampoco debe desaparecer de la
 * pantalla mientras se la termina de armar (`DEF-080`), y por eso la regla está
 * acá y no repetida en la UI: los dos lados tienen que coincidir en qué cuenta
 * como completa, o el constructor perdería justo lo que el archivo descarta.
 */
export function condicionAplicable(c: Condicion): boolean {
  return c.ref !== "" && (c.valor !== "" || c.op === "isEmpty");
}

/** Lista de condiciones → árbol de filtros (`null` si no queda ninguna útil). */
export function filtroDeCondiciones(
  combinador: "and" | "or",
  condiciones: Condicion[],
): Filtro | null {
  const utiles = condiciones.filter(condicionAplicable);
  if (utiles.length === 0) return null;
  return {
    tipo: combinador,
    hijos: utiles.map((c) => ({ tipo: "expr", fuente: expresionDe(c) })),
  };
}

/** Un escalar → YAML, entrecomillando solo cuando hace falta. */
function escalarYaml(v: string): string {
  if (v === "") return '""';
  if (/^-?\d+(\.\d+)?$/.test(v)) return `"${v}"`;
  if (/^[\p{L}\p{N}._/ -]+$/u.test(v)) return v;
  return `"${escaparTexto(v)}"`;
}

function filtroYaml(filtro: Filtro, sangriaBase: string): string[] {
  if (filtro.tipo === "expr" || filtro.tipo === "opaco") {
    return [`${sangriaBase}- ${filtro.fuente}`];
  }
  const lineas = [`${sangriaBase}${filtro.tipo}:`];
  for (const hijo of filtro.hijos) {
    if (hijo.tipo === "expr" || hijo.tipo === "opaco") {
      lineas.push(`${sangriaBase}  - ${hijo.fuente}`);
    } else {
      const dentro = filtroYaml(hijo, `${sangriaBase}      `);
      lineas.push(`${sangriaBase}  - ${dentro[0].trimStart()}`);
      lineas.push(...dentro.slice(1));
    }
  }
  return lineas;
}

/**
 * El modelo → texto del `.base`. Solo se llama cuando `motivosNoEditable` está
 * vacío: no intenta conservar lo que no entiende porque, en ese caso, la UI ni
 * siquiera deja llegar hasta acá.
 */
export function serializarBase(base: Base): string {
  const lineas: string[] = [];

  if (base.filtros !== null) {
    lineas.push("filters:");
    lineas.push(...filtroYaml(base.filtros, "  "));
    lineas.push("");
  }

  const nombres = Object.entries(base.nombres);
  if (nombres.length > 0) {
    lineas.push("properties:");
    for (const [clave, display] of nombres) {
      lineas.push(`  ${clave}:`);
      lineas.push(`    displayName: ${escalarYaml(display)}`);
    }
    lineas.push("");
  }

  lineas.push("views:");
  for (const v of base.vistas) {
    lineas.push(`  - type: ${v.tipo}`);
    lineas.push(`    name: ${escalarYaml(v.nombre)}`);
    if (v.limite !== null) lineas.push(`    limit: ${v.limite}`);
    if (v.filtros !== null) {
      lineas.push("    filters:");
      lineas.push(...filtroYaml(v.filtros, "      "));
    }
    if (v.columnas.length > 0) {
      lineas.push("    order:");
      for (const c of v.columnas) lineas.push(`      - ${c}`);
    }
    if (v.orden.length > 0) {
      lineas.push("    sort:");
      for (const o of v.orden) {
        lineas.push(`      - property: ${o.propiedad}`);
        lineas.push(`        direction: ${o.descendente ? "DESC" : "ASC"}`);
      }
    }
  }

  return `${lineas.join("\n")}\n`;
}

/**
 * Columnas y propiedades elegibles: los campos del archivo más todas las claves
 * que existan en el vault. Se calcula de las notas ya cargadas, así que no hace
 * falta otra consulta.
 */
export function columnasDisponibles(notas: NotaTabla[]): { ref: string; grupo: string }[] {
  const archivo = [
    "file.name",
    "file.folder",
    "file.path",
    "file.tags",
    "file.ext",
    "file.ctime",
    "file.mtime",
    "file.size",
  ].map((ref) => ({ ref, grupo: "Del archivo" }));

  const claves = new Map<string, string>();
  for (const n of notas) {
    for (const p of n.props) {
      const k = p.clave.toLowerCase();
      if (!claves.has(k)) claves.set(k, p.clave);
    }
  }
  const propiedades = [...claves.values()]
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((ref) => ({ ref, grupo: "Propiedades" }));

  return [...archivo, ...propiedades];
}
