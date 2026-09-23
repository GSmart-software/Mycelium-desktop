"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  accionCargar,
  contenidoParaCargar,
  leerEvento,
  urlDelEditor,
  type TemaDrawio,
} from "@/lib/drawio";
import { olvidarGuardadoPendiente, registrarGuardadoPendiente } from "@/lib/guardadoPendiente";
import { useAuthStore } from "@/stores/authStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSyncStore } from "@/stores/syncStore";
import styles from "./DrawioView.module.css";

/** Milisegundos de calma antes de escribir (mismo criterio que el editor). */
const GUARDADO_MS = 800;

/**
 * Editor de draw.io a pantalla de pane para los archivos `.drawio` del vault
 * (`FUN-L-20`).
 *
 * > [!important] Esto no es un componente de draw.io, es su aplicación entera
 * > Excalidraw se integró como componente React y por eso fue barato. draw.io no
 * > publica nada equivalente: lo que ofrece es la webapp en **modo embebido**, un
 * > `iframe` que habla por `postMessage`. Mycelium sigue siendo quien guarda el
 * > archivo; el iframe solo edita y devuelve el XML.
 *
 * La webapp está empaquetada en `public/drawio/` —la baja
 * `npm run preparar-drawio`—, así que se sirve del **mismo origen** que la app:
 * funciona sin conexión y no hay que abrir la CSP. Ver `docs/features/drawio.md`.
 */
export function DrawioView({ notaId }: { notaId: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** El último XML conocido: lo que se escribiría si hubiera que guardar ya. */
  const xmlRef = useRef<string | null>(null);
  const sucioRef = useRef(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CA6: el editor sigue al modo claro/oscuro de Mycelium. draw.io lee el tema
  // al arrancar, así que cambiarlo obliga a recargar el iframe; el XML vive en
  // `xmlRef`, no en el iframe, y por eso la recarga no pierde nada.
  const oscuro = usePreferencesStore((s) => s.modoOscuro);
  const tema: TemaDrawio = oscuro ? "oscuro" : "claro";

  // ── Carga ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelado = false;
    setCargado(false);
    void api<{ contenido: string }>(`/notas/${encodeURIComponent(notaId)}/contenido`, {
      token: useAuthStore.getState().accessToken,
    })
      .then((d) => {
        if (cancelado) return;
        // Un archivo vacío o con otra cosa se abre como diagrama nuevo en vez de
        // dejar el iframe colgado esperando un XML que no llega.
        xmlRef.current = contenidoParaCargar(d.contenido);
        setCargado(true);
      })
      .catch((e) => {
        if (cancelado) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelado = true;
    };
  }, [notaId]);

  // ── Guardado ───────────────────────────────────────────────────────────────
  const guardar = useCallback(() => {
    const xml = xmlRef.current;
    if (xml === null) return Promise.resolve();
    sucioRef.current = false;
    useSyncStore.getState().setSyncState(notaId, "syncing");
    return api(`/notas/${encodeURIComponent(notaId)}/contenido`, {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { contenido: xml },
    })
      .then(() => useSyncStore.getState().setSyncState(notaId, "synced"))
      .catch(() => useSyncStore.getState().setSyncState(notaId, "error"));
  }, [notaId]);

  const programarGuardado = useCallback(() => {
    sucioRef.current = true;
    useSyncStore.getState().setSyncState(notaId, "local");
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => void guardar(), GUARDADO_MS);
  }, [guardar, notaId]);

  // ── El puente `postMessage` ────────────────────────────────────────────────
  useEffect(() => {
    if (!cargado) return;

    function alRecibir(ev: MessageEvent) {
      // Solo lo que venga de NUESTRO iframe: por esta ventana pasan mensajes de
      // otras cosas, y confundir uno ajeno con un guardado escribiría el archivo.
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const msg = leerEvento(ev.data);
      if (msg === null) return;

      const enviar = (accion: unknown) =>
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify(accion), "*");

      if (msg.event === "init") {
        // El editor está listo: recién ahora acepta el diagrama.
        enviar(accionCargar(xmlRef.current ?? ""));
        return;
      }
      // `autosave` llega con cada cambio del modelo (lo pide `accionCargar`);
      // `save`, cuando el usuario guarda a mano. Los dos traen el XML completo.
      if (msg.event === "autosave" && typeof msg.xml === "string") {
        xmlRef.current = msg.xml;
        programarGuardado();
        return;
      }
      if (msg.event === "save" && typeof msg.xml === "string") {
        xmlRef.current = msg.xml;
        if (temporizador.current) clearTimeout(temporizador.current);
        void guardar();
      }
    }

    window.addEventListener("message", alRecibir);
    return () => window.removeEventListener("message", alRecibir);
  }, [cargado, guardar, programarGuardado]);

  // ── No perder trabajo ──────────────────────────────────────────────────────
  // Actualizar cierra la app (`FUN-L-14`): si el debounce todavía no corrió, el
  // updater fuerza acá la escritura y espera a que termine.
  useEffect(() => {
    registrarGuardadoPendiente(`drawio:${notaId}`, () => {
      if (!sucioRef.current) return;
      if (temporizador.current) clearTimeout(temporizador.current);
      return guardar();
    });
    return () => olvidarGuardadoPendiente(`drawio:${notaId}`);
  }, [notaId, guardar]);

  // Cerrar la pestaña desmonta la vista (CA3): un guardado en vuelo se fuerza en
  // vez de descartarse. No se puede esperar a que termine —React no aguarda la
  // limpieza— pero la escritura ya salió, que es lo que evita perder el trabajo.
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      if (sucioRef.current) void guardar();
    },
    [guardar],
  );

  if (error !== null) {
    return (
      <div className={styles.host}>
        <p className={styles.error}>No se pudo abrir el diagrama: {error}</p>
      </div>
    );
  }

  return (
    <div className={styles.host}>
      {cargado && (
        // `key` con el tema: al cambiar de claro a oscuro el iframe se rehace y
        // draw.io vuelve a leer el tema, que solo mira al arrancar.
        <iframe
          key={tema}
          ref={iframeRef}
          className={styles.marco}
          src={urlDelEditor(tema)}
          title="Editor de diagramas draw.io"
        />
      )}
    </div>
  );
}
