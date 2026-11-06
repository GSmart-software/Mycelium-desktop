"use client";

/**
 * El resaltado y los dos modos de los documentos (`FUN-XL-04`, Parte 2), desde
 * el workspace:
 *
 * - En cada `focusin` marca la zona con el foco (`data-zona-activa`) y el modo
 *   de cada documento (`data-modo="navegar|escribir"`), y recuerda el último
 *   elemento enfocado de cada documento.
 * - `data-teclado` en `<html>` mientras se usa el teclado (se va con el
 *   puntero): el borde de la zona solo se dibuja con el teclado, como
 *   `:focus-visible`.
 * - **Esc** sin nada que cerrar saca de escribir y deja el documento
 *   seleccionado; **Enter** sobre un documento seleccionado vuelve a escribir.
 *
 * Los atributos se ponen a mano, sin estado de React: cambian en cada foco y
 * repintar el workspace por eso sería caro. React no los toca (no los maneja).
 */
import { useEffect } from "react";
import { documentoDe, documentoDeMarco, enfocarDocumentoActivo, entrarAEscribir, recordarFoco, seleccionarDocumento, zonaDe } from "./focoDom";
import { pistasVisibles } from "./pistasDom";
import { escSaleDeEscribir, type FotoEsc } from "./zonas";

/**
 * Lo que se cierra con Esc y avisa con su desaparición: menús, listas,
 * diálogos, el autocompletado y los paneles de CodeMirror.
 */
const SEL_EMERGENTES = "[role='menu'], [role='listbox'], [role='dialog'], .cm-tooltip, .cm-panel";

/**
 * Donde Esc es del documento y no sale: la consola (vim, la shell) y
 * Excalidraw (deselecciona, cancela la herramienta). De ahí se sale con F6.
 */
const SEL_ESC_PROPIO = ".xterm, .excalidraw, [data-esc-propio]";

function foto(): FotoEsc {
  const foco = document.activeElement;
  const valor =
    foco instanceof HTMLInputElement || foco instanceof HTMLTextAreaElement ? foco.value : null;
  return { foco, valor, emergentes: document.querySelectorAll(SEL_EMERGENTES).length };
}

