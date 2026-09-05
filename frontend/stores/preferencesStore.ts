import { create } from "zustand";
import { api } from "@/lib/api";
import { CARPETA_ESPORAS_DEFECTO } from "@/lib/esporas";
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

/**
 * Ancho de tabulación (`FUN-S-02`). Se escribe libre en vez de elegirse entre unos
 * pocos valores, pero se acota: por debajo de 1 la sangría desaparece y por encima
 * de 16 una lista anidada se sale de la pantalla.
 */
export const TAB_MIN = 1;
export const TAB_MAX = 16;
export const TAB_DEFECTO = 4;

/**
 * Normaliza lo que venga de las preferencias guardadas —o de lo que el usuario esté
 * tecleando— a un entero dentro del rango. Un valor inválido cae al defecto en vez
 * de romper el CSS, porque esto alimenta una variable que usa toda la app.
 */
export function anchoTabValido(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return TAB_DEFECTO;
  return Math.min(TAB_MAX, Math.max(TAB_MIN, n));
}

export type Preferencias = {
  editorFont: string;
  editorSize: number;
  previewFont: string;
  previewSize: number;
  /**
   * Pestañas de previsualización (estilo Obsidian/VSCode): al abrir un archivo
   * que solo se está viendo (sin editar) se reemplaza esa pestaña en vez de
   * abrir una nueva. Desactivar para abrir siempre una pestaña nueva.
   */
  previewTabs: boolean;
  /**
   * Grafo: si es `true`, la simulación corre en cada frame de forma continua
   * (mayor consumo de CPU). Por defecto `false`: el grafo deja de simular al
   * asentarse para ahorrar CPU.
   */
  graphContinuousSim: boolean;
  /**
   * Autocerrar pares en el editor: al escribir `(`, `[`, `{`, `"`, `'`, `` ` ``,
   * `*`, `_` se inserta el cierre y, con texto seleccionado, se envuelve la
   * selección. Por defecto `true`.
   */
  autoCloseBrackets: boolean;
  /**
   * Mostrar el nombre del archivo como título centrado en la parte superior de
   * todas las vistas (no es un encabezado `#` del documento). Por defecto `true`.
   */
  showFileTitle: boolean;
  /**
   * Mostrar el **ícono del tipo** junto al nombre en cada pestaña (`FUN-S-11`):
   * markdown, dibujo, lienzo, tabla, consola, o un archivo que no se indexa.
   *
   * Por defecto `true` — es información que antes había que deducir del nombre —
   * pero se puede apagar: con muchas pestañas abiertas cada ícono resta ancho al
   * título, que es lo que de verdad las distingue entre sí.
   */
  iconosEnPestanas: boolean;
  /**
   * Dónde busca el panel del vault (`FUN-M-20`): en el **nombre** del archivo,
   * en su **contenido**, o en los dos.
   *
   * `ambos` por defecto, que es lo que hacía antes de que se pudiera elegir.
   */
  busquedaCampo: "nombre" | "contenido" | "ambos";
  /**
   * Ver los resultados agrupados por carpeta en vez de como lista plana
   * (`FUN-M-20`). Apagado por defecto: la lista viene ordenada por relevancia, y
   * el árbol la reordena por ubicación — mejor para «dónde estaba aquello», peor
   * para «qué es lo más parecido a lo que escribí».
   */
  busquedaArbol: boolean;
  /**
   * Buscar solo la palabra completa en vez de por coincidencia (`DEF-035`).
   *
   * Vive acá y no en el componente porque es **una decisión sobre cómo se
   * busca**, igual que las otras dos, y el panel se desmonta al cambiar de
   * sección del rail: como estado local se perdía sin que nadie lo pidiera.
   */
  busquedaExacta: boolean;
  /**
   * Cuánto "vale" una tabulación en el editor (`FUN-S-02`). Manda sobre las dos
   * caras del asunto, que CodeMirror trata por separado y por defecto **no**
   * coinciden: cuántas columnas ocupa un tabulador ya escrito en el archivo
   * (`tabSize`) y cuántos espacios inserta la tecla Tab (`indentUnit`).
   *
   * Por defecto `4`, y ese valor deja la app **exactamente como se veía antes**:
   * el `padding-left` de las listas está calibrado para que 4 dé los mismos
   * `1.5rem` de siempre. Cambiar el defecto no debe reacomodar los documentos de
   * nadie sin que lo pida.
   *
   * Manda sobre tres cosas, y conviene saber cuál afecta a qué (`DEF-049`):
   *   - **Al leer**: cuánto sangran las listas y los tabuladores. Se ve al
   *     instante en todos los documentos, sin tocar el texto.
   *   - **Al escribir**: cuántos espacios inserta la tecla Tab.
   *   - **Tabuladores literales** del archivo, en el editor.
   *
   * Lo que NO puede hacer: reescalar en el editor una sangría ya escrita con
   * espacios — dos espacios ocupan dos espacios. Para eso hace falta reindentar
   * el documento, que es otra funcionalidad.
   */
  tabWidth: number;
  /**
   * Grafo del vault: indicador de dirección de los enlaces. `animated` = flujo
   * animado a lo largo del enlace (prioridad); `arrow` = flecha hacia el destino;
   * `both` = ambos; `none` = sin indicador. Por defecto `animated`.
   */
  graphEdgeDirection: "none" | "animated" | "arrow" | "both";
  /**
   * Grafo del vault: intensidad (0–2) del brillo de las conexiones de un nodo
   * al apuntarlo con el cursor. 0 = sin resaltado; 1 = por defecto.
   */
  graphHoverGlow: number;
  /**
   * Grafo del vault: grupos de color. Cada nodo que cumple una regla (su ruta
   * contiene `value`, tiene la etiqueta `value`, o su nombre contiene `value`)
   * se dibuja con el color del grupo. Gana el primer grupo que coincide.
   */
  graphColorGroups: { id: string; type: "path" | "tag" | "name"; value: string; color: string; enabled?: boolean }[];
  /**
   * Grafo del vault: reglas para OCULTAR nodos. `name` = el nombre contiene
   * `value` (todas las coincidencias); `path` = ruta exacta de archivo o
   * directorio (excluye también su contenido); `tag` = tiene esa etiqueta.
   */
  graphExcludeRules: { id: string; type: "path" | "tag" | "name"; value: string; enabled?: boolean }[];
  /**
   * Esporas (`FUN-M-03`): carpeta del vault cuyas notas son plantillas. Ruta
   * relativa POSIX; cambiarla NO mueve nada, solo cambia dónde se buscan.
   */
  carpetaEsporas: string;
};

