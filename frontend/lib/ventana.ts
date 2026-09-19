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
