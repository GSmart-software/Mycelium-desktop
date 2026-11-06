/**
 * La ventana de Mycelium va sin la barra del sistema (`decorations: false`,
 * `FUN-M-31`): el marco lo dibuja la app. Acá vive lo común a los dos pedazos
 * que eso obliga a reponer — los controles y el redimensionado desde los
 * bordes—, que en web no existen.
 */
export function enTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Las ocho zonas del borde, en el orden en que las nombra Tauri. */
export const DIRECCIONES = [
  "North",
  "South",
  "East",
  "West",
  "NorthWest",
  "NorthEast",
  "SouthWest",
  "SouthEast",
] as const;

export type Direccion = (typeof DIRECCIONES)[number];

/**
 * ¿Es la ventana flotante de la captura global (`FUN-L-33`, Parte C)? Su página
 * es `/captura` en desarrollo y `captura.html` empaquetada. Ahí no van los
 * bordes de redimensionado ni la ayuda (F1): es una ventana de una línea.
 */
export function esVentanaCaptura(): boolean {
  if (typeof window === "undefined") return false;
  return /\/captura(?:\.html)?\/?$/.test(window.location.pathname);
}
