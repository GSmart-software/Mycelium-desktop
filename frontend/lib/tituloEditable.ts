/**
 * Renombrar el archivo escribiendo en el título que se ve arriba de la nota
 * (`FUN-M-24`).
 *
 * Acá está **qué pasa**, no cómo se dibuja. Lo consume el widget de bloque de
 * `lib/editor/docTitle.ts`, que es DOM a mano dentro de CodeMirror y el peor
 * sitio posible para dejar las reglas: nada de esto —qué cuenta como «no
 * cambió», qué se manda al disco, qué se muestra cuando falla— se puede probar
 * desde ahí.
 *
 * Módulo **puro y sin imports**: se prueba headless (`scripts/test-titulo.mjs`).
 *
 * > [!important] Renombrar RECHAZA; importar CORRIGE. No es la misma política
 * > `sanearNombre` (`lib/db/nombres.ts`) sustituye los caracteres inválidos por
 * > `-` y sigue adelante, y para lo que existe está bien: al importar un archivo
 * > o crear una nota desde una plantilla, el nombre ya viene dado y tiene que
 * > aterrizar en algún sitio.
 * >
 * > Renombrar es otra situación: hay alguien mirando que **acaba de escribirlo**.
 * > Cambiarle las letras en silencio le deja un archivo que no se llama como
 * > pidió y ninguna forma de saber por qué. Así que acá se rechaza y se dice cuál
 * > es el problema.
 * >
 * > Lo que NO se adelanta es lo que esto no puede saber: si el nombre ya está
 * > ocupado depende de la carpeta, y eso lo contesta quien renombra de verdad.
 * > Su mensaje es el que se muestra.
 *
 * > [!warning] Los caracteres prohibidos están escritos DOS veces
 * > Acá y en `sanearNombre`. No se puede evitar: `lib/db/` es solo-desktop y los
 * > dos módulos son puros —cada uno se transpila solo para su test headless—, así
 * > que ninguno puede importar al otro. Lo que sí se puede evitar es que se
 * > separen sin que nadie lo note, y de eso se encarga un test de
 * > `scripts/test-titulo.mjs`: comprueba que todo lo que esto rechaza es
 * > exactamente lo que aquél sustituye.
 */

/** Qué hacer después de intentar renombrar desde el título. */
export type ResultadoTitulo =
  /** No había nada que hacer (mismo nombre): se sale de edición sin más. */
  | { estado: "sin-cambios" }
  /** Renombrado. El título nuevo llega solo, por el árbol del vault. */
  | { estado: "renombrado"; titulo: string }
  /** No se pudo: se dice el motivo y se vuelve al nombre original. */
  | { estado: "error"; motivo: string };

/** Lo que se muestra cuando el error no trae mensaje propio. */
const MOTIVO_GENERICO = "No se pudo renombrar el archivo.";

/**
 * Caracteres que Windows prohíbe en un nombre de archivo (y que en POSIX dan
 * problemas). Es el mismo juego que sustituye `sanearNombre`; acá se rechaza.
 */
const PROHIBIDOS = /[\\/:*?"<>|]/g;

/** Caracteres de control (0x00–0x1F): tampoco valen en un nombre de archivo. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f]/;

/** Nombres de dispositivo reservados en Windows: `CON.md` también lo es. */
const RESERVADOS = new Set<string>([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * ¿Por qué este nombre no sirve como nombre de archivo? `null` si sirve.
 *
 * Las reglas son las de Windows aunque el vault viva en otro sistema: un nombre
 * que solo funciona en Linux convierte un vault en una carpeta que no se puede
 * copiar a otra máquina, y eso se descubre tarde y mal.
 */
export function motivoNombreInvalido(nombre: string): string | null {
  const limpio = nombre.trim();
  if (limpio.length === 0) return "El nombre no puede estar vacío.";

  const malos = [...new Set(limpio.match(PROHIBIDOS) ?? [])];
  if (malos.length > 0) {
    // Se dicen CUÁLES: «tiene caracteres inválidos» obliga a buscarlos a ojo.
    return `Un nombre de archivo no puede llevar ${malos.join(" ")}`;
  }
  if (CONTROL.test(limpio)) return "El nombre lleva caracteres de control.";

  // Windows los recorta en silencio, y entonces el nombre en disco dejaría de
  // coincidir con el del índice.
  if (/[. ]$/.test(limpio)) return "El nombre no puede terminar en punto ni en espacio.";

  if (RESERVADOS.has(limpio.toLowerCase())) {
    return `«${limpio}» es un nombre que Windows reserva para sus dispositivos.`;
  }
  return null;
}

/**
 * Intenta renombrar, y devuelve qué debe hacer la interfaz.
 *
 * `renombrar` es el renombrado real (`vaultStore.renameNota`), que en desktop
 * baja a disco y en web va al backend. Si rechaza, su mensaje es el que se
 * muestra: viene del único sitio que sabe por qué falló.
 */
export async function aplicarTitulo(
  actual: string,
  propuesto: string,
  renombrar: (titulo: string) => Promise<void>,
): Promise<ResultadoTitulo> {
  const limpio = propuesto.trim();

  // Lo que se sabe sin preguntar se contesta acá. Mandarlo a renombrar habría
  // hecho esperar un viaje de ida y vuelta —y, en el caso de los caracteres
  // prohibidos, habría vuelto con el nombre YA cambiado.
  const invalido = motivoNombreInvalido(limpio);
  if (invalido !== null) return { estado: "error", motivo: invalido };

  // Sin cambio no se toca el disco. Importa más de lo que parece: renombrar
  // reescribe los `[[enlaces]]` entrantes (`FUN-M-08`) y recarga el árbol, así
  // que un «renombrado» a lo mismo tendría un costo real y ningún efecto.
  if (limpio === actual.trim()) return { estado: "sin-cambios" };

  try {
    await renombrar(limpio);
    return { estado: "renombrado", titulo: limpio };
  } catch (e) {
    const motivo = e instanceof Error && e.message.trim() !== "" ? e.message : MOTIVO_GENERICO;
    return { estado: "error", motivo };
  }
}
