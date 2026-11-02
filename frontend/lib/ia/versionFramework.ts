/**
 * La versión del framework de IA del vault: la ÚNICA fuente de verdad. El
 * historial de cada salto y el criterio para subirla están en el comentario
 * de `lib/ia/framework.ts`, que la reexporta.
 *
 * Vive en su propio módulo (`FUN-M-58`, C-H4 de la auditoría de eficiencia
 * del 2026-11-01): `lib/mcpControl.ts` la necesita para la marca del hook de
 * `mv`/`rm`, y `mcpControl` carga con el workspace. Importarla de
 * `framework.ts` arrastraba `skillsGeneradas.ts` (353 KB de texto) al arranque.
 */
export const FRAMEWORK_IA_VERSION = "2.4.0";
