// Lo que pertenece al modo desarrollador (`FUN-S-36`) y no puede aparecer en nada
// que vea el usuario normal: ni en el changelog de una versión (`publicar.mjs`) ni
// en la ayuda integrada (`test-modo-dev.mjs`). El modo es oculto a propósito, y
// también lo es todo lo que habilita: anunciar una opción de desarrollador revela
// que existe un modo que la muestra.
//
// Una sola lista para los dos controles. Toda funcionalidad nueva que quede detrás
// del modo dev suma acá su ID y los nombres con que se la ve en la app
// (ver [[modo-dev]] § «Qué queda detrás»).
//
// F12 / Ctrl+Shift+I **no** están: abren las herramientas de desarrollador para
// todos y la ayuda los documenta (decisión del usuario, 2026-10-08).

export const SECRETO_DEV = [
  // El modo en sí, con sus nombres de antes y de ahora, y el indicador del pie.
  { patron: /modo\s+(?:desarrollador|dev|avanzado)\b/i, que: "el modo desarrollador" },
  { patron: />\s*dev\b/i, que: "el comando oculto >dev" },
  { patron: /·\s*dev\b/i, que: "el indicador «· dev» de Configuración" },
  { patron: /\bsoloDev\b/, que: "la marca soloDev" },
  { patron: /\bFUN-M-16\b/i, que: "FUN-M-16 (el modo avanzado)" },
  { patron: /\bFUN-S-36\b/i, que: "FUN-S-36 (el modo desarrollador)" },
  // Lo que habilita (comandos de la paleta y opciones del actualizador).
  { patron: /desactivar el modo desarrollador/i, que: "un comando de desarrollador de la paleta" },
  { patron: /comandos? de desarrollador/i, que: "los comandos de desarrollador de la paleta" },
  { patron: /versiones publicadas/i, que: "«Versiones publicadas» del actualizador" },
  { patron: /servidor de actualizaciones/i, que: "«Servidor de actualizaciones» del actualizador" },
  // El tema Arrecife (`FUN-M-51`): la marca de otro proyecto del usuario, que
  // solo se puede elegir con el modo. Toda mención, también «tema Arrecife».
  { patron: /\barrecife\b/i, que: "el tema Arrecife" },
  { patron: /\bFUN-M-51\b/i, que: "FUN-M-51 (el tema Arrecife)" },
];

/** Devuelve la primera entrada de `SECRETO_DEV` que aparece en `texto`, o `null`. */
export function buscarSecretoDev(texto) {
  return SECRETO_DEV.find(({ patron }) => patron.test(texto)) ?? null;
}
