"use client";

/**
 * La distribución del teclado del usuario (`FUN-XL-04`, Parte 3): qué carácter
 * tiene impreso cada tecla de posición, para mostrar los atajos como los ve
 * quien los pulsa. Los atajos se guardan por `code` (la posición física), y en
 * un teclado español `Semicolon` es la `ñ` y `Backslash` es la `ç`: sin esto,
 * la hoja de atajos diría «Ctrl+\» para una tecla que no tiene esa barra.
 *
 * Dos fuentes, en este orden:
 * 1. `navigator.keyboard.getLayoutMap()` (Chromium, y por lo tanto WebView2):
 *    la distribución entera, sin que el usuario pulse nada.
 * 2. Lo aprendido al grabar un atajo en Configuración (el `key` de esa tecla),
 *    guardado en `localStorage` por si la API no está.
 *
 * Sin ninguna de las dos se muestran los nombres de un teclado de EE. UU.
 */
import { useSyncExternalStore } from "react";
import { CODES_DE_POSICION, textoAtajo, type Atajo, type Distribucion } from "./atajos";

const CLAVE_APRENDIDAS = "mic-teclas-vistas";

let mapa: Map<string, string> = new Map();
const oyentes = new Set<() => void>();
let cargando: Promise<void> | null = null;

function avisar() {
  for (const o of oyentes) o();
}

function leerAprendidas(): Map<string, string> {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_APRENDIDAS) ?? "{}") as Record<string, unknown>;
    const m = new Map<string, string>();
    for (const [code, key] of Object.entries(crudo)) {
      if (CODES_DE_POSICION.has(code) && typeof key === "string" && [...key].length === 1) m.set(code, key);
    }
    return m;
  } catch {
    return new Map();
  }
}

type ConTeclado = Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } };

/**
 * Lee la distribución (idempotente: una carga a la vez). Se vuelve a leer al
 * recuperar el foco la ventana, por si el usuario cambió de teclado.
 */
export function cargarDistribucion(forzar = false): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (cargando && !forzar) return cargando;
  cargando = (async () => {
    const nuevo = leerAprendidas();
    try {
      const api = (navigator as ConTeclado).keyboard?.getLayoutMap;
      if (api) {
        const deApi = await api.call((navigator as ConTeclado).keyboard);
        for (const [code, key] of deApi) if (CODES_DE_POSICION.has(code) && key) nuevo.set(code, key);
      }
    } catch {
      // Sin la API (o sin permiso), queda lo aprendido.
    }
    const igual = nuevo.size === mapa.size && [...nuevo].every(([c, k]) => mapa.get(c) === k);
    if (!igual) {
      mapa = nuevo;
      avisar();
    }
  })();
  return cargando;
}

/**
 * Anota el carácter de una tecla, visto al grabar un atajo (fuente 2). Solo si
 * es un carácter imprimible y la tecla es de posición; con Shift o AltGr el
 * `key` es otro carácter, así que solo se aprende sin ellos.
 */
export function aprenderTecla(e: Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "altKey">) {
  if (e.shiftKey || e.altKey || !CODES_DE_POSICION.has(e.code) || [...e.key].length !== 1) return;
  if (mapa.get(e.code) === e.key) return;
  mapa = new Map(mapa).set(e.code, e.key);
  try {
    const guardadas = leerAprendidas();
    guardadas.set(e.code, e.key);
    localStorage.setItem(CLAVE_APRENDIDAS, JSON.stringify(Object.fromEntries(guardadas)));
  } catch {
    // Sin almacén, vale para esta corrida.
  }
  avisar();
}

/** La distribución conocida (puede estar vacía). */
export const distribucionActual = (): Distribucion => mapa;

/** El atajo como lo ve el usuario en su teclado. */
export const textoAtajoVisible = (a: Atajo) => textoAtajo(a, mapa);

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  if (oyentes.size === 1) window.addEventListener("focus", alEnfocar);
  void cargarDistribucion();
  return () => {
    oyentes.delete(oyente);
    if (oyentes.size === 0) window.removeEventListener("focus", alEnfocar);
  };
}

const alEnfocar = () => void cargarDistribucion(true);

/** La distribución, y se vuelve a pintar cuando cambia. */
export function useDistribucion(): Distribucion {
  return useSyncExternalStore(suscribir, distribucionActual, distribucionActual);
}
