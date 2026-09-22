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

const PREFS_POR_DEFECTO: TerminalPrefs = {
  shellPorDefecto: null,
  restaurarSesiones: true,
  restaurarScrollback: true,
};

/**
 * Dónde se guardan las consolas: **una clave por vault** (`DEF-099`/`DEF-100`).
 *
 * Antes había una sola, así que la lista era de la instalación y no del vault:
 * al cambiar de vault seguían las consolas del anterior —con su directorio de
 * trabajo apuntando a la carpeta que se acababa de dejar— y, como
 * `localStorage` es del origen, **todas las ventanas veían la misma lista**
 * aunque cada una tuviera su vault (`FUN-L-16`).
 *
 * Es el mismo remedio que `DEF-044` aplicó a las pestañas. En modo carpeta el
 * id interno del vault es común a todos, así que los distingue la ruta.
 */
const CLAVE_BASE = "mic-consolas";

const claveDe = (vault: string | null): string =>
  vault === null ? CLAVE_BASE : `${CLAVE_BASE}:${vault}`;

/**
 * Las **preferencias** de la terminal (shell por defecto, qué se restaura) son
 * del USUARIO, no del vault: se configuran en Configuración → Editor → Terminal
 * junto al resto de sus ajustes. Por eso viven en su propia clave y quedan
 * fuera del `partialize`: si viajaran con las sesiones, cada vault tendría su
 * shell por defecto y entrar a uno nuevo la reiniciaría en silencio.
 */
const CLAVE_PREFS = "mic-consolas-prefs";

/** La clave única de antes de `DEF-099`, que llevaba sesiones Y preferencias. */
const CLAVE_HEREDADA = "mic-terminales";

/**
 * Preferencias guardadas, migrando las de la clave heredada la primera vez.
 *
 * Las **sesiones** de esa clave NO se migran: no se sabe de qué vault eran —ese
 * es justamente el defecto— y sus procesos ya están muertos. Se descarta la
 * clave entera para no dejarla suelta.
 */
function prefsGuardadas(): TerminalPrefs {
  if (typeof window === "undefined") return PREFS_POR_DEFECTO;
  try {
    const propio = window.localStorage.getItem(CLAVE_PREFS);
    if (propio !== null) {
      return { ...PREFS_POR_DEFECTO, ...(JSON.parse(propio) as Partial<TerminalPrefs>) };
    }
    const heredado = window.localStorage.getItem(CLAVE_HEREDADA);
    if (heredado === null) return PREFS_POR_DEFECTO;
    const viejas = (JSON.parse(heredado) as { state?: { prefs?: Partial<TerminalPrefs> } })?.state
      ?.prefs;
    const prefs = { ...PREFS_POR_DEFECTO, ...(viejas ?? {}) };
    window.localStorage.setItem(CLAVE_PREFS, JSON.stringify(prefs));
    window.localStorage.removeItem(CLAVE_HEREDADA);
    return prefs;
  } catch {
    // Un almacén ilegible no puede impedir abrir una consola: valen los defectos.
    return PREFS_POR_DEFECTO;
  }
}

function guardarPrefs(prefs: TerminalPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAVE_PREFS, JSON.stringify(prefs));
  } catch {
    // Sin almacén, las preferencias valen para esta corrida y nada más.
  }
}

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
  /** Apunta el `persist` al almacén de consolas de ese vault y carga su lista. */
  usarAlmacenDeVault: (vault: string | null) => Promise<void>;
};

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      sesiones: {},
      prefs: prefsGuardadas(),

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
        const prefs = { ...get().prefs, [key]: value };
        set({ prefs });
        guardarPrefs(prefs);
      },

      /**
       * Cambia el almacén de consolas al del vault indicado (`DEF-099`).
       *
       * El orden es el mismo que el de `tabsStore.usarAlmacenDeVault`, y por el
       * mismo motivo: **leer primero** lo guardado para la clave nueva,
       * reapuntar el `persist` y recién entonces rehidratar o vaciar. Vaciar
       * antes de reapuntar escribiría la lista vacía en la clave del vault que
       * se está dejando, o sea que le borraría sus consolas.
       */
      async usarAlmacenDeVault(vault) {
        const nombre = claveDe(vault);
        const persist = useTerminalStore.persist;
        if (persist.getOptions().name === nombre) return;

        let guardado: unknown = null;
        try {
          guardado = (await persist.getOptions().storage?.getItem(nombre)) ?? null;
        } catch {
          // Un almacén ilegible no puede impedir abrir el vault: se arranca limpio.
        }

        persist.setOptions({ name: nombre });
        if (guardado !== null) {
          await persist.rehydrate();
          return;
        }
        set({ sesiones: {} });
      },
    }),
    {
      name: CLAVE_BASE,
      version: 3,
      // Solo las SESIONES viajan con el vault: las preferencias son del usuario
      // y tienen su propia clave (`DEF-099`).
      partialize: (state) => ({ sesiones: state.sesiones }),
      // v2: se fue el `contador` (`DEF-072`), que ahora se deriva de los
      // títulos en uso. v3: se fueron las `prefs`, y la clave pasó a ser por
      // vault. Se descartan las claves viejas para no dejarlas sueltas.
      migrate: (persisted) => {
        const s = { ...((persisted ?? {}) as Partial<TerminalState>) };
        delete (s as { contador?: number }).contador;
        delete (s as { prefs?: TerminalPrefs }).prefs;
        return s as TerminalState;
      },
    },
  ),
);
