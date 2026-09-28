/**
 * El corrector ortográfico del hilo principal (`FUN-L-12`): arranca y apaga el
 * worker, le manda los diccionarios activos y los dos personales —el del vault
 * y el de Mycelium—, y guarda en un caché lo que ya contestó.
 *
 * Es **uno por ventana** —un módulo, no un store—: todos los editores de la
 * ventana (las notas, el detalle de los recordatorios) comparten el worker, el
 * caché y las palabras ignoradas. «Ignorar» vale para toda la sesión y en
 * cualquier editor (§ 2.1 de la spec).
 *
 * Ciclo de vida:
 *
 *   - **Apagado** mientras el interruptor de Configuración esté apagado: sin
 *     worker ni memoria ocupada (criterio 13). Arranca la primera vez que un
 *     editor lo necesita (`asegurar`).
 *   - **Recarga** cuando cambian los diccionarios —una descarga, un «Quitar», una
 *     casilla «Activo», en esta ventana o en otra— o el vault: se vacía el caché y
 *     los editores vuelven a revisar lo visible.
 *   - Cuando cambia un **diccionario personal** —un «Agregar», un «Quitar» en
 *     Configuración; el de Mycelium, también desde otra ventana— no se recargan
 *     los diccionarios: se le mandan al worker las palabras nuevas y se vacía el
 *     caché, así las marcas se recalculan al instante en todos los editores.
 *
 * El editor nunca espera al worker: pide lo que falta y, cuando llega la
 * respuesta, se le avisa (`suscribir`) para que redibuje.
 */
import { avisar } from "@/stores/avisosStore";
import {
  descargar,
  escribirConfig,
  escucharCambios,
  escucharCambiosDeMycelium,
  guardarPalabrasDeMycelium,
  guardarPalabrasDelVault,
  consultarManifiesto,
  leerConfig,
  leerDescargado,
  leerPalabrasDeMycelium,
  leerPalabrasDelVault,
  listarDescargados,
  vaultActual,
} from "./diccionarios";
import { elegirVariante, lenguaDelSistema, localesDelSistema, regionDelSistema } from "./idioma";
import { diccionariosACargar, formatearBytes } from "./manifiesto";
import {
  CacheOrtografia,
  escribirDiccionarioPersonal,
  leerDiccionarioPersonal,
  normalizarPalabra,
} from "./palabras";
import type { MensajeAlCorrector, MensajeDelCorrector } from "./corrector.worker";

/** Dónde está el motor: `public/ortografia/motor.wasm`, servido junto a la app. */
const RUTA_MOTOR = "/ortografia/motor.wasm";

const cache = new CacheOrtografia();
/** Palabras ignoradas en esta sesión (no se guardan). */
const ignoradas = new Set<string>();
/** Editores (u otros) a los que avisar cuando hay respuestas nuevas o se vació el caché. */
const oyentes = new Set<() => void>();

let worker: Worker | null = null;
/**
 * Resuelve cuando el worker tiene cargados los diccionarios. Toda revisión lo
 * espera: una pregunta que llegara antes se contestaría «todo bien» —sin
 * diccionarios no hay contra qué marcar— y quedaría así en el caché.
 */
let listo: Promise<void> | null = null;
/** Cambia en cada recarga: una respuesta de antes ya no vale. */
let generacion = 0;
/**
 * Cambia cada vez que cambian las palabras personales. Aparte de `generacion`
 * porque esa corta una carga en curso, y un «Agregar» no debe cortarla. Una
 * revisión pedida antes del cambio vuelve con la respuesta vieja («mal
 * escrita») y no debe quedar en el caché recién vaciado.
 */
let epocaPersonales = 0;
let secuencia = 0;
const esperando = new Map<number, (m: MensajeDelCorrector) => void>();

/** El vault cuyas palabras están cargadas, y ellas. */
let vaultCargado: string | null = null;
let palabrasVault: string[] = [];
/** Las del diccionario de Mycelium (no dependen del vault). `null`: sin leer. */
let palabrasMycelium: string[] | null = null;
let dejarDeEscuchar: (() => void) | null = null;
let dejarDeEscucharMycelium: (() => void) | null = null;

function avisarOyentes() {
  for (const fn of oyentes) fn();
}

