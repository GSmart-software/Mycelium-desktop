"use client";

import { createRoot, type Root } from "react-dom/client";
import { ContextMenu, type MenuItem } from "@/components/explorer/ContextMenu";

/**
 * El menú del corrector ortográfico (`FUN-L-12`): sugerencias, «Agregar al
 * diccionario del vault» e «Ignorar», con el mismo `ContextMenu` del explorador.
 *
 * Lo abre una extensión de CodeMirror (`lib/editor/ortografia.ts`), que no vive
 * dentro de ningún componente de React: por eso se monta en una raíz propia,
 * colgada del `body`, y se desmonta al cerrarse. Uno solo a la vez.
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

export function abrirMenuOrtografia(x: number, y: number, items: MenuItem[]): void {
  cerrar();
  const nodo = document.createElement("div");
  document.body.appendChild(nodo);
  const raiz = createRoot(nodo);
  actual = { raiz, nodo };
  raiz.render(<ContextMenu x={x} y={y} items={items} onClose={cerrar} />);
}
