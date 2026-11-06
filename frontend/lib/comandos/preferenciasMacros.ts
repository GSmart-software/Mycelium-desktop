"use client";

/**
 * Dónde se guardan las macros (`FUN-XL-04`, Parte 6) y el estado de la
 * grabación.
 *
 * Son **del usuario**, las mismas en todos los vaults (decisión del usuario,
 * 2026-11-06), como los atajos (`preferenciasAtajos.ts`): van en
 * `localStorage`, que en Tauri es uno solo para la app, con la clave
 * `mic-macros`, y el evento `storage` avisa a las otras ventanas. Los atajos de
 * las macros **no** van acá: son atajos de los comandos `macro.<id>` y se
 * guardan con los demás, en `mic-atajos`.
 *
 * Quien nunca guardó nada tiene las macros de fábrica. Lo que se lee se valida
 * (`normalizarMacros`): lo inválido se descarta y la sección lo avisa.
 */
import { useSyncExternalStore } from "react";
import {
  MACROS_DE_FABRICA,
  copiarMacro,
  normalizarMacros,
  pasoDeInvocacion,
  type Macro,
  type Paso,
} from "./macros";
import type { ArgsComando } from "./registro";

const CLAVE = "mic-macros";
const VERSION = 1;

type Estado = {
  macros: readonly Macro[];
  /** Lo que se descartó al leer, en palabras (para la sección). */
  descartes: readonly string[];
  /** Los pasos anotados mientras se graba, o `null` si no se graba. */
  grabacion: readonly Paso[] | null;
  /** La última grabación detenida, esperando que se guarde o se descarte. */
  grabada: readonly Paso[] | null;
  /** El id de la macro que se está ejecutando, o `null`. */
  enCurso: string | null;
};

const oyentes = new Set<() => void>();
let estado: Estado = {
  macros: MACROS_DE_FABRICA.map(copiarMacro),
  descartes: [],
  grabacion: null,
  grabada: null,
  enCurso: null,
};
let cargado = false;

function cambiar(parcial: Partial<Estado>) {
  estado = { ...estado, ...parcial };
  for (const o of oyentes) o();
}

function leer(): Pick<Estado, "macros" | "descartes"> {
  let texto: string | null = null;
  try {
    texto = localStorage.getItem(CLAVE);
  } catch {
    // Sin almacén: las de fábrica.
  }
  if (texto === null) return { macros: MACROS_DE_FABRICA.map(copiarMacro), descartes: [] };
  try {
    return normalizarMacros(JSON.parse(texto));
  } catch {
    // Un almacén ilegible no puede dejar la app colgada: sin macros, con aviso.
    return { macros: [], descartes: ["Las macros guardadas no se pudieron leer."] };
  }
}

const alCambiarEnOtraVentana = (e: StorageEvent) => {
  if (e.key === CLAVE || e.key === null) cambiar(leer());
};

/** Carga las macros (una vez) y escucha los cambios de otras ventanas. */
export function cargarMacros() {
  if (cargado || typeof window === "undefined") return;
  cargado = true;
  cambiar(leer());
  window.addEventListener("storage", alCambiarEnOtraVentana);
}

/** Las macros en uso. */
export const macrosActuales = (): readonly Macro[] => {
  cargarMacros();
  return estado.macros;
};

/** Guarda la lista entera de macros. */
export function guardarMacros(macros: readonly Macro[]) {
  cargarMacros();
  cambiar({ macros, descartes: [] });
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ version: VERSION, macros }));
  } catch {
    // Sin almacén, valen para esta corrida.
  }
}

// ── en curso ───────────────────────────────────────────────────────────────

export const macroEnCurso = () => estado.enCurso;
export const fijarMacroEnCurso = (id: string | null) => cambiar({ enCurso: id });

// ── la grabación ───────────────────────────────────────────────────────────

/** ¿Se está grabando una macro? */
export const grabandoMacro = () => estado.grabacion !== null;

/** Empieza a grabar (descarta una grabación anterior sin guardar). */
export function empezarGrabacion() {
  cambiar({ grabacion: [], grabada: null });
}

/** Deja de grabar; los pasos quedan en `grabada` para guardarlos o descartarlos. */
export function detenerGrabacion(): readonly Paso[] {
  const pasos = estado.grabacion ?? [];
  cambiar({ grabacion: null, grabada: pasos.length ? pasos : null });
  return pasos;
}

/** Olvida la grabación detenida (ya se guardó o se descartó). */
export const olvidarGrabada = () => cambiar({ grabada: null });

/**
 * Anota un paso si se está grabando y no hay una macro en curso (lo que hace
 * una macro no se graba: se graba la macro).
 */
export function anotarPaso(paso: Paso) {
  if (estado.grabacion === null || estado.enCurso !== null) return;
  cambiar({ grabacion: [...estado.grabacion, paso] });
}

/** Anota la ejecución de un comando, como el paso que se lee mejor. */
export const anotarComando = (id: string, args?: ArgsComando) => anotarPaso(pasoDeInvocacion(id, args));

// ── React ──────────────────────────────────────────────────────────────────

function suscribir(oyente: () => void) {
  cargarMacros();
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

const inicial: Estado = { macros: [], descartes: [], grabacion: null, grabada: null, enCurso: null };

/** Las macros, la grabación y la que está en curso; se vuelve a pintar cuando cambian. */
export function useMacros(): Estado {
  return useSyncExternalStore(suscribir, () => estado, () => inicial);
}
