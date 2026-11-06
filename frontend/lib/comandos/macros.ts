/**
 * Las macros (`FUN-XL-04`, Parte 6; absorbe `FUN-L-01`): una **secuencia de
 * pasos** con nombre que se ejecuta desde la paleta o con un atajo propio.
 *
 * Cada macro se registra como un comando más del catálogo (`macro.<id>`), así
 * que hereda la paleta, la hoja de atajos, los conflictos, las teclas
 * reservadas y Configuración → Atajos de teclado sin código aparte.
 *
 * Los pasos son de un juego cerrado, fácil de validar:
 * - **comando**: cualquier comando del registro por id, con sus `args`;
 * - **texto**: insertar un texto en el editor activo, donde está el cursor;
 * - **abrir**: abrir una nota por ruta o título (como un `[[enlace]]`), y
 *   crearla si no existe;
 * - **espora**: crear una nota desde una Espora, en una carpeta opcional;
 * - **esperar**: unos milisegundos, con tope.
 *
 * Los tres del medio son comandos con datos (`editor.insertar-texto`,
 * `nota.abrir`, `espora.crear`): el paso es solo una forma cómoda de
 * escribirlos. Las variables `{{fecha}}`, `{{hora}}`, `{{fecha:FORMATO}}` y
 * `{{titulo}}` son las de las Esporas (`lib/esporas.ts`).
 *
 * Lógica pura —sin React ni stores— para que la pruebe
 * `scripts/test-macros.mjs`. Dónde se guardan: `preferenciasMacros.ts`; los
 * comandos: `comandosMacros.ts`; la sección: `MacrosSection.tsx`.
 */
import { sustituirVariables } from "@/lib/esporas";
import type { ArgsComando, ContextoComando } from "./registro";

/** El prefijo de los comandos de las macros: `macro.nota-del-dia`. */
export const PREFIJO_MACRO = "macro.";

/** El tope de un paso «esperar»: más que esto sería una macro colgada. */
export const ESPERA_MAXIMA_MS = 10_000;

/** Cuántos pasos puede tener una macro. */
export const MAX_PASOS = 100;

/** Cuántas macros pueden llamarse unas a otras, una dentro de otra. */
export const PROFUNDIDAD_MAXIMA = 8;

export type PasoComando = { tipo: "comando"; comando: string; args?: ArgsComando };
export type PasoTexto = { tipo: "texto"; texto: string };
export type PasoAbrir = { tipo: "abrir"; nota: string; crear?: boolean; contenido?: string };
export type PasoEspora = { tipo: "espora"; espora: string; carpeta?: string };
export type PasoEsperar = { tipo: "esperar"; ms: number };

export type Paso = PasoComando | PasoTexto | PasoAbrir | PasoEspora | PasoEsperar;
export type TipoPaso = Paso["tipo"];

export type Macro = {
  /** Estable: el comando es `macro.<id>` y los atajos se guardan con ese id. */
  id: string;
  nombre: string;
  pasos: Paso[];
};

/** Los tipos de paso, en el orden del selector, con su nombre visible. */
export const TIPOS_DE_PASO: readonly { tipo: TipoPaso; nombre: string }[] = [
  { tipo: "comando", nombre: "Ejecutar un comando" },
  { tipo: "texto", nombre: "Insertar texto" },
  { tipo: "abrir", nombre: "Abrir una nota" },
  { tipo: "espora", nombre: "Crear desde una Espora" },
  { tipo: "esperar", nombre: "Esperar" },
];

/** El comando del catálogo que ejecuta cada tipo de paso con datos. */
export const COMANDO_DE_PASO = {
  texto: "editor.insertar-texto",
  abrir: "nota.abrir",
  espora: "espora.crear",
} as const;

const ID_MACRO_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ID_COMANDO_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;

