import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { temaValido, TEMA_DEFECTO, type Tema } from "@/lib/temas";

/**
 * Preferencias **de un vault**, no del usuario (`FUN-M-28` / `FUN-M-21`).
 *
 * Acá van los ajustes que pertenecen al vault: si se ven los números de línea,
 * cómo se muestran los nombres en el grafo. Abrir otro vault trae los suyos.
 *
 * En desktop **todo** es del vault (decisión D3, 2026-09-26): también el tema,
 * el modo oscuro, la atmósfera y la tipografía que maneja `preferencesStore`,
 * que en web son de la persona. Desde `FUN-L-24` viajan en este mismo archivo
 * (`tema`, `modoOscuro`, `preferencias`) y `preferencesStore` delega acá su
 * persistencia; antes iban por un segundo camino —la fila `usuarios` del índice
 * y un archivo de apariencia aparte— con seis saltos para el mismo alcance.
 *
 * Viven en `.mycelium/preferencias.json` **dentro del vault**, así que viajan
 * con él: copiar la carpeta a otra máquina se lleva también sus ajustes. En web
 * no hay carpeta, y ahí este módulo diverge (`localStorage`).
 *
 * > [!important] Los valores por defecto están en UN solo sitio
 * > `POR_DEFECTO`. Un vault sin archivo, con el archivo corrupto, o con una
 * > preferencia que todavía no existía cuando se guardó, cae acá. Repartir los
 * > defaults por los componentes haría que «apagado por defecto» significara
 * > cosas distintas según quién preguntara.
 */

/** Modos de nombres del grafo (`FUN-M-21`). */
export type ModoNombresGrafo = "todos" | "vecinos" | "apuntado";

/**
 * Anchos de columna de los archivos tabla (`FUN-M-25`).
 *
 * `id del .base` → `referencia de la columna` → ancho en píxeles.
 *
 * Está acá y no dentro del `.base` porque ese archivo es **formato de
 * Obsidian**: meterle una clave nuestra rompería la promesa de que los dos
 * programas abren el mismo archivo. Y está en las preferencias **del vault** y
 * no en las del usuario porque acompaña a la base, que vive en el vault.
 *
 * Las vistas de una misma base **comparten** el ancho de una columna: la clave
 * es la referencia (`estado`, `file.name`), no el par vista+referencia. Es lo
 * que la mayoría espera —una columna se llama igual y se lee igual en las dos
 * vistas— y evita tener que reajustarla en cada una.
 */
export type AnchosTabla = Record<string, Record<string, number>>;

export type PrefsVault = {
  /** Números de línea al costado de una nota markdown (`FUN-M-28`). */
  numerosDeLinea: boolean;
  /** Qué nombres se dibujan en el grafo (`FUN-M-21`). */
  nombresGrafo: ModoNombresGrafo;
  /** Ancho de las columnas de cada archivo tabla (`FUN-M-25`). */
  anchosTabla: AnchosTabla;
  /** Tema de color (HU-12). Solo-desktop: en web es de la persona. */
  tema: Tema;
  /** Modo oscuro (HU-12). Solo-desktop, como `tema`. */
  modoOscuro: boolean;
  /**
   * El resto de `preferencesStore` —tipografía, atmósferas, ancho de
   * tabulación, opciones del grafo y de la búsqueda…—, tal como lo guarda él.
   * Acá solo se garantiza que sea un objeto: cada clave la sanea
   * `preferencesStore` contra sus propios valores por defecto
   * (`sanearContraDefectos`), que es quien los conoce. Solo-desktop.
   */
  preferencias: Record<string, unknown>;
  /**
   * «Dejar que la IA controle Mycelium» (`FUN-L-09`): si esta ventana abre el
   * canal del MCP de control para el vault. **Apagado por defecto**: que un
   * proceso externo pueda manejar la app se concede, no viene puesto. El
   * servidor MCP lee esta clave del disco para distinguir «app cerrada» de
   * «control apagado» (`crates/mycelium-vault/src/preferencias.rs`): si se
   * renombra, hay que renombrarla allá.
   */
  controlIa: boolean;
  /**
   * Si el `.mcp.json` de la raíz lo creó Mycelium al encender el control. Al
   * apagarlo se quita solo nuestra entrada, y el archivo se borra únicamente si
   * quedó vacío **y** era nuestro: uno del usuario no se toca aunque quede vacío.
   */
  mcpJsonCreado: boolean;
  /**
   * Lo mismo para `.claude/settings.json`, donde va el hook que frena `mv` y
   * `rm` (`FUN-L-09`, Parte 3): si lo creó Mycelium, al apagar el control se
   * borra cuando queda vacío; si era del usuario, solo se quita nuestra entrada.
   */
  settingsCreado: boolean;
};

