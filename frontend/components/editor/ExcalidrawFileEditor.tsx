"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useSyncStore } from "@/stores/syncStore";
import styles from "./ExcalidrawFileEditor.module.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false },
);

type ExcalidrawApi = {
  getSceneElements: () => readonly unknown[];
  getFiles: () => Record<string, unknown>;
};

type Scene = { elements: readonly unknown[]; files: Record<string, unknown> | null };

/**
 * Editor Excalidraw a pantalla de pane para los archivos .excalidraw del vault
 * (HU-16): carga el contenido (JSON) de la nota tipo 'excalidraw', lo edita y
 * autoguarda con debounce vía el endpoint de contenido, como cualquier nota.
 */
export function ExcalidrawFileEditor({ notaId }: { notaId: string }) {
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const [initial, setInitial] = useState<Scene | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dark =
    typeof document !== "undefined" && document.documentElement.dataset.dark === "true";

  useEffect(() => {
    let cancelled = false;
    void api<{ contenido: string }>(`/notas/${notaId}/contenido`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((d) => {
        if (cancelled) return;
        let scene: Scene = { elements: [], files: null };
        try {
          if (d.contenido) {
            const parsed = JSON.parse(d.contenido);
            scene = { elements: parsed.elements ?? [], files: parsed.files ?? null };
          }
        } catch {
          // contenido inválido → escena vacía
        }
        setInitial(scene);
      })
      .catch(() => {
        if (!cancelled) setInitial({ elements: [], files: null });
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [notaId]);

  const save = () => {
    const api2 = apiRef.current;
    if (!api2) return;
    const contenido = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "micelio",
      elements: api2.getSceneElements(),
      appState: {},
      files: api2.getFiles(),
    });
    useSyncStore.getState().setSyncState(notaId, "syncing");
    void api(`/notas/${notaId}/contenido`, {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { contenido },
    })
      .then(() => useSyncStore.getState().setSyncState(notaId, "synced"))
      .catch(() => useSyncStore.getState().setSyncState(notaId, "error"));
  };

  const onChange = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 800); // autoguardado (HU-04)
  };

  return (
    <div className={styles.host}>
      {initial !== undefined && (
        <Excalidraw
          excalidrawAPI={(a) => {
            apiRef.current = a as unknown as ExcalidrawApi;
          }}
          theme={dark ? "dark" : "light"}
          initialData={{
            elements: initial.elements as never,
            files: initial.files as never,
          }}
          onChange={onChange}
        />
      )}
    </div>
  );
}