/** Recibir un aviso cuando cambie lo que el corrector sabe. Devuelve con qué darse de baja. */
export function suscribir(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function enviar(m: MensajeAlCorrector, transferir: Transferable[] = []) {
  worker?.postMessage(m, transferir);
}

function pedir(m: MensajeAlCorrector & { n: number }): Promise<MensajeDelCorrector> {
  return new Promise((resolver) => {
    esperando.set(m.n, resolver);
    enviar(m);
  });
}

/** ¿Está en marcha (o arrancando)? */
export function encendido(): boolean {
  return worker !== null;
}

/**
 * Arranca el corrector si no lo está. Idempotente: lo llama cada editor cada vez
 * que va a revisar. Si el vault de la ventana cambió, recarga sus palabras.
 */
export function asegurar(): void {
  if (typeof Worker === "undefined") return;
  if (worker) {
    if (vaultActual() !== vaultCargado) void recargarVault();
    return;
  }
  try {
    worker = new Worker(new URL("./corrector.worker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    console.error("[Mycelium] corrector · no se pudo crear el worker", e);
    worker = null;
    return;
  }
  worker.onmessage = (ev: MessageEvent<MensajeDelCorrector>) => {
    const m = ev.data;
    if (m.tipo === "revisado" || m.tipo === "sugerido") {
      const r = esperando.get(m.n);
      esperando.delete(m.n);
      r?.(m);
    } else if (m.tipo === "error") {
      console.error(`[Mycelium] corrector · ${m.mensaje}`);
    }
  };
  enviar({ tipo: "iniciar", urlMotor: new URL(RUTA_MOTOR, location.href).href });
  listo = cargar();
  if (!dejarDeEscuchar) {
    void escucharCambios(() => {
      if (worker) listo = cargar();
    }).then((dejar) => {
      dejarDeEscuchar = dejar;
    });
  }
  if (!dejarDeEscucharMycelium) {
    // Otra ventana (o esta misma: Rust avisa a todas) cambió el diccionario de
    // Mycelium: solo se releen sus palabras, sin recargar los diccionarios.
    void escucharCambiosDeMycelium(() => {
      if (worker) void recargarMycelium();
    }).then((dejar) => {
      dejarDeEscucharMycelium = dejar;
    });
  }
}

/** Apaga el corrector: termina el worker y olvida todo salvo lo ignorado. */
export function apagar(): void {
  worker?.terminate();
  worker = null;
  listo = null;
  generacion++;
  cache.vaciar();
  // Quien esperaba una respuesta no la va a recibir: se le contesta vacío.
  for (const [n, r] of esperando) r({ tipo: "revisado", n, correctas: [] });
  esperando.clear();
  dejarDeEscuchar?.();
  dejarDeEscuchar = null;
  dejarDeEscucharMycelium?.();
  dejarDeEscucharMycelium = null;
  avisarOyentes();
}

/**
 * (Re)carga los diccionarios activos y el del vault en el worker. Sin
 * diccionarios descargados, propone —una sola vez— bajar el del idioma del
 * sistema.
 */
async function cargar(): Promise<void> {
  const gen = ++generacion;
  cache.vaciar();
  try {
    const [config, descargados, palabras, deMycelium] = await Promise.all([
      leerConfig(),
      listarDescargados(),
      leerPalabrasDelVault(vaultActual()),
      // Un diccionario de Mycelium ilegible no debe dejar al corrector sin
      // diccionarios: se sigue sin sus palabras (y «Agregar» lo relee y falla
      // con el error, en vez de pisarlo).
      leerPalabrasDeMycelium().catch((e) => {
        console.error("[Mycelium] corrector · no se pudo leer el diccionario de Mycelium", e);
        return [];
      }),
    ]);
    vaultCargado = vaultActual();
    palabrasVault = palabras;
    palabrasMycelium = deMycelium;
    const locales = localesDelSistema();
    const region = regionDelSistema(locales);
    // La variante de la región, si está descargada, gana a otra de la misma
    // lengua (quedó una vieja tras cambiar la región del sistema).
    const preferidas = descargados
      .filter((d) => region !== null && d.id.endsWith(`-${region}`))
      .map((d) => d.id);
    const aCargar = diccionariosACargar(config.activas, descargados, preferidas);
    const lista = await Promise.all(
      aCargar.map(async (d) => ({ id: d.id, ...(await leerDescargado(d)) })),
    );
    if (gen !== generacion || !worker) return; // otra recarga (o un apagado) le ganó
    enviar({ tipo: "personales", palabras: personales() });
    enviar(
      { tipo: "diccionarios", lista },
      lista.flatMap((d) => [d.aff, d.dic]),
    );
    if (descargados.length === 0 && !config.propuestaHecha) void proponerDescarga(locales);
  } catch (e) {
    console.error("[Mycelium] corrector · no se pudieron cargar los diccionarios", e);
  }
  if (gen === generacion) avisarOyentes();
}

/**
 * La primera vez que el corrector arranca sin diccionarios, ofrece bajar el del
 * idioma del sistema, con su tamaño. Nunca descarga nada sin que se lo pidan; si
 * no hay conexión, no dice nada (Configuración lo ofrece igual).
 */
async function proponerDescarga(locales: string[]): Promise<void> {
  try {
    const manifiesto = await consultarManifiesto();
    const lengua = lenguaDelSistema(locales);
    const idioma = manifiesto.idiomas.find((i) => i.id === lengua) ?? manifiesto.idiomas.find((i) => i.id === "es");
    const variante = idioma ? elegirVariante(idioma, regionDelSistema(locales)) : null;
    if (!idioma || !variante) return;
    const config = await leerConfig();
    if (config.propuestaHecha) return;
    await escribirConfig({ ...config, propuestaHecha: true });
    avisar(
      `El corrector ortográfico no tiene diccionarios. ¿Descargar ${idioma.nombre} (${formatearBytes(variante.bytes)})?`,
      {
        etiqueta: "Descargar",
        hacer: async () => {
          try {
            await descargar(variante);
            await activarLengua(idioma.id, true);
          } catch (e) {
            avisar(`No se pudo descargar el diccionario: ${String(e)}`);
          }
        },
      },
    );
  } catch {
    // Sin conexión o sin manifiesto: se ofrece desde Configuración.
  }
}

/** Activa o desactiva una lengua en esta instalación (y recarga todas las ventanas). */
export async function activarLengua(lengua: string, activa: boolean): Promise<void> {
  const config = await leerConfig();
  const activas = new Set(config.activas);
  if (activa) activas.add(lengua);
  else activas.delete(lengua);
  await escribirConfig({ ...config, activas: [...activas] });
}

/**
 * Todo lo que el worker da por bueno además de los diccionarios: el del vault,
 * el de Mycelium y las ignoradas. Al worker le da igual de cuál viene cada
 * una; la diferencia es dónde se guardan.
 */
function personales(): string[] {
  return [...new Set([...palabrasVault, ...(palabrasMycelium ?? []), ...ignoradas])];
}

async function recargarMycelium(): Promise<void> {
  let leidas: string[];
  try {
    leidas = await leerPalabrasDeMycelium();
  } catch (e) {
    console.error("[Mycelium] corrector · no se pudo leer el diccionario de Mycelium", e);
    return;
  }
  // El aviso también le llega a la ventana que lo escribió, que ya tiene estas
  // palabras: no se vacía el caché por nada.
  if (palabrasMycelium && mismasPalabras(palabrasMycelium, leidas)) return;
  palabrasMycelium = leidas;
  cambiaronPersonales();
  for (const fn of oyentesPersonales) fn();
}

function mismasPalabras(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

async function recargarVault(): Promise<void> {
  const vault = vaultActual();
  vaultCargado = vault;
  try {
    palabrasVault = await leerPalabrasDelVault(vault);
  } catch (e) {
    console.error("[Mycelium] corrector · no se pudo leer el diccionario del vault", e);
    palabrasVault = [];
  }
  cambiaronPersonales();
}

function cambiaronPersonales() {
  enviar({ tipo: "personales", palabras: personales() });
  // Vaciar y no solo marcar la palabra como buena: con la regla de mayúsculas,
  // agregar «casa» también arregla «Casa» y «CASA», que están en el caché aparte.
  // Y al quitar una, la que estaba «bien» tiene que volver a preguntarse.
  epocaPersonales++;
  cache.vaciar();
  avisarOyentes();
}

// ── Consultas del editor ────────────────────────────────────────────────────

/** Lo que el caché sabe de una palabra: `false` = mal escrita, `undefined` = no se sabe. */
export function consultar(palabra: string): boolean | undefined {
  return cache.consultar(normalizarPalabra(palabra));
}

/** Las palabras (ya normalizadas) que el caché no conoce. */
export function pendientes(palabras: Iterable<string>): string[] {
  return cache.pendientes(palabras);
}

/**
 * Pregunta al worker por palabras que el caché no conoce y guarda las
 * respuestas. Resuelve `true` si las guardó (y hay algo nuevo que dibujar),
 * `false` si mientras tanto el corrector se recargó o se apagó.
 */
export async function revisar(palabras: string[]): Promise<boolean> {
  if (!worker || !listo || palabras.length === 0) return false;
  const gen = generacion;
  await listo;
  if (gen !== generacion || !worker) return false;
  const epoca = epocaPersonales;
  const r = await pedir({ tipo: "revisar", n: ++secuencia, palabras });
  if (gen !== generacion || epoca !== epocaPersonales) return false;
  if (r.tipo !== "revisado" || r.correctas.length !== palabras.length) return false;
  cache.guardar(palabras, r.correctas);
  return true;
}

/** Hasta 5 sugerencias para una palabra. */
export async function sugerir(palabra: string): Promise<string[]> {
  if (!worker || !listo) return [];
  await listo;
  if (!worker) return [];
  const r = await pedir({ tipo: "sugerir", n: ++secuencia, palabra: normalizarPalabra(palabra) });
  return r.tipo === "sugerido" ? r.sugerencias : [];
}

// ── Diccionarios personales e «Ignorar» ─────────────────────────────────────

/**
 * Los dos diccionarios personales (spec § 1): el **del vault**, que viaja con
 * él, y el **de Mycelium**, que vale para todos los vaults de esta instalación.
 */
export type DiccionarioPersonal = "vault" | "mycelium";

/** Las palabras de un diccionario personal (para Configuración), ordenadas. */
export async function palabrasDe(dic: DiccionarioPersonal): Promise<string[]> {
  if (dic === "mycelium") {
    if (worker && palabrasMycelium) return palabrasMycelium;
    return leerPalabrasDeMycelium();
  }
  if (worker && vaultActual() === vaultCargado) return palabrasVault;
  return leerPalabrasDelVault(vaultActual());
}

/**
 * Escrituras de los diccionarios personales, en cola: dos «Agregar» seguidos no
 * se pisan. Una sola cola para los dos: es raro que coincidan, y así no hay
 * que pensar en el orden entre ellos.
 */
let colaEscrituras: Promise<void> = Promise.resolve();

async function reescribir(dic: DiccionarioPersonal, cambiar: (palabras: string[]) => string[]): Promise<void> {
  const vault = vaultActual();
  if (dic === "vault" && vault === null) throw new Error("No hay un vault abierto donde guardar la palabra.");
  const tarea = colaEscrituras.then(async () => {
    // Se relee el archivo: puede haber cambiado desde que se cargó (otra
    // ventana, una edición a mano o una sincronización).
    // En memoria, igual que en el archivo (sin duplicados y ordenadas): así la
    // lista de Configuración sale en orden y el aviso de vuelta de Rust
    // (`recargarMycelium`) ve que no cambió nada.
    const comoEnDisco = (ps: string[]) => leerDiccionarioPersonal(escribirDiccionarioPersonal(ps));
    if (dic === "mycelium") {
      const nuevas = comoEnDisco(cambiar(await leerPalabrasDeMycelium()));
      await guardarPalabrasDeMycelium(nuevas);
      palabrasMycelium = nuevas;
    } else if (vault !== null) {
      const nuevas = comoEnDisco(cambiar(await leerPalabrasDelVault(vault)));
      await guardarPalabrasDelVault(vault, nuevas);
      if (vault === vaultCargado || !worker) {
        palabrasVault = nuevas;
        vaultCargado = vault;
      }
    }
  });
  colaEscrituras = tarea.catch(() => {});
  await tarea;
  cambiaronPersonales();
  for (const fn of oyentesPersonales) fn();
}

const oyentesPersonales = new Set<() => void>();
/**
 * Avisa cuando cambian las palabras de un diccionario personal (la lista de
 * Configuración). Con el corrector apagado, los cambios del de Mycelium hechos
 * en otra ventana no pasan por acá: llegan por `escucharCambiosDeMycelium`.
 */
export function suscribirPersonales(fn: () => void): () => void {
  oyentesPersonales.add(fn);
  return () => oyentesPersonales.delete(fn);
}

/**
 * «Agregar al diccionario del vault» (la desmarca en todas las notas de este
 * vault) o «… de Mycelium» (en todos los vaults).
 */
export async function agregarA(dic: DiccionarioPersonal, palabra: string): Promise<void> {
  const p = normalizarPalabra(palabra);
  await reescribir(dic, (actuales) => (actuales.includes(p) ? actuales : [...actuales, p]));
}

/** Quitar una palabra (desde Configuración): vuelve a marcarse. */
export async function quitarDe(dic: DiccionarioPersonal, palabra: string): Promise<void> {
  await reescribir(dic, (actuales) => actuales.filter((w) => w !== palabra));
}

/** «Ignorar»: no la marca más hasta cerrar la app, en ningún editor. */
export function ignorar(palabra: string): void {
  ignoradas.add(normalizarPalabra(palabra));
  cambiaronPersonales();
}
