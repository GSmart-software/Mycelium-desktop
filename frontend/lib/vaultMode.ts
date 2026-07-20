/**
 * Registro de vaults del desktop (fase 1 del "vault en carpeta").
 *
 * Envuelve los comandos Rust que recuerdan qué carpetas del SO se han vinculado
 * como vaults (modelo Obsidian). El registro vive en el config-dir de la app.
 * Vincular solo registra la carpeta; desvincular la olvida (no toca archivos).
 * `autoAbrir` es la ruta que se abre sola al arrancar (o `null` → selector).
 *
 * Por ahora solo gestiona el registro; la conmutación real de la capa de datos
 * a la carpeta llega en fases posteriores (ver docs/features/vault-en-carpeta.md).
 */
import { invoke } from "@tauri-apps/api/core";

/** Un vault vinculado. `ultimoAcceso` en milisegundos epoch (o `null`). */
export type VaultRef = {
  ruta: string;
  nombre: string;
  ultimoAcceso: number | null;
};

/** Vaults vinculados, más recientes primero. */
export async function listarVaults(): Promise<VaultRef[]> {
  return invoke<VaultRef[]>("listar_vaults");
}

/** Vincula una carpeta (debe existir). La añade al registro y la devuelve. */
export async function vincularVault(ruta: string): Promise<VaultRef> {
  return invoke<VaultRef>("vincular_vault", { ruta });
}

/** Olvida un vault del registro (no toca los archivos en disco). */
export async function desvincularVault(ruta: string): Promise<void> {
  await invoke("desvincular_vault", { ruta });
}

/** Ruta del vault de apertura automática, o `null` si hay que mostrar el selector. */
export async function getAutoAbrir(): Promise<string | null> {
  return (await invoke<string | null>("get_auto_abrir")) ?? null;
}

/** Fija (o limpia con `null`) el vault que se abre solo al arrancar. */
export async function setAutoAbrir(ruta: string | null): Promise<void> {
  await invoke("set_auto_abrir", { ruta });
}

/** Marca un vault como accedido ahora (para ordenar por reciente). */
export async function marcarAcceso(ruta: string): Promise<void> {
  await invoke("marcar_acceso", { ruta });
}
