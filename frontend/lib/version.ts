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
 * - `1.6.0` — solo desktop: **tres superficies nuevas para mirar el vault**. Las
 *   **bases** (`FUN-L-03`), archivos `.base` que agregan notas por sus propiedades
 *   en una tabla filtrable; el **canvas** (`FUN-L-18`), archivos `.canvas` con
 *   notas y textos dispuestos en el espacio y unidos por flechas; y la pantalla de
 *   **referencias del vault** (`FUN-L-17`, sobre el núcleo de `FUN-M-17`), que
 *   encuentra las referencias sin estructura de un proyecto adoptado y las
 *   convierte en enlaces. Las tres adoptan un formato de Obsidian, por el mismo
 *   motivo de siempre: que el vault siga siendo intercambiable.
 *
 *   **Minor, y uno solo**: el tamaño lo decide el cambio más significativo, no
 *   cuántos hay. Absorbe además las correcciones que se quedaron sin publicar
 *   (`DEF-046` la papelera, `DEF-049`/`DEF-050` la tabulación, `DEF-051` las
 *   confirmaciones), así que la `1.5.1` prevista ya no existe.
 * - `1.6.1` — solo desktop: **varios vaults abiertos a la vez, uno por ventana**
 *   (`FUN-L-16`), más la tanda de correcciones que vino con ella (`DEF-042`,
 *   `DEF-044`, `DEF-047`, `DEF-048`, `DEF-052`, `DEF-053`, `DEF-054`).
 *
 *   **Sería minor por la regla** —es capacidad nueva— pero el usuario decidió
 *   mantener `1.6.x`. Queda anotado para que no parezca un descuido ni siente
 *   precedente: la regla de `docs/decisiones/Versionado del sistema.md` sigue
 *   siendo la de siempre.
 *
 * - `1.7.0` — **trece funcionalidades en una tanda**, elegidas por el usuario.
 *   Las tablas `.base` dejan de ser de mirar y pasan a ser de trabajar
 *   (`FUN-M-27` negar y agrupar filtros, `FUN-S-16` buscador de campos,
 *   `FUN-S-15` ordenar por columna, `FUN-S-14` buscar dentro, `FUN-M-25` ancho
 *   de columna); las preferencias dejan de ser solo del usuario y pasan a poder
 *   ser **del vault** (`FUN-M-28` números de línea, `FUN-M-21` nombres del
 *   grafo, `FUN-M-29` el porte a web); las pestañas ganan marcas (`FUN-S-11`
 *   ícono del tipo, `FUN-S-12` color por consola); el código del vault se ve
 *   **coloreado** (`FUN-S-09`); la búsqueda deja elegir dónde busca y agrupa por
 *   carpeta (`FUN-M-20`, con las guías de indentación de `FUN-S-17`); y el
 *   **título renombra el archivo** (`FUN-M-24`).
 *
 *   **Minor, y uno solo**: el tamaño lo decide el cambio más significativo, no
 *   cuántos entran. Absorbe además `DEF-080`, `DEF-081` y `DEF-084` —este
 *   último salió de implementar `FUN-M-24`—, así que no hay patch aparte.
 *
 * OJO: `FRAMEWORK_IA_VERSION` (`lib/ia/framework.ts`) versiona las instrucciones
 * que se generan en el vault y es INDEPENDIENTE de esta versión. La deuda que
 * anotaba esta nota desde la 1.6.0 —la IA no conocía los `.base` ni los
 * `.canvas`— se saldó con la **1.5.0 del framework**, que sube con esta versión.
 */
export const APP_VERSION = "1.7.0";
