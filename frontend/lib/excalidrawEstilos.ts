/**
 * La hoja de estilos de Excalidraw (~140 KB), cargada recién cuando se carga el
 * paquete (`FUN-M-58`): la importa `cargarExcalidraw()` (`lib/excalidraw.ts`)
 * con un `import()` junto al paquete, así que llega con la pestaña de un
 * dibujo, el modal de un dibujo embebido o el primer embed que se dibuja, y no
 * con el selector de vaults ni con un workspace que nunca abre un dibujo.
 * Hasta acá vivía en `app/layout.tsx` y se cargaba en todas las rutas.
 */
import "@excalidraw/excalidraw/index.css";

export {};
