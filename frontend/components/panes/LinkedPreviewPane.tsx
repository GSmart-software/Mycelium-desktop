"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { subscribeDoc } from "@/lib/editor/docBroker";
import { getView } from "@/lib/editor/viewRegistry";
import { renderDrawioIn } from "@/lib/drawioRender";
import { renderExcalidrawIn } from "@/lib/excalidraw";
import { rellenarImagenesEn } from "@/lib/imagenesRender";
import { renderNota } from "@/lib/markdown";
import { renderMermaidIn } from "@/lib/mermaid";
import { useHtmlDecorable } from "@/lib/useHtmlDecorable";
import { findLeaf, useTabsStore, type LeafPane } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";
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
  // Imágenes del vault (`DEF-126`): se vuelven a resolver si cambia la lista
  // de archivos o la carpeta de la nota.
  const otros = useVaultStore((s) => s.otros);
  const carpeta = useVaultStore((s) =>
    sourceNotaId ? (s.notas.find((n) => n.id === sourceNotaId)?.carpetaId ?? null) : null,
  );

  useEffect(() => {
    if (!sourceNotaId) {
      setHtml("");
      return;
    }
    let vigente = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Carga inicial: el texto vivo del editor de origen si está a la vista —puede
    // llevar cambios que todavía no se guardaron— y si no, el del disco. Antes
    // salía de la caché de IndexedDB, que en desktop se retiró (`FUN-M-40`, D7).
    const vivo = pane.linkedTo ? getView(pane.linkedTo) : null;
    if (vivo) {
      setHtml(renderNota(vivo.state.doc.toString()));
    } else {
      void api<{ contenido: string }>(`/notas/${encodeURIComponent(sourceNotaId)}/contenido`)
        .then(({ contenido }) => {
          if (vigente) setHtml(renderNota(contenido));
        })
        .catch(() => {
          /* nota inaccesible: se deja vacío */
        });
    }
    const unsubscribe = subscribeDoc(sourceNotaId, `linked-${pane.id}`, (content) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setHtml(renderNota(content)), 130);
    });
    return () => {
      vigente = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [sourceNotaId, pane.id, pane.linkedTo]);

  // Diagramas Mermaid (HU-18) y Excalidraw (HU-16) — solo lectura
  useEffect(() => {
    if (containerRef.current) {
      void renderMermaidIn(containerRef.current);
      void renderExcalidrawIn(containerRef.current);
      void renderDrawioIn(containerRef.current);
      rellenarImagenesEn(containerRef.current, carpeta);
    }
  }, [html, sourceNotaId, otros, carpeta]);
  // Mismo objeto mientras el efecto de arriba no vuelva a correr (`DEF-133`).
  const inner = useHtmlDecorable(html, [sourceNotaId, otros, carpeta]);

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
      <div dangerouslySetInnerHTML={inner} />
    </div>
  );
}
