/**
 * Contexto del vault activo para los repos de la capa de datos (solo-desktop).
 *
 * Es un módulo mínimo SIN store (para evitar ciclos): guarda la carpeta del
 * vault abierto. Lo fija `vaultSessionStore` tras abrir el índice y lo limpia al
 * salir; los repos (`lib/db/*`) lo consultan para saber sobre qué carpeta operar,
 * porque los archivos son la fuente de verdad y el índice solo su caché.
 *
 * No hay vault → no hay capa de datos. El «modo SQLite clásico» (notas dentro de
 * una base propia de la app, sin carpeta) se retiró el 2026-09-26 (ver la
 * decisión «El modo SQLite clasico queda muerto»): pedir el vault sin uno
 * abierto es un error de programación —el workspace redirige a la selección
 * antes de llegar acá—, y por eso lanza en vez de devolver `null`.
 *
 * El módulo NO importa el store (es al revés): así se rompe el ciclo repos ↔ store.
 */
import { DbError } from "./errors";

/**
 * `vault_id` de todas las filas del índice. Cada vault tiene su propio índice
 * (`index-<hash>.db`), así que dentro de uno el id es siempre el mismo: es una
 * constante y no una fila de la tabla `vaults` (que ya no existe en el esquema).
 * `authStore` la expone como el único vault para los componentes compartidos con
 * web, que piden `vaults[0].id` y lo pasan en las rutas de `api()`.
 */
export const LOCAL_VAULT_ID = "local-vault";

let vaultActual: string | null = null;

/** Fija la carpeta del vault activo, o `null` al cerrarlo. */
export function setVaultActual(ruta: string | null): void {
  vaultActual = ruta;
}

/** Carpeta del vault activo. Lanza si no hay ninguno abierto. */
export function getVaultActual(): string {
  if (vaultActual === null) {
    throw new DbError(409, "No hay ningún vault abierto: elegí uno para continuar.");
  }
  return vaultActual;
}
