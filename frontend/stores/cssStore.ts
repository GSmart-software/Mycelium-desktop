import { create } from "zustand";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

/** Snippet de CSS personalizado del usuario (estilo Obsidian, HU-13/15). */
export type CssSnippet = {
  id: string;
  nombre: string;
  activo: boolean;
  contenido: string;
};

type CssState = {
  snippets: CssSnippet[];
  load: () => Promise<void>;
  importSnippet: (nombre: string, contenido: string) => Promise<void>;
  toggle: (id: string, activo: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const token = () => useAuthStore.getState().accessToken;

/**
 * Inyecta el CSS de todos los snippets activos en un único <style> del head.
 * Se llama tras cualquier cambio para reflejarlo sin recargar (HU-13 CA2).
 */
function applySnippets(snippets: CssSnippet[]) {
  if (typeof document === "undefined") return;
  let styleEl = document.getElementById("mic-custom-css") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "mic-custom-css";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = snippets
    .filter((s) => s.activo)
    .map((s) => `/* ${s.nombre} */\n${s.contenido}`)
    .join("\n\n");
}

export const useCssStore = create<CssState>((set, get) => ({
  snippets: [],

  async load() {
    try {
      const data = await api<{ snippets: CssSnippet[] }>("/auth/css/snippets", {
        token: token(),
      });
      set({ snippets: data.snippets });
      applySnippets(data.snippets);
    } catch {
      set({ snippets: [] });
      applySnippets([]);
    }
  },

  async importSnippet(nombre, contenido) {
    const snippet = await api<CssSnippet>("/auth/css/snippets", {
      method: "POST",
      token: token(),
      body: { nombre, contenido },
    });
    const snippets = [...get().snippets, snippet];
    set({ snippets });
    applySnippets(snippets);
  },

  async toggle(id, activo) {
    const snippets = get().snippets.map((s) => (s.id === id ? { ...s, activo } : s));
    set({ snippets });
    applySnippets(snippets); // en vivo, sin recargar
    await api(`/auth/css/snippets/${id}`, {
      method: "PATCH",
      token: token(),
      body: { activo },
    }).catch(() => undefined);
  },

  async remove(id) {
    const snippets = get().snippets.filter((s) => s.id !== id);
    set({ snippets });
    applySnippets(snippets);
    await api(`/auth/css/snippets/${id}`, { method: "DELETE", token: token() }).catch(
      () => undefined,
    );
  },
}));
