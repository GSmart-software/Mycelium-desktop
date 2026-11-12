/**
 * Exportar con aviso (`FUN-M-22`): **un** camino para todo lo que sale de
 * Mycelium —una nota como `.md`, el vault como ZIP o a una carpeta, un dibujo
 * como PNG o SVG, una copia de un archivo, un snippet— que muestra la tarjeta
 * de abajo a la derecha mientras trabaja y al terminar, con «Abrir la carpeta».
 *
 * Antes cada uno era una descarga del webview (`<a download>`): el archivo iba
 * a Descargas sin ninguna señal y la app no sabía dónde había quedado. Ahora el
 * destino lo elige el usuario en el diálogo **Guardar como** nativo, que abre
 * Rust (`exportaciones.rs`); solo esa ruta se puede escribir y revelar.
 *
 * Si el usuario cancela el diálogo, no pasa nada: ni tarjeta ni archivo.
 *
 * El PDF va aparte (`avisarImpresion`): lo guarda el diálogo de impresión del
 * sistema, que no le dice a la app si se guardó ni dónde.
 */
import { invoke } from "@tauri-apps/api/core";
import { mensajeDeError } from "@/lib/mensajeError";
import { useExportacionesStore } from "@/stores/exportacionesStore";

/** Lo que se escribe: texto (UTF-8), bytes o un Blob. */
export type ContenidoExportado = string | Blob | Uint8Array | ArrayBuffer;

/** Avance que puede informar un trabajo largo (el vault entero). */
export type AlAvanzar = (hechos: number, total: number) => void;

export type PedidoExportacion = {
  /** El nombre sugerido en el diálogo, con extensión: `Plan.md`. */
  nombre: string;
  /** La extensión del filtro del diálogo, sin punto (`md`, `zip`, `png`). */
  extension: string;
  /** Cómo se llama ese tipo en el filtro del diálogo: «Markdown». */
  descripcion: string;
  /** Lo que arma el contenido. Corre DESPUÉS de elegir el destino. */
  generar: (alAvanzar: AlAvanzar) => Promise<ContenidoExportado> | ContenidoExportado;
};

async function aBytes(contenido: ContenidoExportado): Promise<Uint8Array> {
  if (typeof contenido === "string") return new TextEncoder().encode(contenido);
  if (contenido instanceof Uint8Array) return contenido;
  if (contenido instanceof ArrayBuffer) return new Uint8Array(contenido);
  return new Uint8Array(await contenido.arrayBuffer());
}

/** El nombre del archivo o carpeta final de una ruta del sistema. */
export function nombreDeRuta(ruta: string): string {
  const limpia = ruta.replace(/[\\/]+$/, "");
  return limpia.slice(Math.max(limpia.lastIndexOf("/"), limpia.lastIndexOf("\\")) + 1) || limpia;
}

/**
 * Corre `trabajo` con la tarjeta a la vista: «exportando» mientras dura, y
 * después «listo» (con la ruta) o «no se pudo» (con el motivo). Devuelve lo que
 * devuelve el trabajo, o `undefined` si falló —el fallo ya lo dice la tarjeta—.
 */
export async function conTarjeta<T>(
  que: string,
  ruta: string | null,
  trabajo: (alAvanzar: AlAvanzar) => Promise<T>,
  esCarpeta = false,
): Promise<T | undefined> {
  const tienda = useExportacionesStore.getState();
  const id = tienda.iniciar(que, ruta, esCarpeta);
  try {
    const r = await trabajo((hechos, total) => tienda.actualizar(id, { progreso: { hechos, total } }));
    tienda.actualizar(id, { estado: "lista", progreso: undefined });
    return r;
  } catch (e) {
    console.error(`[Mycelium] no se pudo exportar ${que}:`, e);
    tienda.actualizar(id, { estado: "fallo", detalle: mensajeDeError(e), progreso: undefined });
    return undefined;
  }
}

/**
 * Exporta a un archivo que el usuario elige en «Guardar como». `false` si
 * canceló el diálogo (no aparece nada); `true` si se intentó —el resultado lo
 * cuenta la tarjeta—.
 *
 * Un fallo al abrir el diálogo también va a la tarjeta: el usuario pidió
 * exportar y tiene que enterarse de que no se pudo.
 */
export async function exportarArchivo(pedido: PedidoExportacion): Promise<boolean> {
  let ruta: string | null;
  try {
    ruta = await invoke<string | null>("elegir_destino_exportacion", {
      nombre: pedido.nombre,
      extension: pedido.extension,
      descripcion: pedido.descripcion,
    });
  } catch (e) {
    await conTarjeta(pedido.nombre, null, () => Promise.reject(e));
    return true;
  }
  if (ruta === null) return false;
  const destino = ruta;
  await conTarjeta(nombreDeRuta(destino), destino, async (alAvanzar) => {
    const bytes = await aBytes(await pedido.generar(alAvanzar));
    await invoke("escribir_exportacion", bytes, { headers: { "x-ruta": encodeURIComponent(destino) } });
  });
  return true;
}

/** Abre la carpeta donde quedó lo exportado (el archivo, seleccionado). */
export async function abrirCarpetaDeExportacion(ruta: string): Promise<void> {
  await invoke("revelar_exportacion", { ruta });
}

/**
 * El PDF (`exportNotePdf`): mientras se arma, «exportando»; cuando se abre el
 * diálogo de impresión, la tarjeta dice qué elegir ahí. Sin «Abrir la
 * carpeta»: el diálogo del sistema no le dice a la app dónde se guardó, ni si
 * se guardó.
 */
export async function avisarImpresion(
  que: string,
  preparar: (alAbrirImpresion: () => void) => Promise<void>,
): Promise<void> {
  const tienda = useExportacionesStore.getState();
  const id = tienda.iniciar(que, null);
  // Se avisa JUSTO antes de abrir el diálogo: `print()` puede no volver hasta
  // que el usuario lo cierra, y para entonces la indicación ya no sirve.
  let avisado = false;
  const alAbrirImpresion = () => {
    if (avisado) return;
    avisado = true;
    tienda.actualizar(id, {
      estado: "impresion",
      detalle: "Se abrió el diálogo de impresión: elige «Guardar como PDF» y dónde guardarlo.",
    });
  };
  try {
    await preparar(alAbrirImpresion);
    alAbrirImpresion();
  } catch (e) {
    console.error(`[Mycelium] no se pudo exportar ${que}:`, e);
    tienda.actualizar(id, { estado: "fallo", detalle: mensajeDeError(e) });
  }
}
