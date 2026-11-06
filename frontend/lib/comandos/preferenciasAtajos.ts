"use client";

/**
 * Dónde se guardan los atajos del usuario (`FUN-XL-04`, Parte 3): las
 * sobreescrituras de los atajos y la lista de teclas que salen de la consola.
 *
 * Son **del usuario**, los mismos en todos los vaults (decisión del usuario,
 * 2026-11-06, la misma que las macros). En desktop casi todo es del vault
 * (`prefsVaultStore`, en `.mycelium/preferencias.json`, que viaja con la
 * carpeta), y lo que es de la máquina por vault va a `config-local.json`. Lo
 * que es de la persona y no del vault ya vive en `localStorage`, que en Tauri
 * es uno solo para la app —todas las ventanas y todos los vaults—: las
 * preferencias de la terminal (`mic-consolas-prefs`, `terminalStore`). Los
 * atajos van al lado, en `mic-atajos`. Además, el evento `storage` avisa a las
 * otras ventanas, así que un cambio en una vale al instante en todas.
 */
import { useSyncExternalStore } from "react";
import { fijarSobreescrituras, sobreescriturasActuales } from "./registro";
import { normalizarSobreescrituras, type Sobreescrituras } from "./personalizar";
import { fijarPrefsConsola, normalizarPrefsConsola, prefsConsolaActuales, type PrefsConsola } from "./teclasConsola";

const CLAVE = "mic-atajos";

type Guardado = { atajos: Sobreescrituras; consola: PrefsConsola };

const oyentes = new Set<() => void>();
let instantanea: Guardado = { atajos: {}, consola: {} };
let cargado = false;

function aplicar(g: Guardado) {
  instantanea = g;
  fijarSobreescrituras(g.atajos);
  fijarPrefsConsola(g.consola);
  for (const o of oyentes) o();
}

function leer(): Guardado {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE) ?? "{}") as Record<string, unknown>;
    return { atajos: normalizarSobreescrituras(crudo.atajos), consola: normalizarPrefsConsola(crudo.consola) };
  } catch {
    // Un almacén ilegible no puede dejar la app sin atajos: valen los de fábrica.
    return { atajos: {}, consola: {} };
  }
}

const alCambiarEnOtraVentana = (e: StorageEvent) => {
  if (e.key === CLAVE || e.key === null) aplicar(leer());
};

/** Carga los atajos del usuario (una vez) y escucha los cambios de otras ventanas. */
export function cargarPreferenciasAtajos() {
  if (cargado || typeof window === "undefined") return;
  cargado = true;
  aplicar(leer());
  window.addEventListener("storage", alCambiarEnOtraVentana);
}

function guardar(g: Guardado) {
  aplicar(g);
  try {
    localStorage.setItem(CLAVE, JSON.stringify(g));
  } catch {
    // Sin almacén, valen para esta corrida.
  }
}

/** Guarda unas sobreescrituras nuevas de los atajos. */
export function guardarSobreescrituras(atajos: Sobreescrituras) {
  cargarPreferenciasAtajos();
  guardar({ atajos, consola: prefsConsolaActuales() });
}

/** Guarda la lista de teclas que salen de la consola. */
export function guardarPrefsConsola(consola: PrefsConsola) {
  cargarPreferenciasAtajos();
  guardar({ atajos: sobreescriturasActuales(), consola });
}

function suscribir(oyente: () => void) {
  cargarPreferenciasAtajos();
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

const vacio: Guardado = { atajos: {}, consola: {} };

/** Los atajos del usuario; se vuelve a pintar cuando cambian (aquí o en otra ventana). */
export function usePreferenciasAtajos(): Guardado {
  return useSyncExternalStore(suscribir, () => instantanea, () => vacio);
}
