/**
 * Registro de guardados pendientes (`FUN-L-14`).
 *
 * Los editores guardan con debounce: entre la última tecla y la escritura real
 * pasan cientos de milisegundos. Actualizar **cierra la app**, así que hay algo
 * que hacer antes de lanzar el instalador: forzar esos guardados y esperar a
 * que terminen. Perder la última frase que escribió el usuario por actualizar
 * sería el peor resultado posible de esta funcionalidad.
 *
 * Cada editor montado se registra con una clave propia y una función que
 * escribe **ya** lo que tenga pendiente (idempotente: si no hay nada sucio, no
 * hace nada). `vaciarGuardadosPendientes()` las ejecuta todas y espera.
 *
 * Es un módulo sin store y sin dependencias, a propósito: lo importan tanto los
 * editores como el updater, y un ciclo de imports acá no arreglaría nada.
 */

type Guardado = () => Promise<void> | void;

const pendientes = new Map<string, Guardado>();

/** Registra (o reemplaza) el volcado de un editor montado. */
export function registrarGuardadoPendiente(clave: string, guardar: Guardado): void {
  pendientes.set(clave, guardar);
}

/** Da de baja el volcado de un editor al desmontarse. */
export function olvidarGuardadoPendiente(clave: string): void {
  pendientes.delete(clave);
}

/**
 * Fuerza todos los guardados pendientes y espera a que terminen.
 *
 * Nunca lanza: si un editor falla al guardar, los demás igual se vacían. Que
 * una nota no se pueda escribir no es motivo para perder también las otras.
 */
export async function vaciarGuardadosPendientes(): Promise<void> {
  await Promise.all(
    [...pendientes.values()].map(async (guardar) => {
      try {
        await guardar();
      } catch {
        // best-effort: se sigue con el resto
      }
    }),
  );
}
