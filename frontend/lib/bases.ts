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
    noSoportada: null,
  };
}

function vistaRota(motivo: string, indice: number): Vista {
  return {
    tipo: "?",
    nombre: `Vista ${indice + 1}`,
    limite: null,
    columnas: [],
    orden: [],
    filtros: null,
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