export function useTecladoZonas() {
  useEffect(() => {
    const raiz = document.documentElement;
    let zonaMarcada: HTMLElement | null = null;
    let docMarcado: HTMLElement | null = null;

    function marcar() {
      const foco = document.activeElement as HTMLElement | null;
      // Con el foco en el marco de draw.io (colgado de `body`), la zona y el
      // documento son los del panel que lo muestra.
      const deMarco = documentoDeMarco(foco);
      const zona = zonaDe(deMarco ?? foco);
      if (zona !== zonaMarcada) {
        zonaMarcada?.removeAttribute("data-zona-activa");
        zona?.setAttribute("data-zona-activa", "");
        zonaMarcada = zona;
      }
      const doc = deMarco ?? documentoDe(foco);
      if (doc !== docMarcado) {
        docMarcado?.removeAttribute("data-modo");
        docMarcado = doc;
      }
      if (deMarco) deMarco.setAttribute("data-modo", "escribir");
      else if (doc && foco) {
        // El panel de enlaces vive dentro del documento pero es otra zona: con
        // el foco ahí, el documento no está «escribiendo».
        if (doc === foco) doc.setAttribute("data-modo", "navegar");
        else if (zonaDe(foco) === zonaDe(doc)) doc.setAttribute("data-modo", "escribir");
        else doc.removeAttribute("data-modo");
        recordarFoco(foco);
      }
    }

    // Red para que el foco no se pierda (visto en la prueba en vivo del
    // 2026-11-06): cuando lo que tenía el foco desaparece —el editor al pasar a
    // Lectura con Ctrl+3, el menú contextual tras «Abrir al lado»—, el navegador
    // lo deja en `body` y Esc, Enter y los atajos de zona dejan de tener dónde
    // actuar. Si se está usando el teclado, no hay un diálogo abierto y un
    // momento después sigue en `body`, el documento del panel activo queda
    // seleccionado. Con el puntero no se toca: un clic en un hueco es del usuario.
    let rescate: ReturnType<typeof setTimeout> | null = null;
    function rescatarFoco() {
      if (rescate !== null) return;
      rescate = setTimeout(() => {
        rescate = null;
        if (document.activeElement && document.activeElement !== document.body) return;
        if (!raiz.hasAttribute("data-teclado")) return;
        if (document.querySelector('[aria-modal="true"]')) return;
        enfocarDocumentoActivo(false);
      }, 150);
    }

    // `focusout` también: si el foco se va a ningún lado (body), se desmarca.
    const alCambiarFoco = () =>
      queueMicrotask(() => {
        marcar();
        if (!document.activeElement || document.activeElement === document.body) rescatarFoco();
      });

    function alPulsar(e: KeyboardEvent) {
      if (!raiz.hasAttribute("data-teclado")) raiz.setAttribute("data-teclado", "");
      if (e.key !== "Escape" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      // Con las pistas a la vista (F10), Esc solo las cierra.
      if (pistasVisibles()) return;
      const foco = document.activeElement as HTMLElement | null;
      const doc = documentoDe(foco);
      if (!foco) return;
      // Fuera de un documento, o en el panel de enlaces (que vive dentro del
      // documento del panel pero es otra zona).
      if (!doc || zonaDe(foco) !== zonaDe(doc)) {
        escEnPanelDePestana(e, foco);
        return;
      }
      if (foco === doc) return;
      if (foco.closest(SEL_ESC_PROPIO)) return;
      // Se decide después de que todos atiendan la tecla: si alguien cerró
      // algo con ella, este Esc ya se usó.
      const antes = foto();
      setTimeout(() => {
        if (!doc.isConnected) return;
        if (escSaleDeEscribir(e.defaultPrevented, antes, foto())) seleccionarDocumento(doc);
      }, 0);
    }

    /**
     * Fuera de un documento, dentro del contenido de una pestaña (el panel de
     * la nota: propiedades, mini-grafo, enlaces): Esc vuelve a esa pestaña, un
     * nivel arriba. Sin esto, en el mini-grafo del panel lateral Esc no hacía
     * nada (prueba en vivo del 2026-11-06). Como en el documento, solo si nadie
     * usó la tecla para cerrar algo (una lista de sugerencias, un menú).
     */
    function escEnPanelDePestana(e: KeyboardEvent, foco: HTMLElement) {
      const panel = foco.closest<HTMLElement>("[role='tabpanel'][aria-labelledby]");
      if (!panel || foco.closest(SEL_ESC_PROPIO)) return;
      const pestana = document.getElementById(panel.getAttribute("aria-labelledby") ?? "");
      if (!pestana) return;
      const antes = foto();
      setTimeout(() => {
        if (!pestana.isConnected) return;
        if (escSaleDeEscribir(e.defaultPrevented, antes, foto())) pestana.focus();
      }, 0);
    }

    function alPulsarEnBurbuja(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const doc = e.target instanceof HTMLElement && e.target.matches("[data-documento]") ? e.target : null;
      if (!doc) return;
      if (entrarAEscribir(doc)) e.preventDefault();
    }

    const alApuntar = () => raiz.removeAttribute("data-teclado");

    document.addEventListener("focusin", alCambiarFoco);
    document.addEventListener("focusout", alCambiarFoco);
    window.addEventListener("keydown", alPulsar, true);
    window.addEventListener("keydown", alPulsarEnBurbuja);
    window.addEventListener("pointerdown", alApuntar, true);
    return () => {
      document.removeEventListener("focusin", alCambiarFoco);
      document.removeEventListener("focusout", alCambiarFoco);
      window.removeEventListener("keydown", alPulsar, true);
      window.removeEventListener("keydown", alPulsarEnBurbuja);
      window.removeEventListener("pointerdown", alApuntar, true);
      if (rescate !== null) clearTimeout(rescate);
      zonaMarcada?.removeAttribute("data-zona-activa");
      docMarcado?.removeAttribute("data-modo");
      raiz.removeAttribute("data-teclado");
    };
  }, []);
}
