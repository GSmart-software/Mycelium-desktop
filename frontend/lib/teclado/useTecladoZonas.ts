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
import { documentoDe, entrarAEscribir, recordarFoco, seleccionarDocumento, zonaDe } from "./focoDom";
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
      const zona = zonaDe(foco);
      if (zona !== zonaMarcada) {
        zonaMarcada?.removeAttribute("data-zona-activa");
        zona?.setAttribute("data-zona-activa", "");
        zonaMarcada = zona;
      }
      const doc = documentoDe(foco);
      if (doc !== docMarcado) {
        docMarcado?.removeAttribute("data-modo");
        docMarcado = doc;
      }
      if (doc && foco) {
        // El panel de enlaces vive dentro del documento pero es otra zona: con
        // el foco ahí, el documento no está «escribiendo».
        if (doc === foco) doc.setAttribute("data-modo", "navegar");
        else if (zonaDe(foco) === zonaDe(doc)) doc.setAttribute("data-modo", "escribir");
        else doc.removeAttribute("data-modo");
        recordarFoco(foco);
      }
    }

    // `focusout` también: si el foco se va a ningún lado (body), se desmarca.
    const alCambiarFoco = () => queueMicrotask(marcar);

    function alPulsar(e: KeyboardEvent) {
      if (!raiz.hasAttribute("data-teclado")) raiz.setAttribute("data-teclado", "");
      if (e.key !== "Escape" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const foco = document.activeElement as HTMLElement | null;
      const doc = documentoDe(foco);
      if (!doc || !foco || foco === doc) return;
      if (zonaDe(foco) !== zonaDe(doc)) return; // en el panel de enlaces
      if (foco.closest(SEL_ESC_PROPIO)) return;
      // Se decide después de que todos atiendan la tecla: si alguien cerró
      // algo con ella, este Esc ya se usó.
      const antes = foto();
      setTimeout(() => {
        if (!doc.isConnected) return;
        if (escSaleDeEscribir(e.defaultPrevented, antes, foto())) seleccionarDocumento(doc);
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
      zonaMarcada?.removeAttribute("data-zona-activa");
      docMarcado?.removeAttribute("data-modo");
      raiz.removeAttribute("data-teclado");
    };
  }, []);
}