const DEFAULT_PREFS: Preferencias = {
  editorFont: EDITOR_FONTS[0].value,
  editorSize: 16,
  previewFont: PREVIEW_FONTS[0].value,
  previewSize: 16,
  previewTabs: true,
  graphContinuousSim: false,
  autoCloseBrackets: true,
  showFileTitle: true,
  iconosEnPestanas: true,
  busquedaCampo: "ambos",
  busquedaArbol: false,
  busquedaExacta: false,
  tabWidth: 4,
  graphEdgeDirection: "animated",
  graphHoverGlow: 1,
  graphColorGroups: [],
  graphExcludeRules: [],
  carpetaEsporas: CARPETA_ESPORAS_DEFECTO,
};

type PreferencesState = {
  tema: Tema;
  modoOscuro: boolean;
  prefs: Preferencias;
  hydrated: boolean;

  hydrateFromUser: () => void;
  setTema: (tema: Tema) => void;
  toggleDark: () => void;
  setPref: <K extends keyof Preferencias>(key: K, value: Preferencias[K]) => void;
};

/** Aplica el estado actual al DOM: data-theme/data-dark y tipografía. */
function applyToDom(s: Pick<PreferencesState, "tema" | "modoOscuro" | "prefs">) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.setAttribute("data-theme", s.tema); // HU-12 CA6
  if (s.modoOscuro) html.setAttribute("data-dark", "true"); // HU-12 CA7
  else html.removeAttribute("data-dark");

  html.style.setProperty("--mic-editor-font-family", s.prefs.editorFont);
  html.style.setProperty("--mic-editor-font-size", `${s.prefs.editorSize}px`);
  html.style.setProperty("--mic-preview-font-family", s.prefs.previewFont);
  html.style.setProperty("--mic-preview-font-size", `${s.prefs.previewSize}px`);
  // Ancho de tabulación (FUN-S-02). Va como NÚMERO sin unidad para poder usarlo
  // en dos sitios que esperan cosas distintas: `tab-size`, que lleva un número
  // de columnas, y el `padding-left` de las listas, que se calcula multiplicando.
  html.style.setProperty("--mic-tab-width", String(anchoTabValido(s.prefs.tabWidth)));
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
  hydrated: false,

  hydrateFromUser() {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const raw = (user.preferencias ?? {}) as Partial<Preferencias>;
    const prefs: Preferencias = { ...DEFAULT_PREFS, ...raw };
    const tema: Tema = user.tema === "cantarela" ? "cantarela" : "bioluminiscencia";
    set({ tema, modoOscuro: user.modoOscuro, prefs, hydrated: true });
    applyToDom({ tema, modoOscuro: user.modoOscuro, prefs });
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
}));