/**
 * Los valores con los que arranca un vault que nunca guardó nada.
 *
 * `numerosDeLinea` va **apagado** a propósito: es lo que pidió el usuario y es
 * lo que hace que un vault existente no cambie de aspecto al actualizar.
 */
export const POR_DEFECTO: PrefsVault = {
  numerosDeLinea: false,
  nombresGrafo: "todos",
  anchosTabla: {},
  // Los mismos con que arranca `preferencesStore` (la estética oscura
  // bioluminiscente de siempre); `preferencias` vacío = todas por defecto.
  tema: TEMA_DEFECTO,
  modoOscuro: true,
  preferencias: {},
  controlIa: false,
  mcpJsonCreado: false,
  settingsCreado: false,
};

/** Si `v` es un objeto plano (no `null`, no una lista). */
const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Mezcla lo leído del disco con los valores por defecto, quedándose solo con lo
 * que reconoce y con el tipo correcto.
 *
 * Es deliberadamente desconfiada: el archivo vive en la carpeta del usuario y se
 * puede editar a mano, y una preferencia agregada después no está en los vaults
 * viejos. Un valor con el tipo equivocado se ignora en vez de propagarse hasta
 * el componente que lo use.
 *
 * Una clave que ya no existe se descarta sin error: p. ej. `disposicionGrafo`,
 * que guardaron los vaults que usaron las disposiciones del grafo (`FUN-L-23`,
 * retiradas el 2026-09-27); el próximo guardado la quita del archivo.
 *
 * Pura y exportada para poder testearla sin Tauri.
 */
export function normalizar(crudo: unknown): PrefsVault {
  if (crudo === null || typeof crudo !== "object") return { ...POR_DEFECTO };
  const o = crudo as Record<string, unknown>;
  return {
    numerosDeLinea:
      typeof o.numerosDeLinea === "boolean" ? o.numerosDeLinea : POR_DEFECTO.numerosDeLinea,
    nombresGrafo:
      o.nombresGrafo === "todos" || o.nombresGrafo === "vecinos" || o.nombresGrafo === "apuntado"
        ? o.nombresGrafo
        : POR_DEFECTO.nombresGrafo,
    anchosTabla: normalizarAnchos(o.anchosTabla),
    // Cualquier tema que exista, también `arrecife` (`FUN-M-51`) aunque el modo
    // dev esté apagado: el modo decide si se puede elegir, no si se conserva.
    tema: temaValido(o.tema, POR_DEFECTO.tema),
    modoOscuro: typeof o.modoOscuro === "boolean" ? o.modoOscuro : POR_DEFECTO.modoOscuro,
    preferencias: esObjeto(o.preferencias) ? { ...o.preferencias } : {},
    controlIa: o.controlIa === true,
    mcpJsonCreado: o.mcpJsonCreado === true,
    settingsCreado: o.settingsCreado === true,
  };
}

/**
 * Se queda con las claves de `crudo` que existen en `defectos` y tienen su mismo
 * tipo (un número finito donde va un número, una lista donde va una lista…); el
 * resto se descarta y el llamador cae al valor por defecto.
 *
 * Es el saneo de `PrefsVault.preferencias`, que la usa `preferencesStore` con sus
 * propios defaults al cargarlas: el archivo se puede editar a mano, y un tamaño
 * de letra `"grande"` o una lista de reglas del grafo que no es una lista no
 * deben llegar hasta el CSS ni hasta el componente que las recorre.
 */
export function sanearContraDefectos<T extends object>(crudo: unknown, defectos: T): Partial<T> {
  if (!esObjeto(crudo)) return {};
  const salida: Partial<T> = {};
  for (const clave of Object.keys(defectos) as (keyof T & string)[]) {
    if (!(clave in crudo)) continue;
    const valor = crudo[clave];
    const defecto = defectos[clave];
    const mismoTipo = Array.isArray(defecto)
      ? Array.isArray(valor)
      : typeof defecto === "number"
        ? typeof valor === "number" && Number.isFinite(valor)
        : typeof defecto === "object" && defecto !== null
          ? esObjeto(valor)
          : typeof valor === typeof defecto;
    if (mismoTipo) salida[clave] = valor as T[typeof clave];
  }
  return salida;
}

