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
 * - `1.3.0` — solo desktop: **Esporas** (`FUN-M-03`), las plantillas de notas.
 *   Las notas de una carpeta configurable son moldes: se usan de tres formas
 *   (panel del rail, "Insertar Espora" en el editor y submenú del clic derecho
 *   de una carpeta) y sustituyen `{{titulo}}`, `{{fecha}}`, `{{hora}}` y
 *   `{{fecha:FORMATO}}`. **Minor** (una funcionalidad, un minor; el patch vuelve
 *   a 0): el usuario puede hacer algo que antes no podía — crear notas ya con su
 *   estructura, en vez de rehacerla cada vez.
 * - `1.4.0` — solo desktop: **autoactualización** (`FUN-L-14`) y **selección de
 *   versión** (`FUN-M-16`). Mycelium comprueba una vez al día si hay una versión
 *   nueva, muestra qué trae (el changelog renderizado con su propio motor de
 *   Markdown) y ofrece instalarla; nunca obliga y nunca bloquea. En modo
 *   avanzado —siete clics en este mismo número, en el pie de Configuración— se
 *   puede además instalar cualquier versión publicada, incluida una anterior.
 *   **Minor**: un release, un incremento, y el salto lo decide el cambio más
 *   significativo, no cuántos entran (las dos funcionalidades suman UN minor).
 *   El usuario puede hacer algo que antes no podía — enterarse de que hay una
 *   versión nueva e instalarla desde la app, sin que se lo digan.
 *
 * - `1.5.0` — solo desktop: **ancho de tabulación configurable** (`FUN-S-02`).
 *   Sube minor y no patch porque el usuario puede hacer algo que antes no podía:
 *   elegir cuánto vale una tabulación. Es también la **primera versión publicada
 *   con `npm run publicar`** y la que cierra el circuito de `FUN-L-14`, al ser la
 *   primera que una instalación previa puede detectar y aplicar sola.
 *
 * OJO: `FRAMEWORK_IA_VERSION` (`lib/ia/framework.ts`) versiona las instrucciones
 * que se generan en el vault y es INDEPENDIENTE de esta versión. **No cambia con
 * la 1.5.0**: un ajuste del editor no altera nada de lo que la IA debe saber del
 * vault.
 */
export const APP_VERSION = "1.5.0";
