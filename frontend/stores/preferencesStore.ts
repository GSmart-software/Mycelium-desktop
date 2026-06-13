import { create } from "zustand";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

export type FontOption = { label: string; value: string };

/** Fuentes del editor (mono + proporcionales) — HU-14 CA1. */
export const EDITOR_FONTS: FontOption[] = [
  { label: "JetBrains Mono", value: "var(--font-jetbrains-mono), monospace" },
  { label: "Fira Code", value: "var(--font-fira-code), monospace" },
  { label: "Source Code Pro", value: "var(--font-source-code-pro), monospace" },
  { label: "Geist Sans", value: "var(--font-geist-sans), sans-serif" },
  { label: "Inter", value: "var(--font-inter), sans-serif" },
  { label: "Source Serif 4", value: "var(--font-source-serif), serif" },
  { label: "Lora", value: "var(--font-lora), serif" },
];

/** Fuentes del preview (proporcionales) — HU-14 CA3. */
export const PREVIEW_FONTS: FontOption[] = [
  { label: "Source Serif 4", value: "var(--font-source-serif), serif" },
  { label: "Geist Sans", value: "var(--font-geist-sans), sans-serif" },
  { label: "Inter", value: "var(--font-inter), sans-serif" },
  { label: "Lora", value: "var(--font-lora), serif" },
];

export type Tema = "bioluminiscencia" | "cantarela";

export type Preferencias = {
  editorFont: string;
  editorSize: number;
  previewFont: string;
  previewSize: number;
  cssActivo: boolean;
};

const DEFAULT_PREFS: Preferencias = {
  editorFont: EDITOR_FONTS[0].value,
  editorSize: 16,
  previewFont: PREVIEW_FONTS[0].value,
  previewSize: 16,
  cssActivo: true,
};

type PreferencesState = {
  tema: Tema;
  modoOscuro: boolean;
  prefs: Preferencias;
  customCss: string;
  /** CSS confirmado/guardado (para detectar cambios sin guardar). */
  savedCss: string;
  hydrated: boolean;

  hydrateFromUser: () => void;
  loadCss: () => Promise<void>;
  setTema: (tema: Tema) => void;
  toggleDark: () => void;
  setPref: <K extends keyof Preferencias>(key: K, value: Preferencias[K]) => void;
  setCustomCss: (css: string) => void;
  saveCss: () => Promise<void>;
};

/** Aplica el estado actual al DOM: data-theme/data-dark, tipografía y CSS propio. */
function applyToDom(s: Pick<PreferencesState, "tema" | "modoOscuro" | "prefs" | "customCss">) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.setAttribute("data-theme", s.tema); // HU-12 CA6
  if (s.modoOscuro) html.setAttribute("data-dark", "true"); // HU-12 CA7
  else html.removeAttribute("data-dark");

  html.style.setProperty("--mic-editor-font-family", s.prefs.editorFont);
  html.style.setProperty("--mic-editor-font-size", `${s.prefs.editorSize}px`);
  html.style.setProperty("--mic-preview-font-family", s.prefs.previewFont);
  html.style.setProperty("--mic-preview-font-size", `${s.prefs.previewSize}px`);

  let styleEl = document.getElementById("mic-custom-css") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "mic-custom-css";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = s.prefs.cssActivo ? s.customCss : ""; // HU-13 CA5
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Persiste tema/modo/tipografía en el backend con debounce (HU-12 CA5, HU-14 CA5). */
function persistPrefs(get: () => PreferencesState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { tema, modoOscuro, prefs } = get();
    void api("/auth/preferencias", {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { tema, modoOscuro, preferencias: prefs },
    }).catch(() => undefined);
  }, 400);
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  tema: "bioluminiscencia",
  modoOscuro: true, // por defecto la estética oscura bioluminiscente (legacy)
  prefs: DEFAULT_PREFS,
  customCss: "",
  savedCss: "",
  hydrated: false,

  hydrateFromUser() {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const raw = (user.preferencias ?? {}) as Partial<Preferencias>;
    const prefs: Preferencias = { ...DEFAULT_PREFS, ...raw };
    const tema: Tema = user.tema === "cantarela" ? "cantarela" : "bioluminiscencia";
    set({ tema, modoOscuro: user.modoOscuro, prefs, hydrated: true });
    applyToDom({ tema, modoOscuro: user.modoOscuro, prefs, customCss: get().customCss });
  },

  async loadCss() {
    try {
      const data = await api<{ css: string }>("/auth/css", {
        token: useAuthStore.getState().accessToken,
      });
      set({ customCss: data.css, savedCss: data.css });
      applyToDom({ ...get(), customCss: data.css });
    } catch {
      // sin CSS guardado
    }
  },

  setTema(tema) {
    set({ tema });
    applyToDom({ ...get(), tema });
    persistPrefs(get);
  },

  toggleDark() {
    const modoOscuro = !get().modoOscuro;
    set({ modoOscuro });
    applyToDom({ ...get(), modoOscuro });
    persistPrefs(get);
  },

  setPref(key, value) {
    const prefs = { ...get().prefs, [key]: value };
    set({ prefs });
    applyToDom({ ...get(), prefs });
    persistPrefs(get);
  },

  setCustomCss(css) {
    set({ customCss: css });
    applyToDom({ ...get(), customCss: css }); // tiempo real (HU-13 CA2)
  },

  async saveCss() {
    const css = get().customCss;
    await api("/auth/css", {
      method: "PUT",
      token: useAuthStore.getState().accessToken,
      body: { css },
    });
    set({ savedCss: css });
  },
}));
