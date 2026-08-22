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

/** `true` si al arrancar se reabre automáticamente el último vault usado. */
export async function getAbrirUltimo(): Promise<boolean> {
  return (await invoke<boolean>("get_abrir_ultimo")) ?? false;
}

/** Activa/desactiva la reapertura automática del último vault al arrancar. */
export async function setAbrirUltimo(valor: boolean): Promise<void> {
  await invoke("set_abrir_ultimo", { valor });
}

/** Marca un vault como accedido ahora (para ordenar por reciente). */
export async function marcarAcceso(ruta: string): Promise<void> {
  await invoke("marcar_acceso", { ruta });
}

// ── Varias ventanas, un vault en cada una (`FUN-L-16`) ───────────────────────

/**
 * Anota que ESTA ventana abrió ese vault. Lanza si lo tiene otra: cada vault
 * abre su índice SQLite y lanza su watcher, así que dos ventanas sobre la misma
 * carpeta serían dos indexadores escribiendo el mismo índice.
 */
export async function registrarVaultDeVentana(ruta: string): Promise<void> {
  await invoke("registrar_vault", { ruta });
}

/** Suelta el vault de esta ventana (al salir). */
export async function soltarVaultDeVentana(): Promise<void> {
  await invoke("soltar_vault");
}

/**
 * Abre un vault en una ventana nueva. Si ya está abierto en otra, la levanta en
 * vez de duplicarlo; devuelve `true` solo cuando creó una ventana.
 */
export async function abrirVaultEnVentana(ruta: string): Promise<boolean> {
  return (await invoke<boolean>("abrir_vault_en_ventana", { ruta })) ?? false;
}

/**
 * Nombre legible de un vault: el último tramo de su ruta.
 *
 * Tolera las dos barras porque la ruta puede venir del diálogo del sistema
 * (`C:\Notas\Trabajo`) o de la URL de una ventana nueva (`C:/Notas/Trabajo`).
 */
export function nombreDeVault(ruta: string): string {
  const tramos = ruta.replace(/[\/]+$/, "").split(/[\/]/);
  return tramos[tramos.length - 1] || ruta;
}

/**
 * Pone el título de ESTA ventana como «Mycelium - <vault>», o solo «Mycelium»
 * si no hay ninguno abierto.
 *
 * Con varias ventanas a la vez (`FUN-L-16`) todas se llamaban igual, así que en
 * la barra de tareas y al alternar con Alt+Tab no había forma de saber cuál era
 * cuál. El nombre del vault es lo único que las distingue.
 */
export async function ponerTituloDeVentana(ruta: string | null): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const titulo = ruta === null ? "Mycelium" : `Mycelium - ${nombreDeVault(ruta)}`;
    await getCurrentWindow().setTitle(titulo);
  } catch {
    // El título es cosmético: si falla, no se arrastra el fallo al arranque.
  }
}
