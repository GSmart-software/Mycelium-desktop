/**
 * Esquemas de propiedades (`FUN-M-46`, propuesta 5 de `ia-vaults-intensivos`):
 * qué propiedades tiene que tener una nota, de qué tipo y con qué valores. Y el
 * aviso del `#` sin comillas, que no necesita esquema.
 *
 * Módulo **puro**: lo usan la tarjeta y la pestaña de propiedades, el panel de
 * salud, `mycelium_validar_nota` / `mycelium_salud` y los diagnósticos del
 * editor (`FUN-M-44`). `scripts/test-esquemas.mjs` lo transpila e importa sin
 * build. Spec: `docs/features/ia-vaults-intensivos.md` § 5.
 *
 * ## Dónde se declaran
 *
 * En **`esquemas.yml`, en la raíz del vault**: un archivo visible, que viaja con
 * el vault y se abre y edita en el visor de código de la app. No en `.mycelium/`
 * —es interno y oculto— ni en el frontmatter de una nota «índice» —habría que
 * buscarla y un enlace la podría romper—. Es YAML porque es lo que ya escribe
 * quien usa propiedades, y lo lee el mismo parser de las Bases (`parsearYaml`).
 *
 * ```yaml
 * Proyecto:                       # el nombre del esquema (sale en los avisos)
 *   carpeta: Proyectos            # Proyectos/ y sus subcarpetas (o una lista)
 *   obligatorias: [estado, inicio]
 *   propiedades:
 *     estado:
 *       tipo: texto
 *       valores: [activo, pausado, cerrado]
 *     inicio: fecha               # forma corta: solo el tipo
 * Reunión:
 *   tipo_de_nota: reunion         # las notas con `tipo: reunion`
 *   propiedades:
 *     fecha: { … }                # NO: los mapas en línea no se entienden
 * ```
 *
 * ## A qué notas aplica
 *
 * - `carpeta`: la carpeta **y sus subcarpetas**; una o una lista. `/` o vacía
 *   es el vault entero.
 * - `tipo_de_nota`: el valor de la propiedad `tipo` de la nota; uno o una
 *   lista. Sin distinguir mayúsculas.
 * - Con las dos, tienen que cumplirse las dos. Sin ninguna, aplica a todas.
 * - Solo a notas markdown, y nunca a las Esporas (son moldes: sus valores son
 *   `{{variables}}`) ni a `CLAUDE.md`/`AGENTS.md` de la raíz (`excluida`).
 *
 * ## Si aplican varios
 *
 * **Se combinan**: cada esquema se valida por su cuenta y la nota tiene que
 * cumplirlos todos. Las obligatorias se suman, y si dos esquemas declaran la
 * misma clave valen las dos restricciones (en la práctica, la intersección). El
 * mismo aviso de dos esquemas sale una vez, con los dos nombres.
 *
 * ## Lo que se avisa (nunca se bloquea el guardado)
 *
 * Obligatoria que falta o que está vacía, valor de tipo incorrecto, valor no
 * permitido, frontmatter que Mycelium no interpreta (no se puede validar) y el
 * `#` sin comillas. Un esquema mal escrito no rompe nada: lo inválido se ignora
 * y se informa en `avisos` del archivo.
 */
import { ErrorBase, parsearYaml, type Nodo } from "@/lib/bases";
import { NOMBRE_TIPO, separarFrontmatter, type TipoPropiedad, type ValorPropiedad } from "@/lib/frontmatter";

/** Dónde vive el archivo de esquemas: en la raíz del vault. */
export const RUTA_ESQUEMAS = "esquemas.yml";

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Lo que un esquema dice de una propiedad. */
export type ReglaPropiedad = {
  /** La clave como se escribió en el esquema. */
  clave: string;
  /** El tipo esperado, o `null` si no se declaró (o era desconocido). */
  tipo: TipoPropiedad | null;
  /** Valores permitidos, o `null` si se admite cualquiera. */
  valores: string[] | null;
};

