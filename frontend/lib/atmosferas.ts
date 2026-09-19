/**
 * Atmósferas (2026-09-19): el tercer eje del estilo, al lado del Tema (qué
 * colores: Bioluminiscencia o Cantarela) y el Modo (claro u oscuro). La
 * atmósfera decide CÓMO se reparten esos colores: fondos, marco, títulos y
 * bordes. Los valores viven en styles/atmosferas.css.
 *
 * Se elige una para cada modo, porque lo que funciona de noche no es lo que
 * funciona de día: por defecto Niebla en oscuro y Bosque en claro.
 */
export type Atmosfera = "abisal" | "niebla" | "bosque" | "papel";

export const ATMOSFERAS: { id: Atmosfera; nombre: string; descripcion: string }[] = [
  { id: "abisal", nombre: "Abisal", descripcion: "Marco profundo y brillos del tema en títulos y acentos" },
  { id: "niebla", nombre: "Niebla", descripcion: "Sobria, grises fríos; la nota es lo más claro" },
  { id: "bosque", nombre: "Bosque", descripcion: "El color del tema en el marco, la nota en calma" },
  { id: "papel", nombre: "Papel", descripcion: "Editorial y cálida, casi sin color" },
];

export const ATMOSFERA_OSCURO_DEFECTO: Atmosfera = "niebla";
export const ATMOSFERA_CLARO_DEFECTO: Atmosfera = "bosque";

export function atmosferaValida(v: unknown, defecto: Atmosfera): Atmosfera {
  return ATMOSFERAS.some((a) => a.id === v) ? (v as Atmosfera) : defecto;
}
