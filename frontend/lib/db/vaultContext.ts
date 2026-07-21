/**
 * Contexto del vault activo para los repos de la capa de datos (fase 4 del
 * "vault en carpeta", solo-desktop).
 *
 * Es un módulo mínimo SIN store y SIN dependencias (para evitar ciclos): guarda
 * la carpeta del vault abierto. Lo settea `vaultSessionStore` tras abrir el
 * índice y lo limpia al salir; los repos (`lib/db/*`) lo consultan:
 *
 *   - `getVaultActual()` devuelve `null`  → modo SQLite clásico: los mutadores se
 *     comportan EXACTAMENTE como antes (solo tocan `mycelium.db`).
 *   - `getVaultActual()` devuelve la ruta → modo carpeta: además del índice, la
 *     operación se ejecuta en disco (los archivos son la fuente de verdad).
 *
 * El módulo NO importa el store (es al revés): así se rompe el ciclo repos ↔ store.
 */

let vaultActual: string | null = null;

/** Fija la carpeta del vault activo (o `null` para volver al modo SQLite clásico). */
export function setVaultActual(ruta: string | null): void {
  vaultActual = ruta;
}

/** Carpeta del vault activo, o `null` si se está en modo SQLite clásico. */
export function getVaultActual(): string | null {
  return vaultActual;
}
