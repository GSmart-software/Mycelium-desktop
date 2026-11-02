/**
 * Las gráficas de la salud del vault (`FUN-L-32`): SVG propio, sin librerías,
 * con los colores del tema activo (`usePaletaGraficas`). Las usan la pestaña
 * «Salud del vault» y el panel lateral.
 */
export { Anillos } from "./Anillos";
export { BarrasCarpetas } from "./BarrasCarpetas";
export { BarrasLista, type ItemBarra } from "./BarrasLista";
export { BarrasTipos } from "./BarrasTipos";
export { ColumnasMes } from "./ColumnasMes";
export { EstadoVacio, type Resaltado } from "./comun";
export { CurvaMeses } from "./CurvaMeses";
export { Histograma } from "./Histograma";
export { ListaComposicion } from "./ListaComposicion";
export { Leyenda, Proporcion } from "./Proporcion";
export { useTooltip, type Detalle } from "./Tooltip";
export { useAncho } from "./useAncho";
