"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { motivoDeExcepcion } from "@/lib/archivosIlegibles";
import { EVENTO_RECARGA } from "@/lib/eventos";
import {
  cargarExcalidraw,
  encuadrarDibujo,
  hayAlgoDibujado,
  IDIOMA_EXCALIDRAW,
  leerEscena,
  type ApiEncuadre,
  type EscenaLeida,
} from "@/lib/excalidraw";
import {
  olvidarGuardadoPendiente,
  registrarGuardadoPendiente,
} from "@/lib/guardadoPendiente";
import { avisoTocaA, hayQueRecargar, versionDeEscena } from "@/lib/recargaExterna";
import { useAuthStore } from "@/stores/authStore";
import { useSyncStore } from "@/stores/syncStore";
import { ArchivoIlegible } from "./ArchivoIlegible";
import styles from "./ExcalidrawFileEditor.module.css";

const Excalidraw = dynamic(
  async () => (await cargarExcalidraw()).Excalidraw,
  { ssr: false },
);

type ExcalidrawApi = {
  getSceneElements: () => readonly unknown[];
  getFiles: () => Record<string, unknown>;
  updateScene: (escena: { elements: readonly unknown[]; captureUpdate?: "NEVER" }) => void;
  addFiles: (archivos: unknown[]) => void;
} & ApiEncuadre;

/**
 * Qué muestra la vista. `ilegible` (`DEF-119`) NO monta Excalidraw: sin editor
 * no hay `onChange`, ni guardado, ni forma de pisar el archivo original.
 */
type Estado =
  | { tipo: "cargando" }
  | { tipo: "lista"; escena: EscenaLeida }
  | { tipo: "ilegible"; motivo: string };

/**
 * Editor Excalidraw a pantalla de pane para los archivos .excalidraw del vault
 * (HU-16): carga el contenido (JSON) de la nota tipo 'excalidraw', lo edita y
 * autoguarda con debounce vía el endpoint de contenido, como cualquier nota.
 */
