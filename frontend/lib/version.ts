/**
 * Versión del sistema, mostrada en Configuración. Se mantiene en sincronía con
 * `package.json` (y, en desktop, con `src-tauri/tauri.conf.json` y `Cargo.toml`).
 *
 * - `1.0.0` — primera versión final consolidada (misma en web y desktop).
 * - `1.1.0` — solo desktop: terminal integrada, framework de IA del vault,
 *   `.mycignore`, reordenar reglas del grafo, devtools en producción y
 *   optimización del dibujo del grafo. La línea **web** sigue en `1.0.0`: las dos
 *   pueden divergir (ver `docs/decisiones/`).
 * - `1.1.1` — solo desktop: rendimiento de la apertura del vault (`FUN-M-12`).
 *   El default de `.mycignore` cubre `node_modules/`, `target/`, `dist/` y `out/`;
 *   los metadatos viajan sin el contenido; las carpetas se upsertan solo si son
 *   nuevas; WAL en el índice; y el indexado muestra su avance. **Patch**: no hay
 *   funcionalidad nueva — lo mismo, más rápido y mejor comunicado.
 * - `1.1.5` — solo desktop: navegación por pestaña. **Cuatro patches**, uno por
 *   corrección: `DEF-039` (el scroll se conserva al volver a una pestaña),
 *   `DEF-040` (cada pestaña lleva su propio historial, con botones de atrás y
 *   adelante), `DEF-041` (endurecido el reemplazo de la pestaña de
 *   previsualización) y hacer visibles con botones las flechas de historial que
 *   antes solo existían en los botones auxiliares del ratón. Ninguna suma minor:
 *   no hay capacidad nueva, se corrige y se muestra lo que ya existía.
 * - `1.2.0` — solo desktop: **metadatos YAML** (`FUN-M-04`). El frontmatter deja
 *   de ser texto y pasa a ser propiedades: tarjeta en lectura y en la vista en
 *   vivo, pestaña PROPIEDADES en el panel de la nota, tabla `propiedades` en el
 *   índice y filtro `clave:valor` en el buscador. **Minor** (una funcionalidad,
 *   un minor; el patch vuelve a 0): el usuario puede hacer algo que antes no
 *   podía — dar atributos a sus notas y consultarlos.
 *
 * OJO: `FRAMEWORK_IA_VERSION` (`lib/ia/framework.ts`) versiona las instrucciones
 * que se generan en el vault y es INDEPENDIENTE de esta versión.
 */
export const APP_VERSION = "1.2.0";
