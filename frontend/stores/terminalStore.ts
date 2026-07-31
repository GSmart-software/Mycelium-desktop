import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Estado de la terminal integrada (FUN-L-07, solo-desktop). Guarda las sesiones
 * abiertas (shell, cwd inicial, título y scrollback opcional) y las preferencias.
 * Se persiste para poder RESTAURAR las terminales al reabrir la app (CA6): el
 * proceso no sobrevive, pero la pestaña se recrea con la misma shell y cwd.
 */
export type SesionTerminal = {
  /** Id de la shell elegida para esta terminal (o null = la por defecto). */
  shellId: string | null;
  /** Directorio de trabajo INICIAL (no se rastrea el `cd` posterior). */
  cwd: string | null;
  /** Título de la pestaña ("Terminal N"). */
  titulo: string;
  /** Última salida serializada (para restaurar el historial si se configura). */
  scrollback?: string;
};

type TerminalPrefs = {
  /** Shell que se inicia al abrir una terminal (id de `terminal_shells`); null = la del sistema. */
  shellPorDefecto: string | null;
  /** Restaurar las terminales (pestañas, shell, cwd) al reabrir la app. */
  restaurarSesiones: boolean;
  /** Además, restaurar el texto de la última sesión como historial. */
  restaurarScrollback: boolean;
};

type TerminalState = {
  sesiones: Record<string, SesionTerminal>;
  /** Correlativo para los títulos "Terminal N". */
  contador: number;
  prefs: TerminalPrefs;

  /** Registra una sesión nueva y devuelve su título. */
  registrar: (id: string, datos: { shellId: string | null; cwd: string | null }) => string;
  /** Descarta una sesión (pestaña cerrada o proceso terminado). */
  cerrar: (id: string) => void;
  /** Renombra una consola (título de la pestaña y del panel). */
  renombrar: (id: string, titulo: string) => void;
  guardarScrollback: (id: string, texto: string) => void;
  setPref: <K extends keyof TerminalPrefs>(key: K, value: TerminalPrefs[K]) => void;
};

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      sesiones: {},
      contador: 0,
      prefs: {
        shellPorDefecto: null,
        restaurarSesiones: true,
        restaurarScrollback: true,
      },

      registrar(id, datos) {
        const n = get().contador + 1;
        const titulo = `Terminal ${n}`;
        set({
          contador: n,
          sesiones: { ...get().sesiones, [id]: { ...datos, titulo } },
        });
        return titulo;
      },

      cerrar(id) {
        const sesiones = { ...get().sesiones };
        delete sesiones[id];
        // Sin sesiones, el correlativo vuelve a empezar (la próxima es "Terminal 1").
        set({ sesiones, contador: Object.keys(sesiones).length === 0 ? 0 : get().contador });
      },

      renombrar(id, titulo) {
        const sesion = get().sesiones[id];
        const limpio = titulo.trim();
        if (!sesion || !limpio) return;
        set({ sesiones: { ...get().sesiones, [id]: { ...sesion, titulo: limpio } } });
      },

      guardarScrollback(id, texto) {
        const sesion = get().sesiones[id];
        if (!sesion) return;
        set({ sesiones: { ...get().sesiones, [id]: { ...sesion, scrollback: texto } } });
      },

      setPref(key, value) {
        set({ prefs: { ...get().prefs, [key]: value } });
      },
    }),
    {
      name: "mic-terminales",
      version: 1,
    },
  ),
);
