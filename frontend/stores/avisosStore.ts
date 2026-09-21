import { create } from "zustand";

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
