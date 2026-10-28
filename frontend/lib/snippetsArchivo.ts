/**
 * Lo puro de los snippets CSS (`DEF-164`): qué snippets trae `snippets.json` y
 * cuáles se aplican. Aparte de `stores/cssStore.ts` para poder probarlo sin
 * Tauri (`scripts/test-config-local.mjs`).
 */

/** Snippet de CSS personalizado del usuario (estilo Obsidian, HU-13/15). */
export type CssSnippet = {
  id: string;
  nombre: string;
  /** Si se aplica. Lo decide esta máquina, no el archivo (`DEF-164`). */
  activo: boolean;
  contenido: string;
  /**
   * Vino con el vault y esta máquina nunca lo encendió ni lo apagó: va apagado
   * y Configuración avisa que hay que revisarlo. No se guarda en el archivo.
   */
  traido?: boolean;
};

/**
 * Los snippets de `snippets.json` (ya parseado), con su `activo` según la
 * configuración local de esta máquina (`decisiones`: id → encendido).
 *
 * > [!important] El `activo` del archivo no manda (`DEF-164`)
 * > `snippets.json` viaja con el vault: si su `activo` decidiera, un vault ajeno
 * > llegaría con su CSS aplicado —y un snippet puede tapar la interfaz, imitar
 * > un diálogo o filtrar por `url()` lo que hay en pantalla—. Lo que se aplica
 * > lo dice la configuración local (`configLocalStore`); un snippet que ella no
 * > conoce va **apagado** y queda marcado como `traido`. El archivo sigue
 * > guardando un `activo`, como espejo del estado local, para las versiones
 * > anteriores de la app; acá no se lee.
 *
 * El archivo se puede editar a mano: un snippet sin id o sin CSS no entra.
 */
export function snippetsDelArchivo(crudo: unknown, decisiones: Record<string, boolean>): CssSnippet[] {
  if (crudo === null || typeof crudo !== "object") return [];
  const lista = (crudo as { snippets?: unknown }).snippets;
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((s): CssSnippet[] => {
    if (s === null || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.contenido !== "string") return [];
    const decidido = Object.prototype.hasOwnProperty.call(decisiones, o.id);
    return [{
      id: o.id,
      nombre: typeof o.nombre === "string" ? o.nombre : o.id,
      activo: decidido && decisiones[o.id] === true,
      contenido: o.contenido,
      ...(decidido ? {} : { traido: true }),
    }];
  });
}
