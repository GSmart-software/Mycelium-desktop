"use client";

import { Fragment, useRef } from "react";
import { useTabsStore, type PaneNode, type SplitPane } from "@/stores/tabsStore";
import { EditorPane } from "./EditorPane";
import { propsDeSeparador } from "@/components/workspace/separador";
import styles from "./panes.module.css";

/** Render recursivo del árbol de panes (HU-26 CA5: grids M×N anidados). */
export function PaneTree({ node }: { node: PaneNode }) {
  if (node.type === "leaf") return <EditorPane pane={node} />;
  return <SplitContainer split={node} />;
}

function SplitContainer({ split }: { split: SplitPane }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setSizes = useTabsStore((s) => s.setSizes);

  /** Las props de teclado del divisor entre el panel `index` y el siguiente. */
  function separadorDelPar(index: number) {
    const par = (split.sizes[index] ?? 1) + (split.sizes[index + 1] ?? 1);
    const pct = ((split.sizes[index] ?? 1) / Math.max(par, 1e-6)) * 100;
    return propsDeSeparador({
      etiqueta: split.direction === "row" ? "Ancho de los paneles" : "Alto de los paneles",
      texto: `${Math.round(pct)} %`,
      valor: pct,
      min: 12,
      max: 88,
      orientacion: split.direction === "row" ? "vertical" : "horizontal",
      paso: 2,
      pasoGrande: 10,
      alCambiar: (v) => {
        const sizes = [...split.sizes];
        sizes[index] = (par * v) / 100;
        sizes[index + 1] = par - sizes[index];
        setSizes(split.id, sizes);
      },
    });
  }

  // Divisor arrastrable entre panes (HU-26 CA4)
  function startDrag(index: number, event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    // DEF-104: el divisor CAPTURA el puntero. Sin esto, al pasar sobre un
    // `iframe` (draw.io, un PDF, un video) los eventos van al documento del
    // iframe y la ventana deja de recibir `pointermove`: el arrastre se corta.
    // Con la captura, los eventos siguen llegando al divisor —y de ahí suben a
    // `window`— aunque el puntero esté encima de otro documento.
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const rect = container.getBoundingClientRect();
    const total = split.direction === "row" ? rect.width : rect.height;
    const startPos = split.direction === "row" ? event.clientX : event.clientY;
    const startSizes = [...split.sizes];

    function onMove(ev: PointerEvent) {
      const pos = split.direction === "row" ? ev.clientX : ev.clientY;
      const delta = (pos - startPos) / Math.max(1, total);
      const pair = startSizes[index] + startSizes[index + 1];
      const a = Math.max(0.12, Math.min(startSizes[index] + delta, pair - 0.12));
      const sizes = [...startSizes];
      sizes[index] = a;
      sizes[index + 1] = pair - a;
      setSizes(split.id, sizes);
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      handle.removeEventListener("lostpointercapture", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Si el sistema quita la captura (Alt+Tab en pleno arrastre), el arrastre
    // termina ahí y no queda un `pointermove` colgado.
    handle.addEventListener("lostpointercapture", onUp);
  }

  return (
    <div
      ref={containerRef}
      className={split.direction === "row" ? styles.splitRow : styles.splitColumn}
    >
      {split.children.map((child, index) => (
        <Fragment key={child.id}>
          <div
            className={styles.splitCell}
            style={{ flexGrow: split.sizes[index] ?? 1, flexBasis: 0 }}
          >
            <PaneTree node={child} />
          </div>
          {index < split.children.length - 1 && (
            <div
              // Con el teclado (`FUN-XL-04`, Parte 7): el valor es el porcentaje
              // del panel de antes dentro del par que separa (los dos suman
              // 100), entre 12 y 88, como el arrastre.
              {...separadorDelPar(index)}
              className={
                split.direction === "row" ? styles.dividerV : styles.dividerH
              }
              onPointerDown={(e) => startDrag(index, e)}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