export type Esquema = {
  nombre: string;
  /** Carpetas normalizadas (sin `/` al borde); vacía = todo el vault. */
  carpetas: string[];
  /** Valores de la propiedad `tipo` (en minúsculas); vacía = cualquiera. */
  tiposDeNota: string[];
  /** Claves obligatorias, como se escribieron. */
  obligatorias: string[];
  /** Reglas por clave en minúsculas. */
  propiedades: Map<string, ReglaPropiedad>;
};

/** Un problema del archivo de esquemas, con la línea si se sabe. */
export type AvisoEsquemas = { mensaje: string; linea?: number };

export type ArchivoEsquemas = { esquemas: Esquema[]; avisos: AvisoEsquemas[] };

/** Clase de un aviso de propiedades: para el ícono, la severidad y los tests. */
export type ClaseAviso = "falta" | "vacia" | "tipo" | "valor" | "comentario" | "nosoportado";

/** Un aviso sobre las propiedades de una nota. */
export type AvisoPropiedad = {
  clase: ClaseAviso;
  /** La clave de la nota (o la del esquema, si falta); `null` = el bloque entero. */
  clave: string | null;
  /** Línea del documento (desde 1) donde mostrarlo. */
  linea: number;
  mensaje: string;
  /** Los esquemas que lo piden (vacío para el `#`). */
  esquemas: string[];
};

/** Lo mínimo de una nota para saber qué esquemas le tocan. */
export type NotaEsquema = { id: string; carpetaId: string | null; tipo?: string };

// ── Utilidades ───────────────────────────────────────────────────────────────

const sinCr = (l: string): string => (l.endsWith("\r") ? l.slice(0, -1) : l);

const esMapa = (n: Nodo | undefined): n is { [clave: string]: Nodo } =>
  typeof n === "object" && n !== null && !Array.isArray(n);

/** Un nodo que puede ser un texto o una lista de textos → lista de textos. */
function comoLista(n: Nodo | undefined): string[] | null {
  if (n === undefined) return [];
  if (typeof n === "string") return n.trim() === "" ? [] : [n.trim()];
  if (Array.isArray(n)) {
    if (n.some((x) => typeof x !== "string")) return null;
    return (n as string[]).map((s) => s.trim()).filter((s) => s !== "");
  }
  return null;
}

/** Para comparar tipos escritos a mano: sin mayúsculas, tildes, espacios ni `_`. */
const plano = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\s_-]+/g, "");

/** Los nombres que se aceptan para cada tipo (ya en `plano`). */
const TIPOS_ESCRITOS: Record<string, TipoPropiedad> = {
  texto: "texto",
  numero: "numero",
  casilla: "casilla",
  fecha: "fecha",
  fechayhora: "fechaHora",
  fechahora: "fechaHora",
  lista: "lista",
};

/** Cómo se nombran los tipos en el archivo, para los avisos. */
export const TIPOS_VALIDOS = "texto, numero, casilla, fecha, fecha_hora, lista";

/** Normaliza una carpeta escrita a mano: barras POSIX, sin `/` al borde. */
export function normalizarCarpeta(c: string): string {
  return c.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
}

/**
 * Quita el comentario final de una línea del archivo (`carpeta: X  # nota`).
 * Un `#` abre comentario si va precedido de espacio y fuera de comillas; el
 * parser de las Bases solo descarta las líneas que son enteras comentario.
 */
function sinComentarioFinal(linea: string): string {
  let comilla: string | null = null;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comilla) {
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") comilla = c;
    else if (c === "#" && (i === 0 || /\s/.test(linea[i - 1]))) return linea.slice(0, i).trimEnd();
  }
  return linea;
}

// ── El archivo ───────────────────────────────────────────────────────────────

const CLAVES_ESQUEMA = new Set(["carpeta", "carpetas", "tipodenota", "obligatorias", "propiedades"]);
const CLAVES_REGLA = new Set(["tipo", "valores", "obligatoria"]);

