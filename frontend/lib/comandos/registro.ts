/**
 * El catálogo único de comandos (`FUN-XL-04`, Parte 1): todo lo que Mycelium
 * sabe hacer como un **comando** con id estable, nombre, ícono, cuándo está
 * disponible y atajo por defecto. La paleta lo lista y el despachador de
 * atajos lo dispara; las partes siguientes (hoja de atajos, atajos
 * configurables, modo pistas, macros) se apoyan en él.
 *
 * Lógica pura —sin React ni stores— para que la pruebe
 * `scripts/test-comandos.mjs`.
 *
 * **Cómo se registra un comando.** El registro es una lista viva con alta y
 * baja: `registrarComandos(lista)` los suma y devuelve la función que los
 * saca. Los comandos de la app (`comandosApp.tsx`) los registra el workspace
 * al montarse, con `useRegistrarComandos`. Un comando **no** guarda closures
 * del componente que lo registra: lee lo que necesita de los stores
 * (`useXStore.getState()`) en el momento de ejecutarse, y lo que depende de
 * React (navegar) le llega en el `ContextoComando`. Así un comando sirve igual
 * desde la paleta, desde un atajo o desde una macro, y su `ejecutar` se puede
 * llamar con datos serializables (`args`). Un componente cuyo estado no vive
 * en un store (por ejemplo, la selección de un panel) puede sumar sus
 * comandos con el mismo hook mientras está montado: al desmontarse se van.
 */
import type { ComponentType } from "react";
import { comandosDisponibles } from "@/lib/modoDev";
import { coincide, reservaQueChoca, mismoAtajo, textoAtajo, CODES_VALIDOS, type Atajo, type EventoTecla } from "./atajos";
import { calcularEfectivos, type Efectivos, type Sobreescrituras } from "./personalizar";

/** Lo que un comando recibe al ejecutarse: lo que no puede leer de un store. */
export type ContextoComando = {
  /** Navega dentro del workspace (`router.replace`). */
  navegar: (url: string) => void;
  /** ¿Está encendido el modo desarrollador (`FUN-S-36`)? */
  dev: boolean;
};

/**
 * Los datos de un comando. Serializables (texto, número, casilla o nada) para
 * que una macro pueda guardarlos y encadenar comandos con ellos (Parte 6).
 */
export type ArgsComando = Record<string, string | number | boolean | null>;

/** Un texto fijo, o uno que se calcula al mostrarse (el del cambio de modo). */
export type Texto = string | (() => string);

export type IconoComando = ComponentType<{ size?: number }>;

export type CategoriaComando =
  | "notas"
  | "explorador"
  | "editor"
  | "navegacion"
  | "pestanas"
  | "paneles"
  | "vault"
  | "apariencia"
  | "app"
  | "macros"
  | "dev";

/**
 * Las categorías como se muestran en la hoja de atajos y en Configuración, en
 * ese orden.
 */
export const NOMBRE_CATEGORIA: Readonly<Record<CategoriaComando, string>> = {
  navegacion: "Navegación",
  pestanas: "Pestañas",
  paneles: "Paneles",
  notas: "Notas",
  explorador: "Explorador",
  editor: "Editor de notas",
  vault: "Vault",
  apariencia: "Apariencia",
  app: "Aplicación",
  macros: "Macros",
  dev: "Desarrollo",
};

