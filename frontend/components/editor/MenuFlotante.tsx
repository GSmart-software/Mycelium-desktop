"use client";

import { createRoot, type Root } from "react-dom/client";
import { ContextMenu, type MenuItem } from "@/components/explorer/ContextMenu";

/**
 * Un `ContextMenu` abierto desde fuera de React: el del corrector ortográfico
 * (`FUN-L-12`: sugerencias, «Agregar al diccionario del vault», «Ignorar») y el
 * de los estados de una tarea en la vista en vivo (`FUN-S-01`).
 *
 * Los abre una extensión de CodeMirror, que no vive dentro de ningún componente:
 * por eso se monta en una raíz propia, colgada del `body`, y se desmonta al
 * cerrarse. Uno solo a la vez. Se llamaba `abrirMenuOrtografia` hasta que tuvo
 * un segundo uso.
 */
let actual: { raiz: Root; nodo: HTMLDivElement } | null = null;

function cerrar() {
  if (!actual) return;
  const { raiz, nodo } = actual;
  actual = null;
  // Desmontar dentro del propio clic que lo cierra da un aviso de React: se
  // difiere un turno.
  queueMicrotask(() => {
    raiz.unmount();
    nodo.remove();
  });
}

export function abrirMenuFlotante(x: number, y: number, items: MenuItem[]): void {
  cerrar();
  const nodo = document.createElement("div");
  document.body.appendChild(nodo);
  const raiz = createRoot(nodo);
  actual = { raiz, nodo };
  raiz.render(<ContextMenu x={x} y={y} items={items} onClose={cerrar} />);
}
