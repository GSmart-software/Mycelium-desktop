"use client";

import { useCallback, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { useTabsStore } from "@/stores/tabsStore";
import { useVaultStore } from "@/stores/vaultStore";

/** Archivo entregado por el SO (leído en Rust). */
type OpenedFile = { name: string; content: string; tipo: string };

/** ¿Corriendo dentro del webview de Tauri? */
function enTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Importa un archivo abierto desde el SO y lo abre en una pestaña. Si ya existe
 * una nota con ese título en el vault, la abre en vez de duplicar.
 */
async function abrirArchivo(f: OpenedFile): Promise<void> {
  const vault = useVaultStore.getState();
  const vaultId = vault.vaultId;
  if (!vaultId) return;

  const existente = vault.notas.find(
    (n) => n.titulo.toLowerCase() === f.name.toLowerCase(),
  );
  if (existente) {
    useTabsStore.getState().openNote(existente.id);
    return;
  }

  const tipo = f.tipo === "excalidraw" ? "excalidraw" : "markdown";
  const created = await api<{ id: string }>(`/vaults/${vaultId}/notas`, {
    method: "POST",
    body: { titulo: f.name, carpetaId: vault.activeFolderId, tipo },
  });
  await api(`/notas/${created.id}/contenido`, {
    method: "PUT",
    body: { contenido: f.content },
  });
  await vault.loadTree(vaultId);
  useTabsStore.getState().openNote(created.id);
}

/**
 * Puente de apertura de archivos del SO (doble clic / "Abrir con" un .md o
 * .excalidraw). Rust lee el archivo y lo entrega por el comando `take_opened_files`
 * (lanzamiento inicial) o el evento `open-files` (instancia ya viva). Se procesa
 * cuando hay un vault cargado. No-op fuera del webview de Tauri.
 */
export function FileOpenBridge() {
  const vaultId = useVaultStore((s) => s.vaultId);
  const cola = useRef<OpenedFile[]>([]);

  const procesar = useCallback(async () => {
    if (!useVaultStore.getState().vaultId) return;
    const pendientes = cola.current;
    cola.current = [];
    for (const f of pendientes) {
      try {
        await abrirArchivo(f);
      } catch {
        // archivo ilegible / error de importación → se ignora
      }
    }
  }, []);

  useEffect(() => {
    if (!enTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelado = false;
    void (async () => {
      const [{ invoke }, { listen }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
      ]);
      const iniciales = await invoke<OpenedFile[]>("take_opened_files");
      cola.current.push(...iniciales);
      void procesar();
      const un = await listen<OpenedFile[]>("open-files", (e) => {
        cola.current.push(...e.payload);
        void procesar();
      });
      if (cancelado) un();
      else unlisten = un;
    })();
    return () => {
      cancelado = true;
      unlisten?.();
    };
  }, [procesar]);

  // Al cargar el vault, procesa lo que hubiera llegado antes de tenerlo.
  useEffect(() => {
    if (vaultId) void procesar();
  }, [vaultId, procesar]);

  return null;
}