export type Comando = {
  /** Estable: lo guardan los atajos configurables y las macros. `area.accion`. */
  id: string;
  titulo: Texto;
  detalle?: Texto;
  icono: IconoComando;
  categoria: CategoriaComando;
  /** Los atajos por defecto; el primero es el que se muestra. */
  atajos?: readonly Atajo[];
  /** Muestra el atajo entre paréntesis en el título y no en el detalle. */
  atajoEnTitulo?: boolean;
  /**
   * Muestra el atajo de otro comando. Para «Mostrar u ocultar el explorador»
   * de la paleta, que muestra Ctrl+\ aunque esa tecla sea del panel izquierdo
   * entero (`panel.izquierdo.alternar`): con el explorador como última
   * sección, hacen lo mismo.
   */
  muestraAtajoDe?: string;
  /**
   * Su atajo lo atiende un manejador propio y no el despachador del
   * workspace: F1 (`AyudaGlobal`, en captura y en toda la app), F12 y
   * Ctrl+Shift+I (`DevToolsHotkey`) y Ctrl+Shift+Espacio (`CapturaRapida`, en
   * captura). Se registran igual para la paleta y la hoja de atajos.
   */
  manejadorPropio?: boolean;
  /** El despachador no actúa si alguien ya consumió la tecla (`defaultPrevented`). */
  ignorarSiPrevenido?: boolean;
  /**
   * Su atajo se escucha en la fase de **captura** y no en burbuja, y nadie más
   * lo recibe (`stopPropagation`): F6 / Shift+F6 (`FUN-XL-04`, Parte 2), que
   * tienen que funcionar también con el foco en la consola —xterm cancela casi
   * todo— y en CodeMirror. Solo para teclas que no son de nadie más.
   */
  enCaptura?: boolean;
  /** `false`: no aparece en la paleta (los que hoy solo son un atajo). */
  enPaleta?: boolean;
  /**
   * Solo tiene sentido con datos (`args`): insertar un texto, abrir una nota
   * concreta (`FUN-XL-04`, Parte 6). Lo usan las macros; no aparece en la
   * paleta ni en los atajos, porque sin datos no haría nada.
   */
  requiereArgs?: boolean;
  /**
   * No se anota al grabar una macro: abre algo para elegir (la paleta, las
   * pistas, el menú «Nuevo…») y lo que importa es lo que se elige después.
   */
  noSeGraba?: boolean;
  /** Comando de desarrollador: solo existe con el modo dev (`FUN-S-36`). */
  soloDev?: boolean;
  /** Cuándo aparece y actúa. Sin esto, siempre (dentro del workspace). */
  disponible?: (ctx: ContextoComando) => boolean;
  ejecutar: (ctx: ContextoComando, args?: ArgsComando) => unknown;
};

export const resolverTexto = (t: Texto | undefined) => (typeof t === "function" ? t() : t);

// ── el registro vivo ───────────────────────────────────────────────────────

const registrados = new Map<string, Comando>();
const oyentes = new Set<() => void>();
let instantanea: readonly Comando[] = [];

function cambio() {
  instantanea = [...registrados.values()];
  for (const o of oyentes) o();
}

/**
 * Suma los comandos al registro y devuelve la baja. Un id que ya está no se
 * pisa: es un error de programación y se avisa en la consola.
 */
export function registrarComandos(lista: readonly Comando[]): () => void {
  const sumados: Comando[] = [];
  for (const c of lista) {
    if (registrados.has(c.id)) {
      console.error(`[comandos] el id «${c.id}» ya está registrado`);
      continue;
    }
    registrados.set(c.id, c);
    sumados.push(c);
  }
  if (sumados.length) cambio();
  return () => {
    let hubo = false;
    for (const c of sumados) {
      if (registrados.get(c.id) === c) {
        registrados.delete(c.id);
        hubo = true;
      }
    }
    if (hubo) cambio();
  };
}

/** Los comandos registrados, en orden de alta. El arreglo es estable entre cambios. */
export const listarComandos = (): readonly Comando[] => instantanea;

export const comandoPorId = (id: string) => registrados.get(id);

