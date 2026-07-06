"use client";

import { useEffect } from "react";
import { exportNotePdfActive } from "@/lib/export";
import { usePanelLayoutStore } from "@/stores/panelLayoutStore";
import { GRAPH_TAB_ID, useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";

/** ¿Corriendo dentro del webview de Tauri? */
function enTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Despacha un ítem del menú nativo a la acción correspondiente del frontend. */
async function handleMenu(id: string): Promise<void> {
  const vault = useVaultStore.getState();
  const panel = usePanelLayoutStore.getState();
  switch (id) {
    case "nueva-nota": {
      const notaId = await vault.createNota(vault.activeFolderId, "markdown");
      useTabsStore.getState().openNote(notaId);
      break;
    }
    case "nueva-carpeta":
      await vault.createCarpeta("Nueva carpeta", vault.activeFolderId);
      break;
    case "toggle-explorador":
      panel.toggleSection("explorer");
      break;
    case "toggle-busqueda":
      panel.toggleSection("search");
      break;
    case "toggle-papelera":
      panel.toggleSection("trash");
      break;
    case "toggle-izquierdo":
      panel.toggleLeft();
      break;
    case "toggle-derecho":
      panel.toggleRight();
      break;
    case "exportar-pdf": {
      const notaId = useTabsStore.getState().activeNotaId();
      if (!notaId || notaId === GRAPH_TAB_ID) return;
      const nota = useVaultStore.getState().notas.find((n) => n.id === notaId);
      if (nota) void exportNotePdfActive(notaId, nota.titulo, "A4");
      break;
    }
  }
}

/**
 * Puente entre el menú nativo de Tauri y las acciones del workspace. Escucha el
 * evento `menu` (emitido por el Rust en `on_menu_event`) y lo despacha. No
 * renderiza nada y es no-op fuera del webview de Tauri (build web).
 */
export function DesktopMenu() {
  useEffect(() => {
    if (!enTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelado = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<string>("menu", (e) => void handleMenu(e.payload));
      if (cancelado) un();
      else unlisten = un;
    })();
    return () => {
      cancelado = true;
      unlisten?.();
    };
  }, []);

  return null;
}
