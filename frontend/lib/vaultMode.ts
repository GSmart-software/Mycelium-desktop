/**
 * Registro de vaults del desktop (nació en la fase 1 del "vault en carpeta").
 *
 * Envuelve los comandos Rust que recuerdan qué carpetas del SO se han vinculado
 * como vaults (modelo Obsidian). El registro vive en el config-dir de la app.
 * Vincular solo registra la carpeta; desvincular la olvida (no toca archivos).
 * `autoAbrir` es la ruta que se abre sola al arrancar (o `null` → selector).
 *
 * Solo gestiona el registro. Abrir un vault (indexar la carpeta y conmutar la
 * capa de datos a ella) lo hace `vaultSessionStore.abrir` (ver
 * docs/features/vault-en-carpeta.md).
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

/**
 * Abre el selector de carpetas del sistema y vincula la elegida; `null` si el
 * usuario cancela.
 *
 * El selector lo abre **Rust** (`DEF-161`), no el plugin `dialog` desde acá: un
 * vault vinculado es una carpeta que todos los comandos del vault pueden leer y
 * escribir, así que la ruta no puede salir de la webview.
 */
export async function elegirVault(): Promise<VaultElegido | null> {
  const elegido = (await invoke<VaultElegido | null>("elegir_vault")) ?? null;
  if (elegido?.notaBienvenida) anotarBienvenida(elegido.ruta, elegido.notaBienvenida);
  return elegido;
}

/**
 * Lo que devuelve `elegirVault`: el vault y, si era nuevo, el id de la nota de
 * bienvenida que Rust le sembró (`FUN-S-05`), o `null`.
 */
export type VaultElegido = VaultRef & { notaBienvenida: string | null };

// ── Nota de bienvenida de un vault nuevo (`FUN-S-05`) ────────────────────────

/**
 * Clave de `localStorage` con las notas de bienvenida por abrir, por ruta de
 * vault. En `localStorage` y no en memoria porque el vault puede abrirse en
 * OTRA ventana (el menú de vaults de la barra superior abre ahí lo que vincula)
 * o más tarde, desde el selector: la nota se abre la primera vez que se entra,
 * venga de donde venga.
 */
const CLAVE_BIENVENIDA = "mycelium:bienvenida-pendiente";

function leerBienvenidas(): Record<string, string> {
  try {
    const crudo = localStorage.getItem(CLAVE_BIENVENIDA);
    const datos: unknown = crudo ? JSON.parse(crudo) : {};
    return datos && typeof datos === "object" ? (datos as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function anotarBienvenida(ruta: string, notaId: string): void {
  try {
    localStorage.setItem(CLAVE_BIENVENIDA, JSON.stringify({ ...leerBienvenidas(), [ruta]: notaId }));
  } catch {
    // Sin `localStorage` la nota igual está en el vault; solo no se abre sola.
  }
}

/**
 * La nota de bienvenida pendiente de ese vault, o `null`, y la olvida: se abre
 * una sola vez. La llama `vaultSessionStore.abrir` al entrar.
 */
export function tomarBienvenidaPendiente(ruta: string): string | null {
  const pendientes = leerBienvenidas();
  const notaId = pendientes[ruta];
  if (typeof notaId !== "string") return null;
  delete pendientes[ruta];
  try {
    localStorage.setItem(CLAVE_BIENVENIDA, JSON.stringify(pendientes));
  } catch {
    // Si no se puede olvidar, a lo sumo se abre de nuevo la próxima vez.
  }
  return notaId;
}

/**
 * Abre el selector de carpetas del sistema para trabajar FUERA del vault
 * (exportar, importar una carpeta); `null` si se cancela. Rust anota la carpeta
 * para esta ventana, y es la única que esos comandos aceptan (`DEF-161`).
 */
export async function elegirCarpetaExterna(titulo: string): Promise<string | null> {
  return (await invoke<string | null>("elegir_carpeta", { titulo })) ?? null;
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
  // `DEF-094`: la clase decía `[\/]`, que es solo la barra común —la
  // contrabarra hay que escaparla—, así que con una ruta de Windows no partía
  // nada y devolvía la ruta entera.
  const tramos = ruta.replace(/[\\/]+$/, "").split(/[\\/]/);
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
  } catch (error) {
    // El título es cosmético: si falla, no se arrastra el fallo al arranque.
    // Pero se avisa, porque el modo de fallo real fue silencioso: faltaba
    // `core:window:allow-set-title` en la capability y no pasaba nada, sin
    // ninguna pista de por qué.
    console.warn("[ventana] no se pudo poner el título:", error);
  }
}