/** Avisa cuando cambian los comandos registrados o los atajos personalizados. */
export function suscribirComandos(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

// ── los atajos personalizados ──────────────────────────────────────────────

/**
 * Las sobreescrituras del usuario (`FUN-XL-04`, Parte 3), que carga y guarda
 * `preferenciasAtajos.ts`. Viven acá, junto al registro, porque el despachador,
 * la paleta, la hoja de atajos y la consola tienen que ver las mismas.
 */
let sobreescrituras: Sobreescrituras = {};
let version = 0;

/** Las sobreescrituras en uso. */
export const sobreescriturasActuales = (): Sobreescrituras => sobreescrituras;

/** Cambia las sobreescrituras en uso y avisa a quien muestre atajos. */
export function fijarSobreescrituras(s: Sobreescrituras) {
  if (s === sobreescrituras) return;
  sobreescrituras = s;
  version++;
  for (const o of oyentes) o();
}

/** Un número que cambia con cada cambio de las sobreescrituras (para memorizar). */
export const versionSobreescrituras = () => version;

/** Una sola entrada de memoria: los efectivos de la última lista y sobreescrituras pedidas. */
let memo: { comandos: readonly Comando[]; sobre: Sobreescrituras; efectivos: Efectivos } | null = null;

/**
 * Los atajos que valen hoy —los de fábrica con las sobreescrituras— para
 * `comandos`. Por defecto, los registrados con las sobreescrituras en uso.
 */
export function efectivosDe(
  comandos: readonly Comando[] = instantanea,
  sobre: Sobreescrituras = sobreescrituras,
): Efectivos {
  if (memo && memo.comandos === comandos && memo.sobre === sobre) return memo.efectivos;
  const efectivos = calcularEfectivos(comandos, sobre);
  memo = { comandos, sobre, efectivos };
  return efectivos;
}

/** Los atajos que tiene hoy un comando (con las personalizaciones). */
export function atajosDe(c: Comando, comandos: readonly Comando[] = instantanea): readonly Atajo[] {
  return efectivosDe(comandos).porId.get(c.id) ?? c.atajos ?? [];
}

// ── la paleta ──────────────────────────────────────────────────────────────

/** Los comandos que lista la paleta con el modo dev en el estado dado. */
export function comandosDePaleta(comandos: readonly Comando[], ctx: ContextoComando): Comando[] {
  return comandosDisponibles(
    comandos.filter((c) => c.enPaleta !== false && !c.requiereArgs),
    ctx.dev,
  ).filter((c) => c.disponible?.(ctx) ?? true);
}

/**
 * Título y detalle como los muestra la paleta: el atajo se deriva del comando
 * —con las personalizaciones del usuario— («Ctrl+Shift+Espacio · anotar en la
 * Bandeja del vault», «Abrir la configuración (Ctrl+,)»). `texto` escribe el
 * atajo (la paleta le pasa el que usa la distribución del teclado del usuario).
 */
export function textoEnPaleta(
  c: Comando,
  comandos: readonly Comando[],
  texto: (a: Atajo) => string = (a) => textoAtajo(a),
): { titulo: string; detalle?: string } {
  const titulo = resolverTexto(c.titulo) ?? "";
  const detalle = resolverTexto(c.detalle);
  const fuente = c.muestraAtajoDe ? comandos.find((o) => o.id === c.muestraAtajoDe) : c;
  const atajo = fuente ? atajosDe(fuente, comandos)[0] : undefined;
  if (!atajo) return { titulo, detalle };
  const tecla = texto(atajo);
  if (c.atajoEnTitulo) return { titulo: `${titulo} (${tecla})`, detalle };
  return { titulo, detalle: detalle ? `${tecla} · ${detalle}` : tecla };
}

// ── el despachador ─────────────────────────────────────────────────────────

/** La fase del evento en la que escucha el despachador. */
export type Fase = "captura" | "burbuja";

/**
 * El comando que el despachador del workspace dispara con esta tecla en esta
 * fase, o `null`. Con los atajos que valen hoy (las personalizaciones del
 * usuario incluidas). No cuenta los de manejador propio ni los de
 * desarrollador sin el modo. En captura, solo los `enCaptura`; en burbuja, el
 * resto.
 */
export function comandoParaTecla(
  e: EventoTecla,
  comandos: readonly Comando[],
  dev: boolean,
  fase: Fase = "burbuja",
  sobre: Sobreescrituras = sobreescrituras,
): Comando | null {
  const { porId } = efectivosDe(comandos, sobre);
  for (const c of comandosDisponibles(comandos, dev)) {
    if (c.manejadorPropio) continue;
    if (!!c.enCaptura !== (fase === "captura")) continue;
    if ((porId.get(c.id) ?? []).some((a) => coincide(a, e))) return c;
  }
  return null;
}

// ── la hoja de atajos ──────────────────────────────────────────────────────

export type GrupoDeAtajos = {
  categoria: CategoriaComando;
  nombre: string;
  comandos: { comando: Comando; titulo: string; atajos: readonly Atajo[] }[];
};

/**
 * Los comandos agrupados por categoría (en el orden de `NOMBRE_CATEGORIA`),
 * con sus atajos de hoy. Sin los de desarrollador si el modo está apagado: ni
 * la hoja ni Configuración los nombran. Con `soloConAtajo`, los que tienen
 * alguno (la hoja); sin él, todos (Configuración).
 */
export function gruposDeAtajos(
  comandos: readonly Comando[],
  dev: boolean,
  { soloConAtajo = false, sobre = sobreescrituras }: { soloConAtajo?: boolean; sobre?: Sobreescrituras } = {},
): GrupoDeAtajos[] {
  const { porId } = efectivosDe(comandos, sobre);
  const grupos: GrupoDeAtajos[] = [];
  for (const categoria of Object.keys(NOMBRE_CATEGORIA) as CategoriaComando[]) {
    const lista = comandosDisponibles(comandos, dev)
      .filter((c) => c.categoria === categoria && !c.muestraAtajoDe && !c.requiereArgs)
      .map((c) => ({ comando: c, titulo: resolverTexto(c.titulo) ?? c.id, atajos: porId.get(c.id) ?? [] }))
      .filter((x) => !soloConAtajo || x.atajos.length > 0);
    if (lista.length) grupos.push({ categoria, nombre: NOMBRE_CATEGORIA[categoria], comandos: lista });
  }
  return grupos;
}

// ── la validación ──────────────────────────────────────────────────────────

/**
 * Los problemas de una lista de comandos: ids repetidos o vacíos, títulos
 * vacíos, teclas que no existen, dos comandos con el mismo atajo y teclas
 * reservadas. Lista vacía = está bien.
 */
export function validarComandos(comandos: readonly Comando[]): string[] {
  const problemas: string[] = [];
  const ids = new Set<string>();
  const vistos: { atajo: Atajo; id: string }[] = [];
  for (const c of comandos) {
    if (!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(c.id)) problemas.push(`id con mal formato: «${c.id}»`);
    if (ids.has(c.id)) problemas.push(`id repetido: «${c.id}»`);
    ids.add(c.id);
    if (!resolverTexto(c.titulo)?.trim()) problemas.push(`«${c.id}» no tiene título`);
    if (c.muestraAtajoDe && !comandos.some((o) => o.id === c.muestraAtajoDe)) {
      problemas.push(`«${c.id}» muestra el atajo de «${c.muestraAtajoDe}», que no existe`);
    }
    for (const a of c.atajos ?? []) {
      if (!CODES_VALIDOS.has(a.code)) problemas.push(`«${c.id}» usa una tecla que no existe: «${a.code}»`);
      const reserva = reservaQueChoca(a, c.id);
      if (reserva) problemas.push(`«${c.id}» usa ${textoAtajo(a)}, reservada: ${reserva.motivo}`);
      const otro = vistos.find((v) => mismoAtajo(v.atajo, a));
      if (otro) problemas.push(`${textoAtajo(a)} lo tienen «${otro.id}» y «${c.id}»`);
      vistos.push({ atajo: a, id: c.id });
    }
  }
  return problemas;
}
