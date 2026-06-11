"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeDoc } from "@/lib/editor/docBroker";
import { getView } from "@/lib/editor/viewRegistry";
import { getCachedNote } from "@/lib/idb";
import { renderMarkdown } from "@/lib/markdown";
import { renderMermaidIn } from "@/lib/mermaid";
import { findLeaf, useTabsStore, type LeafPane } from "@/stores/tabsStore";
import styles from "./panes.module.css";

/**
 * Pane vinculado como preview (HU-27): muestra el render (modo read) de la
 * nota activa del pane origen, actualizado en tiempo real vía docBroker.
 */
export function LinkedPreviewPane({ pane }: { pane: LeafPane }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceNotaId = useTabsStore((s) => {
    const source = pane.linkedTo ? findLeaf(s.root, pane.linkedTo) : null;
    if (!source || !source.activeTabId) return null;
    return source.tabs.find((t) => t.id === source.activeTabId)?.notaId ?? null;
  });
  const [html, setHtml] = useState("");

  useEffect(() => {
    if (!sourceNotaId) {
      setHtml("");
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    void getCachedNote(sourceNotaId).then((cached) => {
      if (cached) setHtml(renderMarkdown(cached.content));
    });
    const unsubscribe = subscribeDoc(sourceNotaId, `linked-${pane.id}`, (content) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setHtml(renderMarkdown(content)), 130);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [sourceNotaId, pane.id]);

  // Diagramas Mermaid (HU-18)
  useEffect(() => {
    if (containerRef.current) void renderMermaidIn(containerRef.current);
  }, [html]);

  // Scroll sincronizado opcional con el editor de origen (HU-27 CA4)
  useEffect(() => {
    if (!pane.linkedScrollSync || !pane.linkedTo) return;
    const sourceView = getView(pane.linkedTo);
    const target = containerRef.current;
    if (!sourceView || !target) return;

    const scroller = sourceView.scrollDOM;
    function onScroll() {
      if (!target) return;
      const ratio =
        scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
    }
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [pane.linkedScrollSync, pane.linkedTo]);

  if (!sourceNotaId) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyHint}>El pane de origen no tiene una nota activa.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mic-preview mic-layout-read">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
