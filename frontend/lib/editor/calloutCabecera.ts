/**
 * Las expresiones que reconocen la cabecera de un callout en el editor:
 * `> [!tipo]`, con `>` anidados para callouts dentro de callouts (DEF-022) y el
 * símbolo de plegado opcional (`-`/`+`).
 *
 * Viven acá, y no en `livePreview.ts`, para poder probarlas sin CodeMirror
 * (`scripts/test-callout-cabecera.mjs`).
 *
 * > [!warning] Los espacios van de un solo lado del `>` (DEF-171)
 * > Con `(?:\s*>\s*)+`, los espacios entre dos `>` se pueden repartir entre el
 * > `\s*` final de una vuelta y el inicial de la siguiente. Si la línea no
 * > termina en `[!tipo]`, el motor prueba todos los repartos antes de rendirse:
 * > crece exponencialmente con los niveles (14 `>` separados por espacios, unos
 * > 4 s) y una nota así congela el editor. `(?:\s*>)+\s*` captura lo mismo y es
 * > lineal.
 */

/** Grupo 1 = marcadores `>` (su nº = profundidad), 2 = tipo, 3 = símbolo. */
export const CALLOUT_HEAD_RE = /^((?:\s*>)+\s*)\[!([\w-]+)\]([-+]?)/;

/** Grupo 1 = la cabecera hasta `]`, 2 = el símbolo de plegado. */
export const CALLOUT_PLIEGUE_RE = /^((?:\s*>)+\s*\[!\w+\])([-+])/;
