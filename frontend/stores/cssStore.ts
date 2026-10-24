import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { getVaultActual } from "@/lib/db/vaultContext";
import { useConfigLocalStore, type ConfigLocalVault } from "@/stores/configLocalStore";

import { snippetsDelArchivo, type CssSnippet } from "@/lib/snippetsArchivo";
export type { CssSnippet } from "@/lib/snippetsArchivo";

type CssState = {
  snippets: CssSnippet[];
  load: () => Promise<void>;
  importSnippet: (nombre: string, contenido: string) => Promise<CssSnippet>;
  toggle: (id: string, activo: boolean) => Promise<void>;
  updateContent: (id: string, contenido: string) => Promise<void>;
  rename: (id: string, nombre: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

// ── Persistencia ──────────────────────────────────────────────────────────────
//
// **Diverge de web** (`FUN-L-24`): en desktop los snippets son del vault y se
// guardan en `.mycelium/snippets.json`, dentro de él, así que viajan con la
// carpeta. En web van a la cuenta, por el backend. Estas tres funciones
// son lo único que cambia entre las dos ramas: la API del store es la misma.
// Hasta `FUN-L-24` pasaban además por una tabla `css_snippets` del índice que se
// copiaba al archivo en cada cambio y del archivo a la tabla en cada apertura.

const ARCHIVO = "snippets.json";

/** Lo que se guarda: la lista en su orden, con una versión por si cambia. */
type ArchivoSnippets = { version: 1; snippets: CssSnippet[] };

/** Lee los snippets del vault abierto. Sin vault, sin archivo o ilegible → []. */
async function leerSnippets(local: ConfigLocalVault): Promise<CssSnippet[]> {
  const texto = await invoke<string | null>("leer_estado_vault", {
    ruta: getVaultActual(),
    nombre: ARCHIVO,
  });
  if (texto === null) return [];
  return snippetsDelArchivo(JSON.parse(texto), local.snippets);
}

/**
 * Escritura en cola: cada cambio reescribe el archivo entero con el estado del
 * momento en que le toca, así dos cambios seguidos (activar y renombrar) no
 * pueden terminar en desorden y dejar guardado el penúltimo.
 */
let cola: Promise<void> = Promise.resolve();
function guardarSnippets(estado: () => CssSnippet[]): Promise<void> {
  cola = cola
    .then(async () => {
      // Sin `traido`: es de esta máquina, no del vault.
      const snippets = estado().map(({ id, nombre, activo, contenido }) => ({ id, nombre, activo, contenido }));
      const datos: ArchivoSnippets = { version: 1, snippets };
      await invoke("escribir_estado_vault", {
        ruta: getVaultActual(),
        nombre: ARCHIVO,
        contenido: JSON.stringify(datos, null, 2),
      });
    })
    .catch((e) => {
      // El cambio ya se ve (el <style> está aplicado); si no se guardó, se pierde
      // al reabrir el vault. No se avisa por un ajuste de aspecto, pero tampoco se
      // calla del todo.
      console.error("[Mycelium] snippets · no se pudo guardar snippets.json", e);
    });
  return cola;
}

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

/** Guarda en la configuración local si `id` se aplica. Sin vault, no hay nada que recordar. */
async function recordarActivo(id: string, activo: boolean): Promise<void> {
  if (useConfigLocalStore.getState().ruta === null) return;
  await useConfigLocalStore.getState().fijar({ clave: "snippet", id, activo });
}

export const useCssStore = create<CssState>((set, get) => ({
  snippets: [],

  async load() {
    try {
      const local = await useConfigLocalStore.getState().cargar(getVaultActual() || null);
      const snippets = await leerSnippets(local);
      set({ snippets });
      applySnippets(snippets);
    } catch {
      set({ snippets: [] });
      applySnippets([]);
    }
  },

  async importSnippet(nombre, contenido) {
    // Lo crea el usuario en esta máquina: se enciende, como siempre.
    const snippet: CssSnippet = { id: crypto.randomUUID(), nombre, activo: true, contenido };
    await recordarActivo(snippet.id, true);
    const snippets = [...get().snippets, snippet];
    set({ snippets });
    applySnippets(snippets);
    await guardarSnippets(() => get().snippets);
    return snippet;
  },

  async toggle(id, activo) {
    // La decisión se guarda primero en la máquina: si falla, no se aplica.
    await recordarActivo(id, activo);
    const snippets = get().snippets.map((s) => (s.id === id ? { id: s.id, nombre: s.nombre, contenido: s.contenido, activo } : s));
    set({ snippets });
    applySnippets(snippets); // en vivo, sin recargar
    await guardarSnippets(() => get().snippets);
  },

  async updateContent(id, contenido) {
    const snippets = get().snippets.map((s) => (s.id === id ? { ...s, contenido } : s));
    set({ snippets });
    applySnippets(snippets); // refleja el guardado en vivo
    await guardarSnippets(() => get().snippets);
  },

  async rename(id, nombre) {
    const snippets = get().snippets.map((s) => (s.id === id ? { ...s, nombre } : s));
    set({ snippets });
    applySnippets(snippets); // el comentario /* nombre */ del <style> se actualiza
    await guardarSnippets(() => get().snippets);
  },

  async remove(id) {
    const snippets = get().snippets.filter((s) => s.id !== id);
    set({ snippets });
    applySnippets(snippets);
    await guardarSnippets(() => get().snippets);
    await useConfigLocalStore
      .getState()
      .fijar({ clave: "olvidarSnippet", id })
      .catch(() => {});
  },
}));
