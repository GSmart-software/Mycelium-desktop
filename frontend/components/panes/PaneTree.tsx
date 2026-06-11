"use client";

import { Fragment, useRef } from "react";
import { useTabsStore, type PaneNode, type SplitPane } from "@/stores/tabsStore";
import { EditorPane } from "./EditorPane";
import styles from "./panes.module.css";

/** Render recursivo del árbol de panes (HU-26 CA5: grids M×N anidados). */
export function PaneTree({ node }: { node: PaneNode }) {
  if (node.type === "leaf") return <EditorPane pane={node} />;
  return <SplitContainer split={node} />;
}

function SplitContainer({ split }: { split: SplitPane }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setSizes = useTabsStore((s) => s.setSizes);

  // Divisor arrastrable entre panes (HU-26 CA4)
  function startDrag(index: number, event: React.PointerEvent) {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
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
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
              role="separator"
              aria-orientation={split.direction === "row" ? "vertical" : "horizontal"}
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
