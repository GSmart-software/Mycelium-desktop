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
 *
 * OJO: `FRAMEWORK_IA_VERSION` (`lib/ia/framework.ts`) versiona las instrucciones
 * que se generan en el vault y es INDEPENDIENTE de esta versión.
 */
export const APP_VERSION = "1.1.1";
