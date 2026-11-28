"use client";

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import {
  abrirPty,
  escribirRutas,
  fueTocadaEstaCorrida,
  getInstancia,
  ocultarPestanas,
} from "@/lib/terminal";
import {
  puedeSoltarExternos,
  rutaDeArrastreInterno,
  rutaDeVault,
  rutasDeArchivosExternos,
  useConsolaDestino,
} from "@/lib/consolaSoltar";
import { autoFocoPermitido } from "@/lib/teclado/focoDom";
import { useTabsStore } from "@/stores/tabsStore";
import { useTerminalStore } from "@/stores/terminalStore";
import styles from "./TerminalView.module.css";

/**
 * Vista de una terminal integrada (FUN-L-07). El estado real (xterm + PTY) vive
 * en `lib/terminal.ts` a nivel de módulo: este componente solo adjunta el DOM de
 * su instancia y lo ajusta al tamaño del pane. Así, mover la pestaña de panel
 * (remount) NO reinicia la sesión (CA2).
 */
export function TerminalView({ termId }: { termId: string }) {
  const contRef = useRef<HTMLDivElement>(null);
  const ajustarRef = useRef<(() => void) | null>(null);
  const prefs = useTerminalStore((s) => s.prefs);
  const efectos = prefs.efectos;
  // Cada parte rige solo con el general encendido; el pulso, además, con la
  // aurora o el micelio (`FUN-S-37`): mueve el que esté encendido.
  const parte = (on: boolean) => efectos && on;
  const aurora = parte(prefs.efectoAurora);
  const micelio = parte(prefs.efectoMicelio);
  const pulso = (aurora || micelio) && prefs.efectoPulso;
  const colores = parte(prefs.efectoColores);
  // Soltar archivos escribe su ruta (`FUN-S-43`): la indicación se ve con un
  // arrastre HTML5 válido encima (archivos de afuera, una pestaña, un archivo
  // que no es nota) o cuando el explorador apunta acá una nota o una carpeta.
  const [soltandoHtml, setSoltandoHtml] = useState(false);
  const destinoDelArbol = useConsolaDestino((s) => s.termId === termId);
  const soltando = soltandoHtml || destinoDelArbol;

  useEffect(() => {
    const cont = contRef.current;
    if (!cont) return;

    // Restauración desactivada: una pestaña de la sesión anterior no se reabre
    // al arrancar — se OCULTA (la consola sigue listada en el panel y puede
    // abrirse desde allí, que la marca como tocada) (CA6).
    const { prefs } = useTerminalStore.getState();
    if (!fueTocadaEstaCorrida(termId) && !prefs.restaurarSesiones) {
      ocultarPestanas(termId);
      return;
    }

    const inst = getInstancia(termId);
    // Primera vez: montar el xterm; remounts: re-adjuntar su elemento.
    if (inst.term.element) {
      cont.appendChild(inst.term.element);
    } else {
      inst.term.open(cont);
    }

    // Ajuste al tamaño del pane; sincroniza el PTY cuando cambian cols/rows.
    let cols = inst.term.cols;
    let rows = inst.term.rows;
    const ajustar = () => {
      if (!cont.clientWidth || !cont.clientHeight) return;
      inst.fit.fit();
      if (inst.term.cols !== cols || inst.term.rows !== rows) {
        cols = inst.term.cols;
        rows = inst.term.rows;
        void invoke("terminal_redimensionar", { id: termId, cols, rows }).catch(() => {});
      }
    };
    ajustarRef.current = ajustar;
    const observer = new ResizeObserver(ajustar);
    observer.observe(cont);
    ajustar();

    // Pegado (`DEF-079`). El botón derecho pegaba el texto DOS veces: el
    // WebView lo insertaba en el textarea oculto de xterm —que lo manda al PTY
    // como si se hubiera tecleado— y además disparaba el evento `paste`, que
    // xterm también atiende. Dos caminos, un solo pegado del usuario.
    //
    // Se atiende acá, en CAPTURA sobre el contenedor: así corre antes que el
    // manejador de xterm y `stopPropagation` le impide llegar. Con
    // `preventDefault` tampoco se inserta en el textarea, o sea que queda un
    // único camino y se escribe una sola vez.
    //
    // Va en el contenedor de React y no en `term.element`, que sobrevive a los
    // remounts: ahí el manejador se acumularía uno por montaje, que es el mismo
    // pegado múltiple por otra puerta.
    const alPegar = (ev: ClipboardEvent) => {
      const texto = ev.clipboardData?.getData("text");
      if (texto === undefined || texto === "") return;
      ev.preventDefault();
      ev.stopPropagation();
      inst.term.paste(texto);
    };
    cont.addEventListener("paste", alPegar, true);

    // Soltar archivos escribe su ruta (`FUN-S-43`, ver `lib/consolaSoltar.ts`).
    // Solo el arrastre HTML5: el del árbol (dnd-kit) no llega acá y lo resuelve
    // el explorador. Lo que no es un archivo —un texto seleccionado, una
    // pestaña del grafo— no se toca: sigue de largo como hasta ahora.
    //
    // La zona es el área de texto con su aire alrededor (`.terminal`), y no
    // solo la grilla: soltar en el margen también vale.
    const zona = cont.parentElement ?? cont;
    const clasificar = (datos: DataTransfer | null): "externo" | "interno" | null => {
      if (!datos) return null;
      // Archivos de afuera: solo donde WebView2 sabe dar su ruta (Windows).
      if (datos.types.includes("Files")) return puedeSoltarExternos() ? "externo" : null;
      return rutaDeArrastreInterno(datos, false) !== null ? "interno" : null;
    };
    const alSobrevolar = (ev: DragEvent) => {
      const tipo = clasificar(ev.dataTransfer);
      if (!tipo) return;
      // `preventDefault` es lo que hace de la consola un destino válido.
      ev.preventDefault();
      if (tipo === "externo" && ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      setSoltandoHtml(true);
    };
    const alSalir = (ev: DragEvent) => {
      // `dragleave` también salta al pasar de un hijo a otro: solo cuenta si
      // el puntero dejó el contenedor.
      if (ev.relatedTarget instanceof Node && zona.contains(ev.relatedTarget)) return;
      setSoltandoHtml(false);
    };
    const alSoltar = (ev: DragEvent) => {
      setSoltandoHtml(false);
      const datos = ev.dataTransfer;
      const tipo = clasificar(datos);
      if (!tipo || !datos) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (tipo === "externo") {
        // Los `File` se copian YA: al terminar el evento, `dataTransfer` se vacía.
        const archivos = Array.from(datos.files);
        void rutasDeArchivosExternos(archivos).then((rutas) => escribirRutas(termId, rutas));
        return;
      }
      const relativa = rutaDeArrastreInterno(datos, true);
      const absoluta = relativa !== null ? rutaDeVault(relativa) : null;
      if (absoluta) escribirRutas(termId, [absoluta]);
    };
    // Un arrastre que termina o se cancela en otra parte no pasa por `dragleave`.
    const alTerminar = () => setSoltandoHtml(false);
    zona.addEventListener("dragenter", alSobrevolar, true);
    zona.addEventListener("dragover", alSobrevolar, true);
    zona.addEventListener("dragleave", alSalir, true);
    zona.addEventListener("drop", alSoltar, true);
    window.addEventListener("dragend", alTerminar);
    window.addEventListener("drop", alTerminar);

    void abrirPty(termId).then(() => ajustar());
    // Al abrirla, el teclado va a la shell; salvo que se haya llegado con
    // Ctrl+Tab, Ctrl+W o cambiando de panel (`FUN-XL-04`): ahí la consola queda
    // seleccionada y Enter entra, porque xterm se queda con casi todas las
    // teclas. Tampoco si su panel no es el activo: el foco activaría ese panel.
    const panel = cont.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId;
    const enPanelActivo = !panel || panel === useTabsStore.getState().activePaneId;
    if (autoFocoPermitido() && enPanelActivo) inst.term.focus();

    return () => {
      observer.disconnect();
      cont.removeEventListener("paste", alPegar, true);
      zona.removeEventListener("dragenter", alSobrevolar, true);
      zona.removeEventListener("dragover", alSobrevolar, true);
      zona.removeEventListener("dragleave", alSalir, true);
      zona.removeEventListener("drop", alSoltar, true);
      window.removeEventListener("dragend", alTerminar);
      window.removeEventListener("drop", alTerminar);
      setSoltandoHtml(false);
    };
  }, [termId]);

  // Los efectos cambian el interlineado y el relleno: cambian las filas que
  // entran sin que cambie el tamaño del pane, así que el ResizeObserver no se
  // entera. Se reajusta tras pintar.
  useEffect(() => {
    const id = requestAnimationFrame(() => ajustarRef.current?.());
    return () => cancelAnimationFrame(id);
  }, [efectos, colores]);

  // Con efectos (`FUN-M-57`) la consola vive en una «escena», y cada parte se
  // elige en Configuración → Consolas. Detrás del texto (xterm es
  // transparente): la aurora, la red de micelio y las esporas. Delante, sin
  // recibir el mouse: el tubo CRT, el marco de luz que gira y el rótulo. Sin
  // efectos, solo el contenedor.
  const clases = [
    styles.escena,
    efectos && styles.conEfectos,
    pulso && styles.pulso,
    parte(prefs.efectoBrillo) && styles.brillo,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={clases}>
      {aurora && <div className={styles.luces} aria-hidden />}
      {micelio && <div className={styles.micelio} aria-hidden />}
      {parte(prefs.efectoParticulas) && <div className={styles.esporas} aria-hidden />}
      {/* `data-consola-soltar`: el explorador ubica la consola por geometría
          al arrastrar una nota o una carpeta del árbol (`FUN-S-43`). */}
      <div className={styles.terminal} data-consola-soltar={termId}>
        <div ref={contRef} className={styles.grilla} />
        {soltando && (
          <div className={`${styles.soltar} mic-consola-soltar`} aria-hidden>
            <span className={styles.soltarTexto}>Soltar para escribir la ruta</span>
          </div>
        )}
      </div>
      {parte(prefs.efectoTubo) && <div className={styles.crt} aria-hidden />}
      {parte(prefs.efectoBorde) && <div className={styles.marco} aria-hidden />}
      {parte(prefs.efectoMarca) && (
        <div className={styles.rotulo} aria-hidden>
          <span className={styles.latido} />
          MYCELIUM <b>//</b> TTY
        </div>
      )}
    </div>
  );
}