export const idDeComandoMacro = (idMacro: string) => `${PREFIJO_MACRO}${idMacro}`;
export const esComandoMacro = (idComando: string) => idComando.startsWith(PREFIJO_MACRO);
export const idMacroDeComando = (idComando: string) =>
  esComandoMacro(idComando) ? idComando.slice(PREFIJO_MACRO.length) : null;

/** El comando y los datos que ejecuta un paso, o `null` para «esperar». */
export function invocacionDePaso(p: Paso): { comando: string; args?: ArgsComando } | null {
  switch (p.tipo) {
    case "comando":
      return { comando: p.comando, args: p.args };
    case "texto":
      return { comando: COMANDO_DE_PASO.texto, args: { texto: p.texto } };
    case "abrir": {
      const args: ArgsComando = { nota: p.nota };
      if (p.crear) args.crear = true;
      if (p.contenido) args.contenido = p.contenido;
      return { comando: COMANDO_DE_PASO.abrir, args };
    }
    case "espora": {
      const args: ArgsComando = { espora: p.espora };
      if (p.carpeta) args.carpeta = p.carpeta;
      return { comando: COMANDO_DE_PASO.espora, args };
    }
    case "esperar":
      return null;
  }
}

/**
 * El paso que corresponde a ejecutar un comando con estos datos: el inverso de
 * `invocacionDePaso`. Lo usa la grabación, para que un comando con datos quede
 * como el paso que se lee mejor.
 */
export function pasoDeInvocacion(comando: string, args?: ArgsComando): Paso {
  if (comando === COMANDO_DE_PASO.texto && typeof args?.texto === "string") return { tipo: "texto", texto: args.texto };
  if (comando === COMANDO_DE_PASO.abrir && typeof args?.nota === "string") {
    const p: PasoAbrir = { tipo: "abrir", nota: args.nota };
    if (args.crear === true) p.crear = true;
    if (typeof args.contenido === "string" && args.contenido) p.contenido = args.contenido;
    return p;
  }
  if (comando === COMANDO_DE_PASO.espora && typeof args?.espora === "string") {
    const p: PasoEspora = { tipo: "espora", espora: args.espora };
    if (typeof args.carpeta === "string" && args.carpeta) p.carpeta = args.carpeta;
    return p;
  }
  return args && Object.keys(args).length ? { tipo: "comando", comando, args } : { tipo: "comando", comando };
}

// ── leer lo guardado ───────────────────────────────────────────────────────

const esTexto = (v: unknown): v is string => typeof v === "string";

/** Datos de un comando: solo texto, número, casilla o nada. */
function argsValidos(crudo: unknown): ArgsComando | null | undefined {
  if (crudo === undefined || crudo === null) return undefined;
  if (typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const salida: ArgsComando = {};
  for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
    if (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) {
      salida[k] = v as string | number | boolean | null;
    } else {
      return null;
    }
  }
  return Object.keys(salida).length ? salida : undefined;
}

