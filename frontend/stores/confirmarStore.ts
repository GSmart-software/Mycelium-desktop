import { create } from "zustand";

/**
 * Las preguntas de confirmación (`FUN-M-33`). Vive en un store para que
 * `confirmar()` siga siendo una función que devuelve una promesa —los sitios
 * que la usan no cambian— y el diálogo lo dibuje React con el lenguaje de
 * Mycelium, en vez del diálogo del sistema.
 *
 * > [!important] Una **cola**, desde el MCP de control (`FUN-L-09`, Parte 3)
 * > Antes había una sola pregunta pendiente y una nueva cancelaba la anterior.
 * > Entre preguntas del usuario sigue siendo así (la que él acaba de provocar
 * > reemplaza a la que dejó en el aire), pero una pregunta de **la IA** no
 * > desplaza nunca a una del usuario —se encola detrás— ni la cancela una
 * > pregunta nueva: si el usuario provoca una mientras hay una de la IA en
 * > pantalla, la suya pasa adelante y la de la IA vuelve a aparecer después.
 * > Con una pendiente, cancelar la del usuario en silencio era no ejecutar su
 * > borrado sin explicación (`docs/arquitectura/MCP de Mycelium - control.md`
 * > § 3.2).
 */
export type OrigenPregunta = "usuario" | "ia";

type Pendiente = {
  id: number;
  origen: OrigenPregunta;
  mensaje: string;
  confirmar: string;
  resolver: (ok: boolean) => void;
};

type ConfirmarState = {
  /** Las preguntas en espera; la primera es la que está en pantalla. */
  cola: Pendiente[];
  /** La que está en pantalla (`cola[0]`), o ninguna. */
  pendiente: Pendiente | null;
  /** ¿Hay un árbol de React montado que pueda dibujar el diálogo? */
  montado: boolean;
  setMontado: (v: boolean) => void;
  /** Encola una pregunta. Devuelve su id (para retirarla) y la respuesta. */
  encolar: (mensaje: string, confirmar: string, origen: OrigenPregunta) => { id: number; respuesta: Promise<boolean> };
  preguntar: (mensaje: string, confirmar: string) => Promise<boolean>;
  /** Contesta la que está en pantalla. */
  responder: (ok: boolean) => void;
  /** Saca una pregunta de la cola sin que nadie la conteste: cuenta como «no». */
  retirar: (id: number) => void;
};

let siguienteId = 1;

const conCola = (cola: Pendiente[]) => ({ cola, pendiente: cola[0] ?? null });

export const useConfirmarStore = create<ConfirmarState>((set, get) => ({
  cola: [],
  pendiente: null,
  montado: false,
  setMontado: (montado) => set({ montado }),
  encolar(mensaje, confirmarTexto, origen) {
    const id = siguienteId++;
    let resolver: (ok: boolean) => void = () => {};
    const respuesta = new Promise<boolean>((r) => (resolver = r));
    const nueva: Pendiente = { id, origen, mensaje, confirmar: confirmarTexto, resolver };
    const cola = get().cola;
    if (origen === "usuario") {
      // Entre preguntas del usuario, la nueva reemplaza a la anterior (que se
      // cancela: NO se ejecuta su acción destructiva). Va adelante de las de la IA.
      for (const p of cola) if (p.origen === "usuario") p.resolver(false);
      set(conCola([nueva, ...cola.filter((p) => p.origen === "ia")]));
    } else {
      set(conCola([...cola, nueva]));
    }
    return { id, respuesta };
  },
  preguntar(mensaje, confirmarTexto) {
    return get().encolar(mensaje, confirmarTexto, "usuario").respuesta;
  },
  responder(ok) {
    const [primera, ...resto] = get().cola;
    set(conCola(resto));
    primera?.resolver(ok);
  },
  retirar(id) {
    const p = get().cola.find((x) => x.id === id);
    if (!p) return;
    set(conCola(get().cola.filter((x) => x.id !== id)));
    p.resolver(false);
  },
}));
