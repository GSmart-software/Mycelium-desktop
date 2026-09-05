import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Estado de la terminal integrada (FUN-L-07, solo-desktop). Guarda las sesiones
 * abiertas (shell, cwd inicial, título y scrollback opcional) y las preferencias.
 * Se persiste para poder RESTAURAR las terminales al reabrir la app (CA6): el
 * proceso no sobrevive, pero la pestaña se recrea con la misma shell y cwd.
 */
/**
 * Colores con los que se puede marcar una consola (`FUN-S-12`).
 *
 * Es una lista cerrada y no un color libre a propósito: son **marcas de
 * identidad**, no de estado, y su único trabajo es distinguirse entre sí de un
 * vistazo. Un selector libre deja elegir el gris del fondo o el celeste de la
 * marca, y con eso la consola queda peor identificada que sin color.
 *
 * Cada uno se resuelve contra `--mic-consola-<id>` en `tokens.css`, donde se
 * eligieron para leerse igual sobre el claro y sobre el oscuro.
 */
export const COLORES_CONSOLA = ["cian", "verde", "ambar", "rosa", "violeta", "azul"] as const;

export type ColorConsola = (typeof COLORES_CONSOLA)[number];

/** La variable CSS de un color de consola, o `null` si no tiene. */
export function varColorConsola(color: ColorConsola | null | undefined): string | null {
  return color ? `var(--mic-consola-${color})` : null;
}

export type SesionTerminal = {
  /** Id de la shell elegida para esta terminal (o null = la por defecto). */
  shellId: string | null;
  /** Directorio de trabajo INICIAL (no se rastrea el `cd` posterior). */
  cwd: string | null;
  /** Título de la pestaña ("Terminal N"). */
  titulo: string;
  /** Última salida serializada (para restaurar el historial si se configura). */
  scrollback?: string;
  /** Color con el que se marca su pestaña (`FUN-S-12`); ausente = sin color. */
  color?: ColorConsola | null;
};

type TerminalPrefs = {
  /** Shell que se inicia al abrir una terminal (id de `terminal_shells`); null = la del sistema. */
  shellPorDefecto: string | null;
  /** Restaurar las terminales (pestañas, shell, cwd) al reabrir la app. */
  restaurarSesiones: boolean;
  /** Además, restaurar el texto de la última sesión como historial. */
  restaurarScrollback: boolean;
};

/**
 * El título de la consola nueva: «Terminal N» con el **menor N libre**
 * (`DEF-072`).
 *
 * Antes había un correlativo que solo subía, así que los números no se
 * reutilizaban —cerrar la 3 de tres y abrir otra daba «Terminal 4»— y podían
 * repetirse, porque el contador se reiniciaba a cero al quedar el mapa vacío
 * pero los títulos podían sobrevivir por otro lado.
 *
 * Se deriva de los títulos EN USO en vez de llevar la cuenta aparte, y con eso
 * las dos mitades del defecto desaparecen por construcción: un hueco se vuelve
 * a ocupar, y no se puede repetir un número que ya está a la vista.
 *
 * Mira también los **renombrados**: si alguien llamó «Terminal 7» a una consola
 * a mano, ese número está ocupado. Un contador no podía saberlo.
 */
export function siguienteTitulo(sesiones: Record<string, SesionTerminal>): string {
  const usados = new Set<number>();
  for (const s of Object.values(sesiones)) {
    const m = /^Terminal (\d+)$/.exec(s.titulo);
    if (m) usados.add(Number(m[1]));
  }
  let n = 1;
  while (usados.has(n)) n++;
  return `Terminal ${n}`;
}

type TerminalState = {
  sesiones: Record<string, SesionTerminal>;
  prefs: TerminalPrefs;

  /** Registra una sesión nueva y devuelve su título. */
  registrar: (id: string, datos: { shellId: string | null; cwd: string | null }) => string;
  /** Descarta una sesión (pestaña cerrada o proceso terminado). */
  cerrar: (id: string) => void;
  /** Renombra una consola (título de la pestaña y del panel). */
  renombrar: (id: string, titulo: string) => void;
  /** Marca una consola con un color, o se lo quita con `null` (`FUN-S-12`). */
  colorear: (id: string, color: ColorConsola | null) => void;
  guardarScrollback: (id: string, texto: string) => void;
  setPref: <K extends keyof TerminalPrefs>(key: K, value: TerminalPrefs[K]) => void;
};

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      sesiones: {},
      prefs: {
        shellPorDefecto: null,
        restaurarSesiones: true,
        restaurarScrollback: true,
      },

      registrar(id, datos) {
        const titulo = siguienteTitulo(get().sesiones);
        set({ sesiones: { ...get().sesiones, [id]: { ...datos, titulo } } });
        return titulo;
      },

      cerrar(id) {
        const sesiones = { ...get().sesiones };
        delete sesiones[id];
        // Ya no hay contador que reiniciar: el número libre se calcula al abrir.
        set({ sesiones });
      },

      renombrar(id, titulo) {
        const sesion = get().sesiones[id];
        const limpio = titulo.trim();
        if (!sesion || !limpio) return;
        set({ sesiones: { ...get().sesiones, [id]: { ...sesion, titulo: limpio } } });
      },

      colorear(id, color) {
        const sesion = get().sesiones[id];
        if (!sesion) return;
        set({ sesiones: { ...get().sesiones, [id]: { ...sesion, color } } });
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
      version: 2,
      // v2: se fue el `contador` (`DEF-072`), que ahora se deriva de los
      // títulos en uso. Se descarta la clave vieja para no dejarla suelta.
      migrate: (persisted) => {
        const s = { ...((persisted ?? {}) as Partial<TerminalState>) };
        delete (s as { contador?: number }).contador;
        return s as TerminalState;
      },
    },
  ),
);
