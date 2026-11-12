import { create } from "zustand";

/**
 * Las exportaciones en curso o recién terminadas (`FUN-M-22`): la tarjeta de
 * abajo a la derecha (`components/workspace/Exportaciones.tsx`). Hasta acá
 * exportar no daba ninguna señal: el archivo iba a parar a Descargas sin que
 * nada lo dijera.
 *
 * No es la pila de avisos (`avisosStore`, abajo a la izquierda) porque una
 * exportación **cambia** mientras está a la vista —de «exportando» a «listo» o
 * a «no se pudo»— y se queda hasta que termina, por larga que sea. Las dos
 * comparten el aspecto.
 *
 * La lógica que la llena vive en `lib/exportarConAviso.ts`. Efímera, no se
 * persiste.
 */
export type EstadoExportacion =
  /** Generando y escribiendo el archivo. */
  | "en-curso"
  /** Escrito: `ruta` dice dónde. */
  | "lista"
  /** Algo falló: `detalle` dice qué. */
  | "fallo"
  /** El PDF: se abrió el diálogo de impresión del sistema y el resto lo elige el usuario. */
  | "impresion";

export type Exportacion = {
  id: number;
  estado: EstadoExportacion;
  /** Qué se exporta, para el usuario: «Plan.md», «el vault como ZIP». */
  que: string;
  /** Dónde quedó: un archivo o una carpeta elegidos en el diálogo nativo. */
  ruta: string | null;
  /** `ruta` es una carpeta (exportar el vault a una carpeta), no un archivo. */
  esCarpeta?: boolean;
  /** El motivo de un fallo, o una indicación (impresión). */
  detalle?: string;
  /** Avance, si el trabajo lo informa (el vault entero). */
  progreso?: { hechos: number; total: number };
};

type ExportacionesState = {
  exportaciones: Exportacion[];
  iniciar: (que: string, ruta: string | null, esCarpeta?: boolean) => number;
  actualizar: (id: number, cambios: Partial<Omit<Exportacion, "id">>) => void;
  cerrar: (id: number) => void;
};

let siguiente = 1;

export const useExportacionesStore = create<ExportacionesState>((set) => ({
  exportaciones: [],
  iniciar(que, ruta, esCarpeta = false) {
    const id = siguiente++;
    // Como mucho tres a la vez, como los avisos: más tapan la nota.
    set((s) => ({
      exportaciones: [...s.exportaciones, { id, estado: "en-curso" as const, que, ruta, esCarpeta }].slice(-3),
    }));
    return id;
  },
  actualizar: (id, cambios) =>
    set((s) => ({ exportaciones: s.exportaciones.map((e) => (e.id === id ? { ...e, ...cambios } : e)) })),
  cerrar: (id) => set((s) => ({ exportaciones: s.exportaciones.filter((e) => e.id !== id) })),
}));
