"use client";

import { useEffect, useRef, useState } from "react";
import { CajaCaptura } from "@/components/captura/CajaCaptura";
import { capturaComoTexto, type Captura, type DestinoCaptura } from "@/lib/bandeja";
import { anotarEnBandejaPersonal } from "@/lib/bandejaPersonal";
import { nombreDeVault } from "@/lib/vaultMode";
import { enTauri } from "@/lib/ventana";
import styles from "../workspace/CapturaRapida.module.css";

/** El ancho lógico de la ventana: el mismo que `ANCHO` en `captura_global.rs`. */
const ANCHO = 600;

/** Lo que manda Rust al mostrar la ventana, y lo que contesta al pedirlo. */
type Destinos = { vault: string | null };

async function invocar<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/**
 * La captura global (`FUN-L-33`, Parte C): la cajita en su propia ventana, la
 * que abre Ctrl+Shift+Espacio con Mycelium en segundo plano. La ventana la
 * crea, muestra, centra y oculta Rust (`src-tauri/src/captura_global.rs`);
 * esta página es solo la cajita, que ocupa la ventana entera.
 *
 * - **Vault**: el de la última ventana de Mycelium usada, que elige Rust. Esta
 *   ventana no escribe en él: le pide a esa ventana que anote
 *   (`captura_flotante_anotar_vault`) y espera la respuesta.
 * - **Personal**: la escribe esta misma ventana, por los comandos de la
 *   Bandeja personal, que no reciben rutas.
 *
 * Enter anota y oculta; Esc oculta sin anotar (lo escrito se descarta); perder
 * el foco oculta y **conserva** lo escrito para la próxima vez. Ocultar con
 * Enter o Esc le devuelve el foco al programa anterior.
 */
export function CapturaFlotante() {
  const [vault, setVault] = useState<string | null>(null);
  // Cambiar la clave vuelve a montar la cajita: vacía, con el destino recordado.
  const [vez, setVez] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enTauri()) return;
    let vivo = true;
    let soltar: (() => void) | null = null;
    void invocar<Destinos>("captura_flotante_destinos")
      .then((d) => vivo && setVault(d.vault))
      .catch(() => undefined);
    void (async () => {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const f = await getCurrentWebviewWindow().listen<Destinos>("captura-mostrar", ({ payload }) => setVault(payload.vault));
      if (vivo) soltar = f;
      else f();
    })();
    return () => {
      vivo = false;
      soltar?.();
    };
  }, []);

  // La ventana mide lo que la cajita: con un error a la vista, crece.
  useEffect(() => {
    const el = contenedor.current;
    if (!el || !enTauri()) return;
    let ultimo = 0;
    const obs = new ResizeObserver(() => {
      const alto = Math.ceil(el.getBoundingClientRect().height);
      if (alto === ultimo || alto === 0) return;
      ultimo = alto;
      void import("@tauri-apps/api/window").then(({ getCurrentWindow, LogicalSize }) =>
        getCurrentWindow().setSize(new LogicalSize(ANCHO, alto)).catch(() => undefined),
      );
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const ocultar = (devolverFoco: boolean) =>
    invocar("captura_flotante_ocultar", { devolverFoco }).catch(() => undefined);

  const anotar = async (captura: Captura, destino: DestinoCaptura) => {
    if (destino === "personal") await anotarEnBandejaPersonal(captura);
    else await invocar<string>("captura_flotante_anotar_vault", { texto: capturaComoTexto(captura) });
    await ocultar(true);
    setVez((v) => v + 1);
  };

  return (
    <div ref={contenedor} className={`${styles.contenedorFlotante} mic-captura-flotante`}>
      <CajaCaptura
        key={vez}
        flotante
        nombreVault={vault === null ? null : nombreDeVault(vault)}
        anotar={anotar}
        cerrar={() => {
          void ocultar(true);
          setVez((v) => v + 1);
        }}
      />
    </div>
  );
}