/** Ancho mínimo de una columna, en píxeles. Por debajo no se lee nada. */
export const ANCHO_MIN = 60;

/**
 * Se queda solo con los anchos que son números usables.
 *
 * Este valor es el único de las preferencias con forma de diccionario anidado,
 * así que es el único donde un archivo editado a mano puede colar un `NaN`, un
 * `0` o un objeto donde va un número — y un `0` que llegara hasta el `<col>`
 * dejaría una columna invisible sin forma evidente de recuperarla.
 */
function normalizarAnchos(crudo: unknown): AnchosTabla {
  if (crudo === null || typeof crudo !== "object") return {};
  const salida: AnchosTabla = {};
  for (const [tabla, cols] of Object.entries(crudo as Record<string, unknown>)) {
    if (cols === null || typeof cols !== "object") continue;
    const limpias: Record<string, number> = {};
    for (const [ref, ancho] of Object.entries(cols as Record<string, unknown>)) {
      if (typeof ancho === "number" && Number.isFinite(ancho) && ancho >= ANCHO_MIN) {
        limpias[ref] = Math.round(ancho);
      }
    }
    if (Object.keys(limpias).length > 0) salida[tabla] = limpias;
  }
  return salida;
}

type EstadoPrefsVault = {
  prefs: PrefsVault;
  /** Ruta del vault que cargó estas preferencias; null = ninguno todavía. */
  ruta: string | null;
  /** Carga las del vault indicado. Idempotente para la misma ruta. */
  cargar: (ruta: string | null) => Promise<void>;
  set: <K extends keyof PrefsVault>(clave: K, valor: PrefsVault[K]) => void;
};

/**
 * Guardado diferido: cambiar un ajuste con un interruptor no debe escribir el
 * archivo en cada pulsación, y algunos —el modo de nombres del grafo— se tocan
 * varias veces seguidas mientras se busca el que gusta.
 */
const ESPERA_GUARDADO_MS = 400;

/** El archivo, dentro de `.mycelium/` (lo resuelve `leer/escribir_estado_vault`). */
const ARCHIVO = "preferencias.json";
let temporizador: ReturnType<typeof setTimeout> | null = null;

function guardarDiferido(ruta: string | null, prefs: PrefsVault) {
  if (ruta === null) return;
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    temporizador = null;
    // Si falla, se pierde la preferencia y no pasa nada más: no se avisa porque
    // no hay nada que el usuario pueda hacer, y un cartel por un ajuste de
    // aspecto sería más molesto que el propio fallo.
    void invoke("escribir_estado_vault", {
      ruta,
      nombre: ARCHIVO,
      contenido: JSON.stringify(prefs, null, 2),
    }).catch(() => {});
  }, ESPERA_GUARDADO_MS);
}

export const usePrefsVaultStore = create<EstadoPrefsVault>((set, get) => ({
  prefs: { ...POR_DEFECTO },
  ruta: null,

  async cargar(ruta) {
    if (get().ruta === ruta) return;
    if (ruta === null) {
      set({ prefs: { ...POR_DEFECTO }, ruta: null });
      return;
    }
    let crudo: unknown = null;
    try {
      const texto = await invoke<string | null>("leer_estado_vault", { ruta, nombre: ARCHIVO });
      crudo = texto === null ? null : JSON.parse(texto);
    } catch {
      // Ni un archivo ausente ni uno corrupto deben impedir abrir el vault: se
      // arranca con los valores por defecto y el próximo guardado lo rehace.
      crudo = null;
    }
    set({ prefs: normalizar(crudo), ruta });
  },

  set(clave, valor) {
    const prefs = { ...get().prefs, [clave]: valor };
    set({ prefs });
    guardarDiferido(get().ruta, prefs);
  },
}));

/** Atajo de lectura para los componentes. */
export const usePrefVault = <K extends keyof PrefsVault>(clave: K): PrefsVault[K] =>
  usePrefsVaultStore((s) => s.prefs[clave]);