/** El tipo de una regla, o el aviso de por qué no se entiende. */
function leerTipo(bruto: string, donde: string, avisos: AvisoEsquemas[]): TipoPropiedad | null {
  const t = TIPOS_ESCRITOS[plano(bruto)];
  if (t) return t;
  avisos.push({ mensaje: `${donde}: el tipo «${bruto}» no existe (son: ${TIPOS_VALIDOS}). Se valida sin tipo.` });
  return null;
}

/**
 * Lee `esquemas.yml`. Nunca lanza: un YAML ilegible da cero esquemas y un
 * aviso; un esquema o una regla mal escritos se ignoran (solo esa parte) con su
 * aviso. Un archivo vacío (o solo comentarios) es válido y sin esquemas.
 */
export function parsearEsquemas(texto: string): ArchivoEsquemas {
  const avisos: AvisoEsquemas[] = [];
  const limpio = texto.split("\n").map((l) => sinComentarioFinal(sinCr(l))).join("\n");
  if (limpio.trim() === "") return { esquemas: [], avisos };

  let raiz: Record<string, Nodo>;
  try {
    raiz = parsearYaml(limpio);
  } catch (e) {
    const motivo = e instanceof ErrorBase ? e.message : String((e as Error)?.message ?? e);
    const linea = /l[ií]nea (\d+)/.exec(motivo)?.[1];
    avisos.push({
      mensaje: `${RUTA_ESQUEMAS} no se puede leer (${motivo}): no se aplica ningún esquema.`,
      linea: linea ? Number(linea) : undefined,
    });
    return { esquemas: [], avisos };
  }

  const esquemas: Esquema[] = [];
  for (const [nombre, nodo] of Object.entries(raiz)) {
    const donde = `Esquema «${nombre}»`;
    if (!esMapa(nodo)) {
      avisos.push({ mensaje: `${donde}: debe ser un bloque con carpeta, tipo_de_nota, obligatorias o propiedades. Se ignora.` });
      continue;
    }
    for (const k of Object.keys(nodo)) {
      if (!CLAVES_ESQUEMA.has(plano(k))) avisos.push({ mensaje: `${donde}: «${k}» no es una clave de esquema (son: carpeta, tipo_de_nota, obligatorias, propiedades). Se ignora.` });
    }
    const campo = (nombreCampo: string): Nodo | undefined => {
      const k = Object.keys(nodo).find((x) => plano(x) === nombreCampo);
      return k === undefined ? undefined : nodo[k];
    };

    const carpetasBrutas = comoLista(campo("carpeta") ?? campo("carpetas"));
    const tipos = comoLista(campo("tipodenota"));
    const obligatorias = comoLista(campo("obligatorias"));
    if (carpetasBrutas === null || tipos === null || obligatorias === null) {
      avisos.push({ mensaje: `${donde}: carpeta, tipo_de_nota y obligatorias son un texto o una lista de textos. Se ignora el esquema.` });
      continue;
    }

    const propiedades = new Map<string, ReglaPropiedad>();
    const extraObligatorias: string[] = [];
    const props = campo("propiedades");
    if (props !== undefined && props !== "" && !esMapa(props)) {
      avisos.push({ mensaje: `${donde}: «propiedades» debe ser un bloque con una clave por propiedad. Se ignora.` });
    } else if (esMapa(props)) {
      for (const [clave, def] of Object.entries(props)) {
        const dondeRegla = `${donde}, propiedad «${clave}»`;
        let tipo: TipoPropiedad | null = null;
        let valores: string[] | null = null;
        if (typeof def === "string") {
          if (def.trim().startsWith("{")) {
            avisos.push({ mensaje: `${dondeRegla}: los mapas en línea ({…}) no se entienden; escribe tipo y valores en líneas con sangría. Se valida sin tipo.` });
          } else if (def.trim() !== "") tipo = leerTipo(def.trim(), dondeRegla, avisos);
        } else if (esMapa(def)) {
          for (const k of Object.keys(def)) {
            if (!CLAVES_REGLA.has(plano(k))) avisos.push({ mensaje: `${dondeRegla}: «${k}» no se entiende (son: tipo, valores, obligatoria). Se ignora.` });
          }
          const tipoBruto = def.tipo;
          if (typeof tipoBruto === "string" && tipoBruto.trim() !== "") tipo = leerTipo(tipoBruto.trim(), dondeRegla, avisos);
          else if (tipoBruto !== undefined && typeof tipoBruto !== "string") avisos.push({ mensaje: `${dondeRegla}: «tipo» es un texto. Se valida sin tipo.` });
          if (def.valores !== undefined) {
            const v = comoLista(def.valores);
            if (v === null) avisos.push({ mensaje: `${dondeRegla}: «valores» es una lista de textos. Se ignora.` });
            else if (v.length > 0) valores = v;
          }
          const ob = def.obligatoria;
          if (typeof ob === "string" && /^(true|s[ií])$/i.test(ob.trim())) extraObligatorias.push(clave);
        } else {
          avisos.push({ mensaje: `${dondeRegla}: escribe el tipo (\`${clave}: fecha\`) o un bloque con tipo y valores. Se ignora.` });
          continue;
        }
        propiedades.set(clave.toLowerCase(), { clave, tipo, valores });
      }
    }

    const todas = [...obligatorias];
    for (const c of extraObligatorias) if (!todas.some((o) => o.toLowerCase() === c.toLowerCase())) todas.push(c);
    esquemas.push({
      nombre,
      carpetas: carpetasBrutas.map(normalizarCarpeta),
      tiposDeNota: tipos.map((t) => t.toLowerCase()),
      obligatorias: todas,
      propiedades,
    });
  }
  return { esquemas, avisos };
}

