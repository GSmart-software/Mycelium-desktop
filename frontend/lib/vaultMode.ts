/**
 * Modo de almacenamiento del desktop (fase 1 del "vault en carpeta").
 *
 * Envuelve los comandos Rust que persisten qué carpeta del SO es la fuente de
 * verdad del vault. Si hay carpeta seleccionada, el modo es `"carpeta"`; si no,
 * `"sqlite"` (base local clásica). Por ahora solo se lee/escribe la elección;
 * la conmutación real de la capa de datos llega en fases posteriores
 * (ver docs/features/vault-en-carpeta.md).
 */
import { invoke } from "@tauri-apps/api/core";

export type VaultModo = "sqlite" | "carpeta";

/** Carpeta del vault seleccionada, o `null` si se usa el SQLite clásico. */
export async function getVaultRuta(): Promise<string | null> {
  return (await invoke<string | null>("get_vault_ruta")) ?? null;
}

/** Fija la carpeta del vault (debe existir y ser un directorio). */
export async function setVaultRuta(ruta: string): Promise<void> {
  await invoke("set_vault_ruta", { ruta });
}

/** Vuelve al SQLite clásico (olvida la carpeta). */
export async function limpiarVaultRuta(): Promise<void> {
  await invoke("limpiar_vault_ruta");
}

/** Modo activo, derivado de si hay carpeta seleccionada. */
export async function getVaultModo(): Promise<VaultModo> {
  return (await getVaultRuta()) ? "carpeta" : "sqlite";
}