/** Lo que venga de `localStorage` → un paso válido, o `null`. */
export function normalizarPaso(crudo: unknown): Paso | null {
  if (crudo === null || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const o = crudo as Record<string, unknown>;
  switch (o.tipo) {
    case "comando": {
      if (!esTexto(o.comando) || !ID_COMANDO_RE.test(o.comando)) return null;
      const args = argsValidos(o.args);
      if (args === null) return null;
      return args ? { tipo: "comando", comando: o.comando, args } : { tipo: "comando", comando: o.comando };
    }
    case "texto":
      return esTexto(o.texto) ? { tipo: "texto", texto: o.texto } : null;
    case "abrir": {
      if (!esTexto(o.nota) || !o.nota.trim()) return null;
      const p: PasoAbrir = { tipo: "abrir", nota: o.nota };
      if (o.crear === true) p.crear = true;
      if (esTexto(o.contenido) && o.contenido) p.contenido = o.contenido;
      return p;
    }
    case "espora": {
      if (!esTexto(o.espora) || !o.espora.trim()) return null;
      const p: PasoEspora = { tipo: "espora", espora: o.espora };
      if (esTexto(o.carpeta) && o.carpeta.trim()) p.carpeta = o.carpeta;
      return p;
    }
    case "esperar": {
      if (typeof o.ms !== "number" || !Number.isFinite(o.ms)) return null;
      return { tipo: "esperar", ms: limitarEspera(o.ms) };
    }
    default:
      return null;
  }
}

export const limitarEspera = (ms: number) => Math.min(ESPERA_MAXIMA_MS, Math.max(0, Math.round(ms)));

/**
 * Lo que venga de `localStorage` (`{ version, macros }`) → las macros válidas y
 * qué se descartó, en palabras, para mostrarlo en la sección. Un paso inválido
 * se descarta solo; una macro sin id, sin nombre o con un id repetido, entera.
 * Los comandos que no existen **no** se descartan: puede que se registren más
 * tarde (los del explorador, por ejemplo); se avisan al editar y fallan con un
 * mensaje claro al ejecutar.
 */
export function normalizarMacros(crudo: unknown): { macros: Macro[]; descartes: string[] } {
  const descartes: string[] = [];
  const lista =
    crudo && typeof crudo === "object" && !Array.isArray(crudo) ? (crudo as Record<string, unknown>).macros : undefined;
  if (!Array.isArray(lista)) {
    if (crudo !== undefined && crudo !== null) descartes.push("Las macros guardadas no se pudieron leer.");
    return { macros: [], descartes };
  }
  const macros: Macro[] = [];
  const ids = new Set<string>();
  lista.forEach((m, i) => {
    const o = m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
    const nombre = o && esTexto(o.nombre) ? o.nombre.trim() : "";
    const etiqueta = nombre ? `«${nombre}»` : `n.º ${i + 1}`;
    if (!o || !esTexto(o.id) || !ID_MACRO_RE.test(o.id)) {
      descartes.push(`La macro ${etiqueta} no tiene un identificador válido: se descartó.`);
      return;
    }
    if (!nombre) {
      descartes.push(`La macro ${etiqueta} no tiene nombre: se descartó.`);
      return;
    }
    if (ids.has(o.id)) {
      descartes.push(`La macro ${etiqueta} repite el identificador «${o.id}»: se descartó.`);
      return;
    }
    const crudos = Array.isArray(o.pasos) ? o.pasos : [];
    const pasos: Paso[] = [];
    let malos = 0;
    for (const p of crudos.slice(0, MAX_PASOS)) {
      const valido = normalizarPaso(p);
      if (valido) pasos.push(valido);
      else malos++;
    }
    if (malos) descartes.push(`La macro ${etiqueta} tenía ${malos === 1 ? "un paso inválido" : `${malos} pasos inválidos`}: se quitaron.`);
    if (crudos.length > MAX_PASOS) descartes.push(`La macro ${etiqueta} tenía más de ${MAX_PASOS} pasos: se quitaron los últimos.`);
    ids.add(o.id);
    macros.push({ id: o.id, nombre, pasos });
  });
  return { macros, descartes };
}

// ── las llamadas entre macros ──────────────────────────────────────────────

/** Los ids de las macros que una macro llama (sus pasos `macro.<id>`). */
export function llamadasDe(m: Macro): string[] {
  const ids: string[] = [];
  for (const p of m.pasos) {
    if (p.tipo !== "comando") continue;
    const id = idMacroDeComando(p.comando);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * El primer ciclo que se alcanza desde la macro `id` (la lista de ids, con el
 * primero repetido al final: `a → b → a`), o `null` si no hay. Una macro que se
 * llama a sí misma, directo o a través de otras, nunca terminaría.
 */
export function cicloDesde(id: string, macros: readonly Macro[]): string[] | null {
  const porId = new Map(macros.map((m) => [m.id, m]));
  const camino: string[] = [];
  const cerrados = new Set<string>();
  const visitar = (actual: string): string[] | null => {
    const i = camino.indexOf(actual);
    if (i >= 0) return [...camino.slice(i), actual];
    if (cerrados.has(actual)) return null;
    const m = porId.get(actual);
    if (!m) return null;
    camino.push(actual);
    for (const otra of llamadasDe(m)) {
      const ciclo = visitar(otra);
      if (ciclo) return ciclo;
    }
    camino.pop();
    cerrados.add(actual);
    return null;
  };
  return visitar(id);
}

/** ¿Agregar a la macro `id` un paso que llame a `destino` armaría un ciclo? */
export function llamadaCreaCiclo(id: string, destino: string, macros: readonly Macro[]): boolean {
  if (id === destino) return true;
  const conLlamada = macros.map((m) =>
    m.id === id ? { ...m, pasos: [...m.pasos, { tipo: "comando", comando: idDeComandoMacro(destino) } as Paso] } : m,
  );
  return cicloDesde(id, conLlamada) !== null;
}

/** El ciclo en palabras: «Diario → Resumen → Diario». */
export function textoCiclo(ciclo: readonly string[], macros: readonly Macro[]): string {
  return ciclo.map((id) => macros.find((m) => m.id === id)?.nombre ?? id).join(" → ");
}

// ── validar ────────────────────────────────────────────────────────────────

/**
 * Los problemas de una macro, en palabras (lista vacía = está bien): sin
 * nombre, sin pasos, un comando que no existe, una macro que no existe, un
 * ciclo. `existe` dice si un comando está en el registro.
 */
export function validarMacro(
  m: Macro,
  { existe, macros }: { existe: (idComando: string) => boolean; macros: readonly Macro[] },
): string[] {
  const problemas: string[] = [];
  if (!m.nombre.trim()) problemas.push("La macro no tiene nombre.");
  if (m.pasos.length === 0) problemas.push("La macro no tiene pasos.");
  m.pasos.forEach((p, i) => {
    const n = i + 1;
    if (p.tipo === "comando") {
      const idMacro = idMacroDeComando(p.comando);
      if (idMacro !== null) {
        if (!macros.some((x) => x.id === idMacro)) problemas.push(`Paso ${n}: la macro «${idMacro}» no existe.`);
      } else if (!existe(p.comando)) {
        problemas.push(`Paso ${n}: el comando «${p.comando}» no existe o no está disponible en esta pantalla.`);
      }
    } else if (p.tipo === "texto" && !p.texto) {
      problemas.push(`Paso ${n}: no hay texto para insertar.`);
    } else if (p.tipo === "abrir" && !p.nota.trim()) {
      problemas.push(`Paso ${n}: falta la nota que se abre.`);
    } else if (p.tipo === "espora" && !p.espora.trim()) {
      problemas.push(`Paso ${n}: falta el nombre de la Espora.`);
    }
  });
  const ciclo = cicloDesde(m.id, macros.some((x) => x.id === m.id) ? macros : [...macros, m]);
  if (ciclo) problemas.push(`Se llama a sí misma: ${textoCiclo(ciclo, macros)}. Una macro así nunca terminaría.`);
  return problemas;
}

// ── nombres e ids ──────────────────────────────────────────────────────────

/** Un id libre a partir del nombre: «Nota del día» → `nota-del-dia` (o `nota-del-dia-2`). */
export function idParaNombre(nombre: string, ocupados: Iterable<string>): string {
  const usados = new Set(ocupados);
  const base =
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "macro";
  if (!usados.has(base)) return base;
  let n = 2;
  while (usados.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Un nombre libre: «Macro nueva», «Macro nueva 2»… (sin distinguir mayúsculas). */
export function nombreLibre(base: string, macros: readonly Macro[]): string {
  const usados = new Set(macros.map((m) => m.nombre.toLowerCase()));
  if (!usados.has(base.toLowerCase())) return base;
  let n = 2;
  while (usados.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

// ── las variables ──────────────────────────────────────────────────────────

/**
 * Las variables de las Esporas en un texto de una macro: `{{fecha}}`,
 * `{{hora}}`, `{{fecha:FORMATO}}` y `{{titulo}}` (el de la nota activa, o el
 * de la nota que se crea, según el paso). Las desconocidas quedan escritas.
 */
export function expandirVariables(texto: string, { titulo = "", ahora }: { titulo?: string; ahora?: Date } = {}): string {
  return sustituirVariables(texto, { titulo, ahora });
}

// ── ejecutar ───────────────────────────────────────────────────────────────

/** Lo que el ejecutor necesita de un comando del registro. */
export type ComandoEjecutable = {
  titulo: string;
  soloDev?: boolean;
  disponible?: (ctx: ContextoComando) => boolean;
  ejecutar: (ctx: ContextoComando, args?: ArgsComando) => unknown;
};

export type EntornoMacro = {
  ctx: ContextoComando;
  /** El comando del registro con ese id (con su título ya resuelto). */
  comando: (id: string) => ComandoEjecutable | undefined;
  /** La macro con ese id. */
  macro: (id: string) => Macro | undefined;
  /** Espera unos milisegundos (el paso «esperar»). */
  esperar: (ms: number) => Promise<void>;
  /** Antes de cada paso: deja que la interfaz se pinte (dos cuadros). */
  entrePasos?: () => Promise<void>;
};

export type ResultadoMacro =
  | { ok: true; pasos: number }
  /** `paso` empieza en 1; `macro` es el nombre de la que falló (puede ser una llamada). */
  | { ok: false; macro: string; paso: number; motivo: string };

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Ejecuta los pasos de una macro **en orden**, esperando cada uno: si el
 * comando devuelve una promesa, el siguiente paso arranca cuando se cumple. Si
 * un paso falla —el comando no existe, no está disponible, lanza o rechaza—,
 * se detiene ahí y devuelve cuál y por qué.
 *
 * Un paso `macro.<id>` ejecuta esa macro dentro de esta. `pila` son las macros
 * en curso: si la llamada ya está en ella, sería un ciclo y el paso falla en
 * vez de colgar la app (la sección no deja guardarlos, pero el almacén se
 * puede editar a mano o desde otra ventana).
 */
export async function ejecutarMacro(
  macro: Macro,
  entorno: EntornoMacro,
  pila: readonly string[] = [],
): Promise<ResultadoMacro> {
  const fallo = (paso: number, motivo: string): ResultadoMacro => ({ ok: false, macro: macro.nombre, paso, motivo });
  if (pila.includes(macro.id)) return fallo(0, "la macro se llama a sí misma");
  if (pila.length >= PROFUNDIDAD_MAXIMA) return fallo(0, `hay más de ${PROFUNDIDAD_MAXIMA} macros una dentro de otra`);
  const enCurso = [...pila, macro.id];
  for (let i = 0; i < macro.pasos.length; i++) {
    const paso = macro.pasos[i];
    const n = i + 1;
    await entorno.entrePasos?.();
    if (paso.tipo === "esperar") {
      await entorno.esperar(limitarEspera(paso.ms));
      continue;
    }
    const inv = invocacionDePaso(paso)!;
    const idMacro = idMacroDeComando(inv.comando);
    if (idMacro !== null) {
      const otra = entorno.macro(idMacro);
      if (!otra) return fallo(n, `la macro «${idMacro}» no existe`);
      if (enCurso.includes(otra.id)) {
        return fallo(n, `llamaría a «${otra.nombre}», que ya está en curso: una macro no puede llamarse a sí misma`);
      }
      const r = await ejecutarMacro(otra, entorno, enCurso);
      if (!r.ok) return r;
      continue;
    }
    const c = entorno.comando(inv.comando);
    if (!c || (c.soloDev && !entorno.ctx.dev)) {
      return fallo(n, `el comando «${inv.comando}» no existe o no está disponible en esta pantalla`);
    }
    if (c.disponible && !c.disponible(entorno.ctx)) return fallo(n, `«${c.titulo}» no está disponible ahora`);
    try {
      await c.ejecutar(entorno.ctx, inv.args);
    } catch (e) {
      return fallo(n, `«${c.titulo}»: ${mensaje(e)}`);
    }
  }
  return { ok: true, pasos: macro.pasos.length };
}

/** El fallo en una frase, para el aviso: «el paso 2 de «Nota del día» (…)». */
export function textoFallo(r: Extract<ResultadoMacro, { ok: false }>): string {
  return r.paso > 0 ? `el paso ${r.paso} de «${r.macro}» falló: ${r.motivo}` : `«${r.macro}»: ${r.motivo}`;
}

// ── las de fábrica ─────────────────────────────────────────────────────────

/**
 * Las macros de fábrica: las que tiene quien nunca tocó las suyas, y las que
 * vuelven con «Restaurar las macros de fábrica». Sin atajo: el usuario les da
 * uno en Configuración. Usan solo comandos que siempre están.
 */
export const MACROS_DE_FABRICA: readonly Macro[] = [
  {
    id: "nota-al-lado",
    nombre: "Nota nueva al lado",
    pasos: [
      { tipo: "comando", comando: "panel.dividir-derecha" },
      { tipo: "comando", comando: "nota.nueva" },
    ],
  },
  {
    id: "nota-del-dia",
    nombre: "Nota del día",
    pasos: [{ tipo: "abrir", nota: "Diario/{{fecha}}", crear: true, contenido: "# {{titulo}}\n\n" }],
  },
  {
    id: "ordenar-bandeja",
    nombre: "Ordenar la Bandeja",
    pasos: [{ tipo: "comando", comando: "bandeja.abrir" }],
  },
];

/** Una copia profunda (las de fábrica no se tocan nunca). */
export const copiarMacro = (m: Macro): Macro => ({ ...m, pasos: m.pasos.map((p) => structuredClone(p)) });

/** ¿Es igual a como salió de fábrica? */
export function igualQueDeFabrica(m: Macro): boolean {
  const f = MACROS_DE_FABRICA.find((x) => x.id === m.id);
  return !!f && JSON.stringify(f) === JSON.stringify(m);
}

/**
 * Vuelve a poner las macros de fábrica: las que se borraron vuelven al final y
 * las cambiadas vuelven a ser como venían. Las del usuario no se tocan.
 */
export function restaurarDeFabrica(macros: readonly Macro[]): Macro[] {
  const salida = macros.map((m) => {
    const f = MACROS_DE_FABRICA.find((x) => x.id === m.id);
    return f ? copiarMacro(f) : m;
  });
  for (const f of MACROS_DE_FABRICA) if (!salida.some((m) => m.id === f.id)) salida.push(copiarMacro(f));
  return salida;
}

// ── editar ─────────────────────────────────────────────────────────────────

/** Mueve el paso `i` una posición (`-1` arriba, `1` abajo). Fuera de rango, igual. */
export function moverPaso(pasos: readonly Paso[], i: number, delta: -1 | 1): Paso[] {
  const j = i + delta;
  if (i < 0 || i >= pasos.length || j < 0 || j >= pasos.length) return [...pasos];
  const copia = [...pasos];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

/** Un paso nuevo del tipo dado, con valores de partida. */
export function pasoNuevo(tipo: TipoPaso, comando = ""): Paso {
  switch (tipo) {
    case "comando":
      return { tipo, comando };
    case "texto":
      return { tipo, texto: "" };
    case "abrir":
      return { tipo, nota: "" };
    case "espora":
      return { tipo, espora: "" };
    case "esperar":
      return { tipo, ms: 500 };
  }
}