// ── A qué notas aplica ───────────────────────────────────────────────────────

/** El valor de una propiedad leída, en minúsculas y como lista. */
function valoresEnMinuscula(valor: ValorPropiedad | undefined): string[] {
  if (valor === undefined) return [];
  return (Array.isArray(valor) ? valor : [valor]).map((v) => String(v).trim().toLowerCase());
}

/** ¿Está la nota en la carpeta (o debajo)? `""` es el vault entero. */
function enCarpeta(nota: NotaEsquema, carpeta: string): boolean {
  if (carpeta === "") return true;
  const propia = (nota.carpetaId ?? "").toLowerCase();
  const c = carpeta.toLowerCase();
  return propia === c || propia.startsWith(`${c}/`);
}

/**
 * Los esquemas que aplican a una nota, en el orden del archivo. `tipoDeNota` es
 * el valor de su propiedad `tipo` (o `undefined` si no la tiene).
 */
export function esquemasDe(
  nota: NotaEsquema,
  tipoDeNota: ValorPropiedad | undefined,
  esquemas: readonly Esquema[],
): Esquema[] {
  if (nota.tipo !== undefined && nota.tipo !== "markdown") return [];
  const tipos = valoresEnMinuscula(tipoDeNota);
  return esquemas.filter(
    (e) =>
      (e.carpetas.length === 0 || e.carpetas.some((c) => enCarpeta(nota, c))) &&
      (e.tiposDeNota.length === 0 || e.tiposDeNota.some((t) => tipos.includes(t))),
  );
}

// ── El `#` sin comillas ──────────────────────────────────────────────────────

/**
 * Valores del frontmatter que empiezan con `#` sin comillas (`Issue: #24`). En
 * YAML un `#` precedido de espacio abre un comentario: para Obsidian, para un
 * script con `yaml.load` o para la IA que lee la nota, esa propiedad queda
 * **nula**. Mycelium la lee como texto —para no perder lo escrito—, así que en
 * la app se ve bien y el problema pasa en silencio.
 *
 * Se mira el texto crudo, línea por línea, y no las propiedades ya leídas:
 * `"#24"` entre comillas y `#24` sin ellas dan el mismo valor.
 *
 * No se avisa:
 * - en `tags`: Mycelium documenta que sus valores se escriben con o sin `#`, y
 *   los toma como etiquetas;
 * - dentro de una lista en línea (`[#a, #b]`): empieza con `[`;
 * - un valor entre comillas, ni un comentario al final (`x: valor # nota`), ni
 *   una línea que es entera un comentario.
 *
 * Sí se avisa en un elemento de una lista en bloque (`- #x`), que YAML también
 * deja nulo. Funciona aunque el bloque no sea un mapa plano (lo no soportado).
 */
