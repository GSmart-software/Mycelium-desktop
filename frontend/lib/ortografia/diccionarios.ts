/**
 * Dónde viven los diccionarios del corrector y el diccionario del vault
 * (`FUN-L-12`).
 *
 * **Diverge de web**: en desktop todo pasa por Rust (`src-tauri/src/diccionarios.rs`
 * y `prefs_vault.rs`): la descarga con verificación, los archivos en
 * `%LOCALAPPDATA%`, la configuración de la instalación y
 * `.mycelium/diccionario.txt`. En web la descarga es un `fetch` a R2 guardado en
 * la Cache API y el diccionario del vault va al backend. La API de este módulo
 * es lo que las dos ramas comparten; lo demás del corrector no sabe de dónde
 * salen los bytes.
 */
import { getVaultActual } from "@/lib/db/vaultContext";
import { parsearManifiesto, type Descargado, type Manifiesto, type Variante } from "./manifiesto";
import { escribirDiccionarioVault, leerDiccionarioVault } from "./palabras";

async function invocar<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** El mensaje con el que Rust termina una descarga cancelada (no es un error que mostrar). */
export const DESCARGA_CANCELADA = "Descarga cancelada.";

// ── Manifiesto y descargas ──────────────────────────────────────────────────

/** Trae y valida el manifiesto. Lanza sin conexión o si está mal formado. */
export async function consultarManifiesto(): Promise<Manifiesto> {
  const { url, contenido } = await invocar<{ url: string; contenido: string }>("diccionarios_manifiesto");
  return parsearManifiesto(contenido, url);
}

export function listarDescargados(): Promise<Descargado[]> {
  return invocar<Descargado[]>("diccionarios_listar");
}

/** Descarga una variante. Resuelve al terminar (ya verificada y en uso), o lanza. */
export function descargar(v: Variante): Promise<void> {
  return invocar<void>("diccionarios_descargar", {
    pedido: {
      id: v.id,
      version: v.version,
      aff: v.aff,
      dic: v.dic,
      sha256Aff: v.sha256Aff,
      sha256Dic: v.sha256Dic,
      licencia: v.licencia,
      bytes: v.bytes,
    },
  });
}

export function cancelarDescarga(id: string): Promise<void> {
  return invocar<void>("diccionarios_cancelar", { id });
}

export function borrarDescargado(id: string): Promise<void> {
  return invocar<void>("diccionarios_borrar", { id });
}

/** Los bytes del `.aff` y el `.dic` de un diccionario descargado. */
export async function leerDescargado(d: Descargado): Promise<{ aff: ArrayBuffer; dic: ArrayBuffer }> {
  const [aff, dic] = await Promise.all([
    invocar<ArrayBuffer>("diccionarios_leer", { id: d.id, version: d.version, archivo: "aff" }),
    invocar<ArrayBuffer>("diccionarios_leer", { id: d.id, version: d.version, archivo: "dic" }),
  ]);
  return { aff, dic };
}

/** El texto de la licencia que se bajó junto al diccionario. */
export async function leerLicencia(d: Descargado): Promise<string> {
  const bytes = await invocar<ArrayBuffer>("diccionarios_leer", { id: d.id, version: d.version, archivo: "licencia" });
  return new TextDecoder().decode(bytes);
}

export type ProgresoDescarga = { id: string; descargado: number; total: number };

/** Avance de las descargas. Devuelve con qué dejar de escuchar. */
export async function escucharProgreso(fn: (p: ProgresoDescarga) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ProgresoDescarga>("diccionarios-progreso", (e) => fn(e.payload));
}

/**
 * Cambió lo descargado o la configuración, en esta ventana o en otra: el
 * corrector de cada ventana se recarga.
 */
export async function escucharCambios(fn: () => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen("diccionarios-cambiados", () => fn());
}

// ── Configuración de la instalación ─────────────────────────────────────────

/**
 * Qué está activo, en esta instalación (no en el vault: los diccionarios son de
 * la máquina). En `config.json`, junto a los diccionarios.
 */
export type ConfigCorrector = {
  /** Lenguas activas (`es`, `en`, `it`): una palabra está bien si lo está en alguna. */
  activas: string[];
  /** Ya se propuso descargar el diccionario del idioma del sistema: no se insiste. */
  propuestaHecha: boolean;
  /**
   * Otro manifiesto, para desarrollo (una URL o una carpeta local). Lo lee Rust;
   * acá solo se conserva al reescribir. La variable `MYCELIUM_DICCIONARIOS` le
   * gana.
   */
  urlManifiesto?: string;
};

const CONFIG_DEFECTO: ConfigCorrector = { activas: [], propuestaHecha: false };

export async function leerConfig(): Promise<ConfigCorrector> {
  const texto = await invocar<string | null>("diccionarios_config_leer");
  if (!texto) return { ...CONFIG_DEFECTO };
  try {
    const o = JSON.parse(texto) as Partial<ConfigCorrector>;
    return {
      activas: Array.isArray(o.activas) ? o.activas.filter((a): a is string => typeof a === "string") : [],
      propuestaHecha: o.propuestaHecha === true,
      ...(typeof o.urlManifiesto === "string" ? { urlManifiesto: o.urlManifiesto } : {}),
    };
  } catch {
    // Ilegible: se sigue con los valores por defecto y el próximo cambio lo reescribe.
    return { ...CONFIG_DEFECTO };
  }
}

export async function escribirConfig(config: ConfigCorrector): Promise<void> {
  await invocar("diccionarios_config_escribir", { contenido: JSON.stringify(config, null, 2) });
}

// ── Diccionario del vault ───────────────────────────────────────────────────

const ARCHIVO_VAULT = "diccionario.txt";

/** El vault abierto, o `null` (el corrector también funciona sin uno). */
export function vaultActual(): string | null {
  try {
    return getVaultActual();
  } catch {
    return null;
  }
}

/** Las palabras del diccionario del vault. Sin vault o sin archivo, ninguna. */
export async function leerPalabrasDelVault(vault: string | null): Promise<string[]> {
  if (vault === null) return [];
  const texto = await invocar<string | null>("leer_estado_vault", { ruta: vault, nombre: ARCHIVO_VAULT });
  return leerDiccionarioVault(texto);
}

export async function guardarPalabrasDelVault(vault: string, palabras: string[]): Promise<void> {
  await invocar("escribir_estado_vault", {
    ruta: vault,
    nombre: ARCHIVO_VAULT,
    contenido: escribirDiccionarioVault(palabras),
  });
}
