"use client";

import { useEffect } from "react";
import { CajaCaptura } from "@/components/captura/CajaCaptura";
import { interpretarCaptura, textoAvisoCaptura } from "@/lib/bandeja";
import { anotarEnBandejaPersonal } from "@/lib/bandejaPersonal";
import { anotarEnBandeja } from "@/lib/bandejaVault";
import { mensajeDeError } from "@/lib/mensajeError";
import { nombreDeVault } from "@/lib/vaultMode";
import { enTauri } from "@/lib/ventana";
import { avisar } from "@/stores/avisosStore";
import { grabandoAtajo } from "@/lib/comandos/grabacion";
import { useUiStore } from "@/stores/uiStore";
import { useVaultSessionStore } from "@/stores/vaultSessionStore";
import styles from "./CapturaRapida.module.css";

/**
 * ¿Esta tecla es el atajo de la captura rápida (Ctrl+Shift+Espacio)? Por
 * `code` y no por `key`: con Mayús, algunos teclados no dan `" "`. Cmd en
 * macOS, como el resto de los atajos de la app.
 */
export function esAtajoCaptura(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.code === "Space" || e.key === " ");
}

/** Un segundo alternado antes de esto se descarta (ver `alternarCaptura`). */
const ANTIREBOTE_MS = 250;
let ultimoAlternado = -Infinity;

/**
 * Abre o cierra la cajita. Llega por dos caminos: la tecla en la página y, con
 * la captura global registrada (`FUN-L-33`, Parte C), el evento de Rust
 * `captura-rapida-alternar` cuando esta ventana tiene el foco. Un atajo global
 * de Windows se consume —la página no ve la tecla—, así que no llegan los dos;
 * por las dudas, un segundo alternado en menos de `ANTIREBOTE_MS` no cuenta
 * (abriría y cerraría la cajita en el mismo instante).
 */
function alternarCaptura(): void {
  const ahora = performance.now();
  if (ahora - ultimoAlternado < ANTIREBOTE_MS) return;
  ultimoAlternado = ahora;
  const ui = useUiStore.getState();
  ui.setCaptura(!ui.capturaAbierta);
}

/** El pedido de la ventana flotante: anotar este texto en la Bandeja de este vault. */
type PedidoAnotar = { id: string; texto: string };

type Invocar = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * La captura rápida (`FUN-L-33`): una cajita que flota arriba, sobre lo que
 * esté abierto, para anotar algo sin decidir dónde va. Enter lo agrega al
 * final de la Bandeja del vault, con la hora y bajo el encabezado del día; Esc
 * o un clic afuera cierra sin anotar. No abre la Bandeja ni cambia la pestaña
 * activa: al cerrarse, el foco vuelve adonde estaba.
 *
 * El pie tiene el **destino** (Parte B): la Bandeja del vault abierto o la
 * Bandeja personal, la misma desde todos los vaults. **Tab** lo alterna sin
 * salir del campo, y también un clic; se recuerda el último elegido (a nivel de
 * usuario), salvo que en Configuración → Vault se haya fijado uno. La cajita
 * en sí es `CajaCaptura`.
 *
 * Con Mycelium en segundo plano, el atajo lo atiende Rust y abre la cajita en
 * su propia ventana flotante (Parte C, `src-tauri/src/captura_global.rs` y
 * `components/captura/CapturaFlotante.tsx`). Si el destino es el vault de esta
 * ventana, la flotante le pide a ESTA que anote (`captura-anotar`): se atiende
 * acá, con el mismo `anotarEnBandeja` de la cajita, así que el contador y la
 * pestaña abierta de la Bandeja se enteran como siempre.
 */
export function CapturaRapida() {
  const abierta = useUiStore((s) => s.capturaAbierta);
  // El atajo se escucha siempre, en captura: así llega antes que CodeMirror,
  // la consola o un lienzo, que podrían quedarse con la tecla. Con la captura
  // global registrada no llega (Windows la consume) y alterna Rust.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!esAtajoCaptura(e) || grabandoAtajo()) return;
      e.preventDefault();
      e.stopPropagation();
      alternarCaptura();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  // La captura global: alternar desde Rust, anotar lo que manda la flotante, y
  // el aviso si el atajo no se pudo registrar (una sola vez, en la primera
  // ventana que lo pide).
  useEffect(() => {
    if (!enTauri()) return;
    let vivo = true;
    const soltar: (() => void)[] = [];
    void (async () => {
      const [{ getCurrentWebviewWindow }, { invoke }] = await Promise.all([
        import("@tauri-apps/api/webviewWindow"),
        import("@tauri-apps/api/core"),
      ]);
      // Solo los dirigidos a ESTA ventana: el `listen` global recibe también
      // los de las otras, y cada vault anotaría o abriría su cajita (`DEF-158`).
      const ventana = getCurrentWebviewWindow();
      const listen = ventana.listen.bind(ventana);
      const escuchas = await Promise.all([
        listen("captura-rapida-alternar", () => alternarCaptura()),
        listen<PedidoAnotar>("captura-anotar", ({ payload }) => void atenderPedido(payload, invoke)),
      ]);
      if (!vivo) {
        escuchas.forEach((f) => f());
        return;
      }
      soltar.push(...escuchas);
      const aviso = await invoke<string | null>("captura_global_aviso").catch(() => null);
      if (vivo && aviso) avisar(aviso, undefined, { duracionMs: 15000 });
    })();
    return () => {
      vivo = false;
      soltar.forEach((f) => f());
    };
  }, []);

  return abierta ? <Cajita /> : null;
}

/** Anota lo que mandó la flotante en la Bandeja de este vault y le contesta a Rust. */
async function atenderPedido({ id, texto }: PedidoAnotar, invoke: Invocar): Promise<void> {
  let error: string | null = null;
  try {
    // Se vuelve a interpretar acá: lo que llega es texto, no una captura armada.
    const captura = interpretarCaptura(texto);
    if (captura === null) throw new Error("No hay nada que anotar.");
    await anotarEnBandeja(captura);
  } catch (e) {
    error = mensajeDeError(e);
  }
  await invoke("captura_anotada", { id, error }).catch(() => undefined);
}

/** La cajita adentro de la app: sobre un velo, con el vault de esta ventana. */
function Cajita() {
  const rutaVault = useVaultSessionStore((s) => s.rutaActual);
  const cerrar = () => useUiStore.getState().setCaptura(false);
  return (
    <div
      className={`${styles.velo} mic-captura-velo`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cerrar();
      }}
    >
      <CajaCaptura
        nombreVault={rutaVault ? nombreDeVault(rutaVault) : ""}
        cerrar={cerrar}
        anotar={async (captura, destino) => {
          if (destino === "personal") await anotarEnBandejaPersonal(captura);
          else await anotarEnBandeja(captura);
          cerrar();
          avisar(textoAvisoCaptura(captura, destino));
        }}
      />
    </div>
  );
}
