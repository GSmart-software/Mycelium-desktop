/**
 * Puente con el motor de actualización que vive en Rust (`FUN-L-14`,
 * `FUN-M-16`).
 *
 * Acá no hay lógica de red: todo pasa por los comandos `updater_*` de
 * `src-tauri/src/actualizador.rs`. Este módulo solo tipa esos comandos y aporta
 * las dos cuentas que necesitan el huso horario y el `APP_VERSION` del webview:
 * qué día es hoy y si una versión es anterior a otra.
 */
import { invoke } from "@tauri-apps/api/core";

/** Estado completo del updater, tal como lo reporta Rust. */
export type EstadoUpdater = {
  /** `false` si falta la clave de firma o el endpoint: no se consulta nada. */
  habilitado: boolean;
  /** Por qué no está habilitado (texto listo para mostrar). */
  motivo: string | null;
  versionActual: string;
  endpoint: string;
  endpointDefecto: string;
  endpointPersonalizado: boolean;
  auto: boolean;
  /** `AAAA-MM-DD` local de la última comprobación. */
  ultimaComprobacion: string | null;
  versionOmitida: string | null;
  versionFijada: string | null;
  avanzado: boolean;
};

/** Una actualización disponible según el manifiesto. */
export type InfoActualizacion = {
  version: string;
  versionActual: string;
  /** Markdown de las notas de la release. */
  notas: string | null;
  fecha: string | null;
};

/** Una versión publicada según `versions.json` (modo avanzado). */
export type VersionPublicada = {
  version: string;
  fecha: string | null;
  notas: string | null;
  /** URL absoluta del manifiesto de esa versión, ya resuelta por Rust. */
  manifiesto: string;
};

/** Progreso de descarga que emite Rust en el evento `updater-progreso`. */
export type ProgresoDescarga = {
  descargado: number;
  /** `null` si el servidor no manda `Content-Length`. */
  total: number | null;
};

export const EVENTO_PROGRESO = "updater-progreso";

// ── Comandos ────────────────────────────────────────────────────────────────

export const estadoUpdater = () => invoke<EstadoUpdater>("updater_estado");

export const setComprobacionAutomatica = (valor: boolean) =>
  invoke<void>("updater_set_auto", { valor });

export const setModoAvanzado = (valor: boolean) =>
  invoke<void>("updater_set_avanzado", { valor });

export const setEndpoint = (valor: string | null) =>
  invoke<void>("updater_set_endpoint", { valor });

export const omitirVersion = (version: string | null) =>
  invoke<void>("updater_omitir_version", { version });

export const fijarVersion = (version: string | null) =>
  invoke<void>("updater_fijar_version", { version });

export const marcarComprobacion = (fecha: string) =>
  invoke<void>("updater_marcar_comprobacion", { fecha });

export const buscarActualizacion = () =>
  invoke<InfoActualizacion | null>("updater_buscar");

export const listarVersiones = () => invoke<VersionPublicada[]>("updater_versiones");

/** Descarga y verifica la firma. Sin `version`, la última publicada. */
export const descargarActualizacion = (
  version?: string | null,
  manifiesto?: string | null,
) =>
  invoke<void>("updater_descargar", {
    version: version ?? null,
    manifiesto: manifiesto ?? null,
  });

/** Instala lo descargado. **No vuelve**: lanza el instalador y cierra la app. */
export const instalarActualizacion = () => invoke<void>("updater_instalar");

/** Tira lo descargado (el usuario cerró el diálogo sin instalar). */
export const descartarDescarga = () => invoke<void>("updater_descartar");

// ── Cuentas del lado del webview ────────────────────────────────────────────

/**
 * Hoy en `AAAA-MM-DD`, **en el huso del usuario**. Rust no tiene la zona
 * horaria local sin arrastrar un crate más, y para "una comprobación al día"
 * el día que importa es el que ve el usuario en su reloj, no el UTC.
 */
export function fechaLocalHoy(): string {
  const ahora = new Date();
  const mes = `${ahora.getMonth() + 1}`.padStart(2, "0");
  const dia = `${ahora.getDate()}`.padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

/**
 * Compara dos versiones semánticas: `-1` si `a` es anterior, `1` si posterior,
 * `0` si son la misma. Solo mira `major.minor.patch` — Mycelium no publica
 * pre-releases, y si algún día lo hiciera, tratarlas como iguales al release es
 * preferible a inventarse un orden acá.
 */
export function compararVersiones(a: string, b: string): -1 | 0 | 1 {
  const partes = (v: string) =>
    v
      .trim()
      .replace(/^v/, "")
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const [pa, pb] = [partes(a), partes(b)];
  for (let i = 0; i < 3; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** Fecha ISO del manifiesto en formato legible; el valor crudo si no parsea. */
export function fechaLegible(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
