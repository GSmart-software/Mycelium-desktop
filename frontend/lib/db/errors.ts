/**
 * Error de la capa de datos con código HTTP asociado. El dispatcher (`lib/api.ts`)
 * lo traduce a `ApiError` para que los call-sites vean el mismo comportamiento que
 * con el backend .NET (p. ej. un 400 al mover una carpeta dentro de sí misma se
 * captura y revierte el movimiento optimista).
 */
export class DbError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DbError";
    this.status = status;
  }
}