export function ExcalidrawFileEditor({ notaId }: { notaId: string }) {
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  /**
   * Cuántas veces se montó Excalidraw. Va de `key`: cuando un archivo ilegible
   * se corrige, el editor se monta de cero con lo nuevo (`initialData` solo se
   * lee al montar).
   */
  const [montaje, setMontaje] = useState(0);
  /** Espejo de `estado.tipo === "ilegible"` para la recarga, que corre fuera del render. */
  const ilegibleRef = useRef(false);
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
  /**
   * Falta encuadrar el dibujo recién montado (`FUN-L-26`). Solo al montar
   * Excalidraw —la primera apertura, o al recuperarse de un archivo ilegible—:
   * la recarga desde disco conserva la cámara. Y solo si hay algo dibujado: un
   * dibujo en blanco no tiene qué encuadrar, y encuadrar su primer trazo movería
   * la vista mientras se dibuja.
   */
  const encuadrePendienteRef = useRef(false);
  const dark =
    typeof document !== "undefined" && document.documentElement.dataset.dark === "true";

  /**
   * Pasa la vista a lo que dice `disco`: el editor con la escena, o el aviso de
   * ilegible (`DEF-119`). Desde el aviso, un contenido legible monta Excalidraw
   * de cero; con el editor ya montado, el que llama usa `updateScene`.
   */
  const mostrarAviso = useCallback((disco: string | null, motivo: string) => {
    conocidoRef.current = disco;
    ilegibleRef.current = true;
    encuadrePendienteRef.current = false;
    // Sin editor montado no hay API: nada puede guardar (ni el volcado del updater).
    apiRef.current = null;
    sucioRef.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    setEstado({ tipo: "ilegible", motivo });
  }, []);

  const mostrarEscena = useCallback((disco: string, escena: EscenaLeida) => {
    conocidoRef.current = disco;
    ilegibleRef.current = false;
    versionBaseRef.current = versionDeEscena(escena.elements);
    encuadrePendienteRef.current = hayAlgoDibujado(escena.elements);
    setEstado({ tipo: "lista", escena });
    setMontaje((m) => m + 1);
  }, []);

  /** Lee el archivo del disco y lo muestra. Es la carga inicial y el «Reintentar». */
  const cargar = useCallback(
    async (vigente: () => boolean) => {
      let disco: string;
      try {
        const d = await api<{ contenido: string }>(
          `/notas/${encodeURIComponent(notaId)}/contenido`,
          { token: useAuthStore.getState().accessToken },
        );
        disco = d.contenido ?? "";
      } catch (e) {
        // Antes esto abría una escena vacía: un fallo de lectura quedaba igual
        // que un dibujo en blanco, y dibujar encima pisaba el archivo.
        if (vigente()) mostrarAviso(null, `No se pudo leer el archivo: ${motivoDeExcepcion(e)}`);
        return;
      }
      const lectura = await leerEscena(disco);
      if (!vigente()) return;
      if ("ilegible" in lectura) mostrarAviso(disco, lectura.ilegible);
      else mostrarEscena(disco, lectura.escena);
    },
    [notaId, mostrarAviso, mostrarEscena],
  );

  useEffect(() => {
    let cancelled = false;
    void cargar(() => !cancelled);
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [cargar]);

  const save = () => {
    const api2 = apiRef.current;
    if (!api2 || ilegibleRef.current) return Promise.resolve();
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
    // La primera `onChange` con la escena cargada: es cuando ya se puede
    // encuadrar. Alguna anterior puede llegar todavía sin elementos, antes de
    // que Excalidraw termine de leer `initialData`.
    if (encuadrePendienteRef.current && apiRef.current && hayAlgoDibujado(elementos)) {
      encuadrePendienteRef.current = false;
      encuadrarDibujo(apiRef.current);
    }
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
  //
  // Y con un archivo ilegible (`DEF-119`) es la vía de salida: cuando se corrige
  // desde fuera —lo típico: la IA arregla su propio error de sintaxis— la vista
  // se recupera sola. Al revés, si lo que llega está roto, la vista pasa al aviso
  // en vez de mostrar una escena vacía que invite a dibujar encima.
  useEffect(() => {
    async function recargar() {
      const a = apiRef.current;
      const desdeAviso = ilegibleRef.current;
      if ((!a && !desdeAviso) || sucioRef.current) return;
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
      const lectura = await leerEscena(disco);
      // Re-chequear tras los await: pudo desmontarse, cambiar de estado o
      // empezar a editarse.
      if (sucioRef.current || ilegibleRef.current !== desdeAviso || apiRef.current !== a) return;
      if ("ilegible" in lectura) {
        mostrarAviso(disco, lectura.ilegible);
        return;
      }
      if (desdeAviso || !a) {
        mostrarEscena(disco, lectura.escena);
        return;
      }
      conocidoRef.current = disco;
      versionBaseRef.current = versionDeEscena(lectura.escena.elements);
      if (lectura.escena.files) a.addFiles(Object.values(lectura.escena.files));
      a.updateScene({ elements: lectura.escena.elements, captureUpdate: "NEVER" });
    }
    function onRecarga(ev: Event) {
      if (avisoTocaA(ev, notaId)) void recargar();
    }
    window.addEventListener(EVENTO_RECARGA, onRecarga);
    return () => window.removeEventListener(EVENTO_RECARGA, onRecarga);
  }, [notaId, mostrarAviso, mostrarEscena]);

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

  if (estado.tipo === "ilegible") {
    return (
      <div className={styles.host}>
        <ArchivoIlegible
          ruta={notaId}
          formato="dibujo de Excalidraw"
          motivo={estado.motivo}
          onReintentar={() => void cargar(() => true)}
        />
      </div>
    );
  }

  return (
    <div className={styles.host}>
      {estado.tipo === "lista" && (
        <Excalidraw
          key={montaje}
          excalidrawAPI={(a) => {
            apiRef.current = a as unknown as ExcalidrawApi;
          }}
          theme={dark ? "dark" : "light"}
          langCode={IDIOMA_EXCALIDRAW}
          initialData={{
            elements: estado.escena.elements as never,
            files: estado.escena.files as never,
          }}
          onChange={onChange}
        />
      )}
    </div>
  );
}