export function avisosAlmohadilla(texto: string): AvisoPropiedad[] {
  const lineas = texto.split("\n");
  if (lineas.length < 2 || sinCr(lineas[0]) !== "---") return [];
  const avisos: AvisoPropiedad[] = [];
  let claveActual: string | null = null;
  for (let i = 1; i < lineas.length; i++) {
    const l = sinCr(lineas[i]);
    if (l === "---" || l === "...") break;
    const t = l.trim();
    if (t === "" || t.startsWith("#")) continue;

    const item = /^-(?:[ \t]+(.*))?$/.exec(t);
    if (item) {
      const valor = (item[1] ?? "").trim();
      if (claveActual !== null && claveActual.toLowerCase() !== "tags" && valor.startsWith("#")) {
        avisos.push(avisoAlmohadilla(claveActual, valor, i + 1, true));
      }
      continue;
    }
    const m = /^([^:#\s][^:]*?)[ \t]*:[ \t]*(.*)$/.exec(t);
    if (!m) continue;
    const clave = m[1].trim().replace(/^["']|["']$/g, "");
    // Solo una clave de primer nivel es dueña de los `- ` que la siguen.
    if (!/^[ \t]/.test(l)) claveActual = clave;
    const valor = m[2].trim();
    if (clave.toLowerCase() !== "tags" && valor.startsWith("#")) avisos.push(avisoAlmohadilla(clave, valor, i + 1, false));
  }
  return avisos;
}

function avisoAlmohadilla(clave: string, valor: string, linea: number, enLista: boolean): AvisoPropiedad {
  // Lo que se ve del valor: hasta el primer espacio, que es lo que suele ser (#24, #idea).
  const visto = valor.split(/\s/)[0];
  const ejemplo = enLista ? `- "${valor}"` : `${clave}: "${valor}"`;
  return {
    clase: "comentario",
    clave,
    linea,
    mensaje:
      `El valor ${visto === "#" ? "" : `«${visto}» `}de «${clave}» empieza con # sin comillas: en YAML se lee como ` +
      `comentario y la propiedad queda vacía para otros programas. Ponlo entre comillas: ${ejemplo}`,
    esquemas: [],
  };
}

// ── Validar una nota ─────────────────────────────────────────────────────────

/** Una propiedad leída, con lo que la validación necesita. */
type Leida = { clave: string; tipo: TipoPropiedad; valor: ValorPropiedad; linea: number };

const FORMATO: Record<TipoPropiedad, string> = {
  texto: "texto",
  numero: "número",
  casilla: "casilla (true o false)",
  fecha: "fecha (AAAA-MM-DD)",
  fechaHora: "fecha y hora (AAAA-MM-DDTHH:mm)",
  lista: "lista ([a, b] o una línea «- » por elemento)",
};

/** ¿El valor leído es del tipo que pide el esquema? `texto` admite cualquier escalar. */
export function cumpleTipo(tipoLeido: TipoPropiedad, esperado: TipoPropiedad): boolean {
  if (esperado === "texto") return tipoLeido !== "lista";
  return tipoLeido === esperado;
}

const vacia = (v: ValorPropiedad): boolean => (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");

/**
 * Valida el texto de una nota contra los esquemas: el `#` sin comillas siempre,
 * y los esquemas que le apliquen si no está `excluida` (Espora, instrucciones).
 * Los avisos salen ordenados por línea, sin repetidos.
 */
export function validarPropiedades(
  nota: NotaEsquema,
  texto: string,
  esquemas: readonly Esquema[],
  opciones: { excluida?: boolean } = {},
): AvisoPropiedad[] {
  const avisos: AvisoPropiedad[] = [];
  if (nota.tipo !== undefined && nota.tipo !== "markdown") return avisos;
  avisos.push(...avisosAlmohadilla(texto));
  if (opciones.excluida || esquemas.length === 0) return ordenar(avisos);

  const fm = separarFrontmatter(texto);
  if (fm.hay && !fm.soportado) {
    // Sin propiedades no se sabe su `tipo`: solo cuentan los esquemas por carpeta.
    const aplican = esquemasDe(nota, undefined, esquemas.filter((e) => e.tiposDeNota.length === 0));
    if (aplican.length > 0) {
      avisos.push({
        clase: "nosoportado",
        clave: null,
        linea: 1,
        mensaje: `No se pueden validar las propiedades: Mycelium no interpreta este frontmatter (${fm.motivo}).`,
        esquemas: aplican.map((e) => e.nombre),
      });
    }
    return ordenar(avisos);
  }

  const leidas: Leida[] =
    fm.hay && fm.soportado ? fm.props.map((p) => ({ clave: p.clave, tipo: p.tipo, valor: p.valor, linea: p.desdeLinea + 1 })) : [];
  const porClave = new Map(leidas.map((p) => [p.clave.toLowerCase(), p]));
  const aplican = esquemasDe(nota, porClave.get("tipo")?.valor, esquemas);
  avisos.push(...avisosDeEsquemas(leidas, aplican));
  return ordenar(avisos);
}

/**
 * Los avisos de esquemas sobre unas propiedades ya leídas. Separada de
 * `validarPropiedades` para que se pueda probar sin texto.
 */
export function avisosDeEsquemas(leidas: readonly Leida[], aplican: readonly Esquema[]): AvisoPropiedad[] {
  const porClave = new Map(leidas.map((p) => [p.clave.toLowerCase(), p]));
  // Mismo aviso de dos esquemas → uno solo con los dos nombres.
  const juntos = new Map<string, AvisoPropiedad>();
  const sumar = (a: Omit<AvisoPropiedad, "esquemas">, esquema: string) => {
    const k = `${a.clase}\u0000${a.clave?.toLowerCase()}\u0000${a.mensaje}`;
    const previo = juntos.get(k);
    if (previo) {
      if (!previo.esquemas.includes(esquema)) previo.esquemas.push(esquema);
    } else juntos.set(k, { ...a, esquemas: [esquema] });
  };

  for (const e of aplican) {
    for (const ob of e.obligatorias) {
      const p = porClave.get(ob.toLowerCase());
      if (!p) sumar({ clase: "falta", clave: ob, linea: 1, mensaje: `Falta la propiedad obligatoria «${ob}».` }, e.nombre);
      else if (vacia(p.valor)) sumar({ clase: "vacia", clave: p.clave, linea: p.linea, mensaje: `La propiedad obligatoria «${p.clave}» está vacía.` }, e.nombre);
    }
    for (const regla of e.propiedades.values()) {
      const p = porClave.get(regla.clave.toLowerCase());
      if (!p || vacia(p.valor)) continue;
      if (regla.tipo !== null && !cumpleTipo(p.tipo, regla.tipo)) {
        sumar(
          {
            clase: "tipo",
            clave: p.clave,
            linea: p.linea,
            mensaje: `«${p.clave}» debería ser ${FORMATO[regla.tipo]}, y es ${NOMBRE_TIPO[p.tipo].toLowerCase()}.`,
          },
          e.nombre,
        );
        continue;
      }
      if (regla.valores !== null) {
        const permitidos = regla.valores.map((v) => v.toLowerCase());
        const malos = (Array.isArray(p.valor) ? p.valor : [p.valor])
          .map((v) => String(v).trim())
          .filter((v) => v !== "" && !permitidos.includes(v.toLowerCase()));
        if (malos.length > 0) {
          sumar(
            {
              clase: "valor",
              clave: p.clave,
              linea: p.linea,
              mensaje:
                `«${p.clave}» no admite ${malos.map((v) => `«${v}»`).join(", ")}: ` +
                `${regla.valores.length === 1 ? "el valor permitido es" : "los valores permitidos son"} ${regla.valores.join(", ")}.`,
            },
            e.nombre,
          );
        }
      }
    }
  }
  return [...juntos.values()];
}

const ORDEN_CLASE: Record<ClaseAviso, number> = { nosoportado: 0, falta: 1, vacia: 2, tipo: 3, valor: 4, comentario: 5 };

function ordenar(avisos: AvisoPropiedad[]): AvisoPropiedad[] {
  return avisos.sort((a, b) => a.linea - b.linea || ORDEN_CLASE[a.clase] - ORDEN_CLASE[b.clase]);
}

/** El texto de un aviso con los esquemas que lo piden, para listados y tooltips. */
export function textoDeAviso(a: AvisoPropiedad): string {
  if (a.esquemas.length === 0) return a.mensaje;
  const nombres = a.esquemas.map((n) => `«${n}»`).join(", ");
  return `${a.mensaje} (${a.esquemas.length === 1 ? "esquema" : "esquemas"} ${nombres})`;
}

/** Los avisos de una clave (sin distinguir mayúsculas), para marcar su fila. */
export function avisosDeClave(avisos: readonly AvisoPropiedad[], clave: string): AvisoPropiedad[] {
  const k = clave.toLowerCase();
  return avisos.filter((a) => a.clave !== null && a.clave.toLowerCase() === k);
}

/** El chequeo «Propiedades válidas» de `mycelium_validar_nota`. */
export function chequeoPropiedades(
  avisos: readonly AvisoPropiedad[],
  aplican: number,
): { id: string; ok: boolean; titulo: string; detalle: string[] } {
  return {
    id: "propiedades_validas",
    ok: avisos.length === 0,
    titulo: "Propiedades válidas",
    detalle:
      avisos.length > 0
        ? avisos.map((a) => `Línea ${a.linea}: ${textoDeAviso(a)}`)
        : [aplican > 0 ? `Cumple ${aplican === 1 ? "el esquema que le aplica" : `los ${aplican} esquemas que le aplican`}.` : "Ningún esquema de esquemas.yml le aplica, y no hay valores con # sin comillas."],
  };
}

/** Cuántos esquemas aplican a una nota con este texto (para el detalle del chequeo). */
export function cuantosAplican(nota: NotaEsquema, texto: string, esquemas: readonly Esquema[]): number {
  if (esquemas.length === 0) return 0;
  const fm = separarFrontmatter(texto);
  const tipo = fm.hay && fm.soportado ? fm.props.find((p) => p.clave.toLowerCase() === "tipo")?.valor : undefined;
  return esquemasDe(nota, tipo, esquemas).length;
}

/** Una nota del listado de la salud: con título y sus avisos. */
export type NotaConAvisosDePropiedades = { ruta: string; titulo: string; avisos: AvisoPropiedad[] };

/**
 * Las notas que no cumplen (para el panel de salud y `mycelium_salud`): valida
 * cada nota con contenido conocido y devuelve las que tienen avisos, por ruta.
 * Las que no tienen contenido en `contenidos` no se miran.
 */
export function notasQueNoCumplen(
  notas: readonly (NotaEsquema & { titulo: string; excluida?: boolean })[],
  contenidos: ReadonlyMap<string, string>,
  esquemas: readonly Esquema[],
): NotaConAvisosDePropiedades[] {
  const fuera: NotaConAvisosDePropiedades[] = [];
  for (const n of notas) {
    const texto = contenidos.get(n.id);
    if (texto === undefined) continue;
    const avisos = validarPropiedades(n, texto, esquemas, { excluida: n.excluida });
    if (avisos.length > 0) fuera.push({ ruta: n.id, titulo: n.titulo, avisos });
  }
  return fuera.sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
}
