/**
 * Modo desarrollador (`FUN-S-36`): la lógica pura, sin React ni Tauri, para
 * que la pruebe `scripts/test-modo-dev.mjs`.
 *
 * El modo se enciende y se apaga con un comando **oculto** de la paleta:
 * escribir `>dev` y Enter. No es una opción listada —no aparece al escribir
 * `>d`, `>de` ni `>dev`, ni en ninguna búsqueda— porque es para quien sabe que
 * existe (el usuario, al probar la app), no para descubrirlo por accidente.
 * Reemplaza al «modo avanzado» de los siete clics en la versión (`FUN-M-16`).
 *
 * Detrás del modo quedan las opciones de desarrollador del actualizador y los
 * comandos marcados `soloDev` de la paleta. Ver `docs/features/modo-dev.md`.
 */

/** Lo que hay que escribir después del «>» del modo comandos. */
export const CONSULTA_DEV = "dev";

/**
 * ¿El texto de la paleta es el comando oculto? Tiene que estar en modo
 * comandos —empezar con «>», la misma regla que usa la paleta para entrar en
 * él— y lo que sigue tiene que ser exactamente `dev`, sin importar mayúsculas
 * ni espacios alrededor. `dev` a secas (modo notas, Ctrl+O) **no** lo es: una
 * nota llamada «dev» se sigue abriendo como cualquier otra.
 */
export function esConsultaDev(texto: string): boolean {
  if (!texto.startsWith(">")) return false;
  return texto.slice(1).trim().toLowerCase() === CONSULTA_DEV;
}

/** Lo mínimo que tiene que tener un comando para poder filtrarlo. */
export type ConMarcaDev = { soloDev?: boolean };

/**
 * Los comandos que existen con el modo en el estado dado: sin el modo, los
 * `soloDev` desaparecen del todo —ni siquiera buscándolos por su nombre—; con
 * él, están todos.
 */
export function comandosDisponibles<T extends ConMarcaDev>(comandos: readonly T[], dev: boolean): T[] {
  return dev ? [...comandos] : comandos.filter((c) => !c.soloDev);
}

/** El aviso que confirma el cambio. */
export const avisoModoDev = (activo: boolean) =>
  activo ? "Modo desarrollador activado" : "Modo desarrollador desactivado";
