import { create } from "zustand";

/**
 * La pregunta de confirmación que está en pantalla, si hay alguna
 * (`FUN-M-33`). Vive en un store para que `confirmar()` siga siendo una función
 * que devuelve una promesa —los sitios que la usan no cambian— y el diálogo lo
 * dibuje React con el lenguaje de Mycelium, en vez del diálogo del sistema.
 */
type Pendiente = {
  mensaje: string;
  confirmar: string;
  resolver: (ok: boolean) => void;
};

type ConfirmarState = {
  pendiente: Pendiente | null;
  /** ¿Hay un árbol de React montado que pueda dibujar el diálogo? */
  montado: boolean;
  setMontado: (v: boolean) => void;
  preguntar: (mensaje: string, confirmar: string) => Promise<boolean>;
  responder: (ok: boolean) => void;
};

export const useConfirmarStore = create<ConfirmarState>((set, get) => ({
  pendiente: null,
  montado: false,
  setMontado: (montado) => set({ montado }),
  preguntar(mensaje, confirmar) {
    // Una pregunta a la vez: si llega otra, la anterior se cancela (y por lo
    // tanto NO se ejecuta su acción destructiva).
    get().pendiente?.resolver(false);
    return new Promise<boolean>((resolver) => set({ pendiente: { mensaje, confirmar, resolver } }));
  },
  responder(ok) {
    const p = get().pendiente;
    set({ pendiente: null });
    p?.resolver(ok);
  },
}));
