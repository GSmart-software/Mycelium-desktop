import { create } from "zustand";
import { mensajeDeError } from "@/lib/mensajeError";

/**
 * Avisos flotantes con una acción opcional (`FUN-M-33`). Nacieron para el
 * borrado: una nota que se va a la papelera sin decir nada no da forma de saber
 * si se puede volver atrás (crítica del cascarón, 2026-09-20).
 *
 * Son efímeros y no se persisten: informan de algo que acaba de pasar.
 */
export type Aviso = {
  id: number;
  texto: string;
  /** Lo que se puede hacer al respecto, normalmente deshacer. */
  accion?: { etiqueta: string; hacer: () => void | Promise<void> };
};

type AvisosState = {
  avisos: Aviso[];
  avisar: (texto: string, accion?: Aviso["accion"]) => number;
  cerrar: (id: number) => void;
};

let siguiente = 1;

export const useAvisosStore = create<AvisosState>((set) => ({
  avisos: [],
  avisar(texto, accion) {
    const id = siguiente++;
    // Como mucho tres a la vez: más se vuelven una pila que tapa la nota.
    set((s) => ({ avisos: [...s.avisos, { id, texto, accion }].slice(-3) }));
    return id;
  },
  cerrar: (id) => set((s) => ({ avisos: s.avisos.filter((a) => a.id !== id) })),
}));

/** Atajo para no tener que sacar el store en cada sitio. */
export function avisar(texto: string, accion?: Aviso["accion"]): number {
  return useAvisosStore.getState().avisar(texto, accion);
}

/**
 * Manejador de rechazo para una acción de usuario que puede fallar (`DEF-136`):
 * `void store.createNota(…).then(abrir).catch(avisarFallo("crear la nota"))`.
 * Sin él, el fallo quedaba como promesa rechazada sin capturar —en desarrollo,
 * un «Runtime Error» a pantalla completa; en producción, nada— y el usuario no
 * se enteraba de que su nota no se había creado.
 *
 * `accion` completa la frase «No se pudo …». El motivo es el del error, con el
 * texto de los rechazos de Tauri conservado (`mensajeDeError`).
 */
export function avisarFallo(accion: string): (e: unknown) => void {
  return (e) => {
    console.error(`[Mycelium] no se pudo ${accion}:`, e);
    avisar(`No se pudo ${accion}: ${mensajeDeError(e)}`);
  };
}

/**
 * Lo mismo para las acciones que no rechazan sino que devuelven `{ ok: false,
 * error }` (mover nota o carpeta: revierten el movimiento optimista y avisan
 * por el valor). Sin esto, arrastrar a un destino ocupado volvía el elemento a
 * su lugar sin decir por qué.
 */
export function avisarSiFallo(accion: string): (r: { ok: boolean; error?: string }) => void {
  return (r) => {
    if (!r.ok) avisar(`No se pudo ${accion}: ${r.error ?? "Error desconocido"}`);
  };
}
