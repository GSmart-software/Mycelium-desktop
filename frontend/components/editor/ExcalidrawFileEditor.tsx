"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { EVENTO_RECARGA } from "@/lib/eventos";
import {
  olvidarGuardadoPendiente,
  registrarGuardadoPendiente,
} from "@/lib/guardadoPendiente";
import { avisoTocaA, hayQueRecargar, versionDeEscena } from "@/lib/recargaExterna";
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
  updateScene: (escena: { elements: readonly unknown[]; captureUpdate?: "NEVER" }) => void;
  addFiles: (archivos: unknown[]) => void;
};

type Scene = { elements: readonly unknown[]; files: Record<string, unknown> | null };

/**
 * La escena que guarda un `.excalidraw`, pasada por `restoreElements`: lo mismo
 * que hace Excalidraw con `initialData`. Hace falta para `updateScene`, que NO
 * restaura, y un archivo escrito a mano (por una IA) puede traer elementos con
 * campos de menos. Contenido inválido → escena vacía, como al abrir.
 */
async function escenaDesde(contenido: string): Promise<Scene> {
  let crudo: { elements?: unknown; files?: unknown } = {};
  try {
    if (contenido) crudo = JSON.parse(contenido) ?? {};
  } catch {
    // contenido inválido → escena vacía
  }
  const elementos = Array.isArray(crudo.elements) ? crudo.elements : [];
  const { restoreElements } = await import("@excalidraw/excalidraw");
  return {
    elements: restoreElements(elementos as never, null),
    files:
      crudo.files && typeof crudo.files === "object"
        ? (crudo.files as Record<string, unknown>)
        : null,
  };
}

/**
 * Editor Excalidraw a pantalla de pane para los archivos .excalidraw del vault
 * (HU-16): carga el contenido (JSON) de la nota tipo 'excalidraw', lo edita y
 * autoguarda con debounce vía el endpoint de contenido, como cualquier nota.
 */
export function ExcalidrawFileEditor({ notaId }: { notaId: string }) {
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const [initial, setInitial] = useState<Scene | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ¿Hay cambios sin escribir? Lo consulta el volcado que fuerza el updater.
  const sucioRef = useRef(false);
  /**
   * Lo último que este editor sabe que está en disco: lo que leyó o lo que mandó
   * a guardar (`FUN-L-26`). Reconoce el eco del guardado propio cuando el
   * watcher avisa de un cambio (el criterio de `DEF-117` en `NoteEditor`).
   */
  const conocidoRef = useRef<string | null>(null);
  /**
   * `versionDeEscena` de lo que está en disco. `onChange` se dispara también al
   * mover la cámara o seleccionar, y al cargar una escena desde disco: solo
   * cuenta como cambio —y se guarda— si los elementos se apartaron de esto.
   */
  const versionBaseRef = useRef<number | null>(null);
  /** `versionDeEscena` del último `onChange`: la que queda en disco al guardar. */
  const versionActualRef = useRef<number | null>(null);
  const dark =
    typeof document !== "undefined" && document.documentElement.dataset.dark === "true";

  useEffect(() => {
    let cancelled = false;
    void api<{ contenido: string }>(`/notas/${encodeURIComponent(notaId)}/contenido`, {
      token: useAuthStore.getState().accessToken,
    })
      .then(async (d) => {
        if (cancelled) return;
        const scene = await escenaDesde(d.contenido ?? "");
        if (cancelled) return;
        conocidoRef.current = d.contenido ?? "";
        versionBaseRef.current = versionDeEscena(scene.elements);
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
    if (!api2) return Promise.resolve();
    sucioRef.current = false;
    // Lo que se escribe pasa a ser la base. Se toma la versión del último
    // `onChange` y no se recalcula de `getSceneElements`, que omite los
    // borrados y daría otra suma que la que ve `onChange`.
    versionBaseRef.current = versionActualRef.current;
    const elementos = api2.getSceneElements();
    const contenido = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "micelio",
      elements: elementos,
      appState: {},
      files: api2.getFiles(),
    });
    // Antes del await: si el watcher avisa mientras el guardado viaja, lo que
    // encuentre en disco es esto, y no es un cambio de afuera.
    conocidoRef.current = contenido;
    useSyncStore.getState().setSyncState(notaId, "syncing");
    return api(`/notas/${encodeURIComponent(notaId)}/contenido`, {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { contenido },
    })
      .then(() => useSyncStore.getState().setSyncState(notaId, "synced"))
      .catch(() => useSyncStore.getState().setSyncState(notaId, "error"));
  };

  const onChange = (elementos: readonly unknown[]) => {
    const version = versionDeEscena(elementos);
    versionActualRef.current = version;
    // Mover la cámara, seleccionar o la escena recién cargada desde disco no
    // cambian el archivo: no se marca nada ni se escribe. Antes cada `onChange`
    // guardaba, y eso —además de escribir de balde— reescribía en el formato de
    // Mycelium lo que una IA acababa de dejar en disco.
    if (version === versionBaseRef.current && !sucioRef.current) return;
    sucioRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 800); // autoguardado (HU-04)
  };

  // ── Cambios de afuera (`FUN-L-26`) ─────────────────────────────────────────
  //
  // Cuando el archivo cambia en disco por fuera de la app (una IA desde la
  // terminal, otro editor), el watcher avisa con `EVENTO_RECARGA` y se relee.
  // Con cambios sin escribir no se toca nada. La escena nueva entra por
  // `updateScene`, sin remontar Excalidraw: la cámara, el zoom, la herramienta
  // y la selección (de lo que siga existiendo) quedan como estaban. Va con
  // `captureUpdate: "NEVER"`, lo que la librería indica para cambios remotos:
  // el deshacer no «deshace» lo que escribió otro.
  useEffect(() => {
    async function recargar() {
      const a = apiRef.current;
      if (!a || sucioRef.current) return;
      let disco: string;
      try {
        const d = await api<{ contenido: string }>(
          `/notas/${encodeURIComponent(notaId)}/contenido`,
          { token: useAuthStore.getState().accessToken },
        );
        disco = d.contenido ?? "";
      } catch {
        return; // Best-effort: si falla la relectura, lo que se ve queda como está.
      }
      if (!hayQueRecargar({ disco, sucio: sucioRef.current, conocido: conocidoRef.current }))
        return;
      const escena = await escenaDesde(disco);
      // Re-chequear tras los await: pudo desmontarse o empezar a editarse.
      if (apiRef.current !== a || sucioRef.current) return;
      conocidoRef.current = disco;
      versionBaseRef.current = versionDeEscena(escena.elements);
      if (escena.files) a.addFiles(Object.values(escena.files));
      a.updateScene({ elements: escena.elements, captureUpdate: "NEVER" });
    }
    function onRecarga(ev: Event) {
      if (avisoTocaA(ev, notaId)) void recargar();
    }
    window.addEventListener(EVENTO_RECARGA, onRecarga);
    return () => window.removeEventListener(EVENTO_RECARGA, onRecarga);
  }, [notaId]);

  // Actualizar cierra la app (FUN-L-14): si el debounce de 800 ms todavía no
  // corrió, el updater fuerza acá la escritura y espera a que termine.
  useEffect(() => {
    registrarGuardadoPendiente(`excalidraw:${notaId}`, () => {
      if (!sucioRef.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      return save();
    });
    return () => olvidarGuardadoPendiente(`excalidraw:${notaId}`);
    // `save` se redefine en cada render pero siempre lee de refs: la versión
    // registrada al montar escribe lo mismo que la última.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaId]);

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
